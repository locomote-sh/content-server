/*
   Copyright 2019 Locomote.sh

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

const Git = require('./git');

const {
    pipeline,
    jsonlTransformer
} = require('@locomote.sh/pipeline');

const Log = require('log4js').getLogger('filedb/search');

exports.make = function( scope ) {

    const {
        filesets: {
            getFilesets
        },
        cacheDir,
        listUpdatesSince,
        annotateResult
    } = scope;

    // Get search record fetch functions for fileset categories.
    async function getSearchableProcessors( ctx, commitID ) {

        let filesets = await getFilesets( ctx, commitID );

        let searchRecordFetches = {};
        for( let fileset of filesets ) {
            let { category, searchable, processor } = fileset;
            if( searchable ) {
                searchableProcessors[category] = processor;
            }
        }

        return searchableProcessors;
    }

    // The IDX rewrite has to return a record in the same format as the standard file record
    // This is then written to the search db
    // Search queries should reconstruct the record format in their results
    // The http search request handler should then apply the acm filter to the result
    // The acm rewrite is not applied; the idx rewrite is treated as the (inexact) analog.

    const getSearchRecords = pipeline( cacheDir )
    .init( async ( ctx, since ) => {
        // Initialize pipeline - read current commit info.
        let commit = await Git.readCurrentCommit( ctx.repoPath, ctx.branch );
        return { ctx, commit, since };
    })
    .open( async ( vars, outs ) => {
        let { ctx, since, commit } = vars;
        let result = await listUpdatesSince( ctx, since, commit );
        result.pipe( outs );
    })
    .step( async ( vars, outs, ins ) => {
        let { ctx, commit } = vars;
        // Get processors for searchable filesets.
        const searchable = getSearchableProcessors( ctx, commit.id );
        // Rewrite matching file records.
        await jsonlTransformer( ins, outs, async ( record ) => {
            // Read file category.
            let { category } = record;
            // Lookup processor.
            let processor = searchable[category];
            if( !proessor ) {
                // No processor => non-searchable fileset.
                return undefined;
            }
            // Make and return the search record.
            record = await processor.makeSearchRecord( record );
            return record;
        });
        outs.end();
    },
    'internal/{ctx.account}/{ctx.repo}/group-{ctx.auth.group}/search-records-{commit.id}-{since}.jsonl')
    .done( annotateResult );
    
    return { getSearchRecords };
}
