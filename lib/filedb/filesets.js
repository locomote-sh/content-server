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
    jsonlTransformer,
    jsonlStreamJoin,
    pipeline
} = require('@locomote.sh/pipeline');

const Log = require('log4js').getLogger('filedb');

// File DB pipeline ops for accessing single files.
exports.make = function( scope ) {

    const {
        filesets: {
            getFilesetForCategory
        },
        cacheDir,
        listAllFiles,
        listUpdatesSince,
        annotateResult,
        getCurrentCommit
    } = scope;

    /**
     * Initialize a fileset updates pipeline.
     * @param ctx       A request context.
     * @param category  A fileset category name.
     * @param since     An optional since commit identifier; only needed for
     *                  since queries.
     * @param commit    An optional commit identifier for the commit being
     *                  queried; if not specified then the latest commit on
     *                  the branch specified in the request context is used.
     * @param fileset   An optional fileset object; if not provided then the
     *                  function will load the fileset for the specified category.
     */
    async function initPipeline( ctx, category, since, commit, fileset ) {
        // Check that fileset is accessible.
        if( !ctx.auth.accessible[category] ) {
            // TODO: Shouldn't ACM control be applied somewhere else - e.g. http api?
            return false;
        }
        // Initialize pipeline - read current commit info.
        if( !commit ) {
            commit = await getCurrentCommit( ctx );
        }
        if( !fileset ) {
            fileset = await getFilesetForCategory( ctx, commit, category );
        }
        return { ctx, commit, category, fileset, since };
    }

    /**
     * List the files in a fileset.
     */
    const listFilesetFiles = pipeline( cacheDir )
    .init( initPipeline )
    .open( async ({ ctx, commit }, outs ) => {
        let result = await listAllFiles( ctx, commit );
        if( result === false ) {
            outs.end();
        }
        else result.pipe( outs );
    })
    .step( async ( vars, outs, ins ) => {
        const { category } = vars;
        // Return list of file paths belonging to the fileset category.
        await jsonlTransformer( ins, outs, record => {
            return record.category == category ? record.path : undefined;
        });
        outs.end();
    },
    'internal/filesets/{ctx.account}/{ctx.repo}/group-{ctx.auth.group}/{commit}-{category}.jsonl')
    .done( annotateResult );

    /**
     * Get a zip file with the contents of all files in a fileset.
     */
    const getFilesetContents = pipeline( cacheDir )
    .init( initPipeline )
    .open( async ({ ctx, category, commit, fileset }, outs ) => {
        let result = await listFilesetFiles( ctx, category, commit, fileset );
        if( result === false ) {
            outs.end();
        }
        else result.pipe( outs );
    })
    .step( async ({ ctx, commit }, outs, ins ) => {
        let files = await jsonlStreamJoin( ins );
        Git.zipFilesInCommit( ctx.repoPath, commit, files, outs );
    },
    'internal/filesets/{ctx.account}/{ctx.repo}/group-{ctx.auth.group}/{commit}-{category}.zip')
    .done( annotateResult );

    /**
     * List the files in a fileset updated since a reference commit.
     */
    const listFilesetUpdates = pipeline( cacheDir )
    .init( initPipeline )
    .open( async ({ ctx, since, commit }, outs ) => {
        let result = await listUpdatesSince( ctx, since, commit );
        if( result === false ) {
            outs.end();
        }
        else result.pipe( outs );
    })
    .step( async ( vars, outs, ins ) => {
        const { category } = vars;
        // Return list of file paths belonging to the fileset.
        await jsonlTransformer( ins, outs, record => {
            let { path, status } = record;
            if( status != 'deleted' && record.category == category ) {
                return path;
            }
            return undefined;
        });
        outs.end();
    },
    'internal/filesets/{ctx.account}/{ctx.repo}/group-{ctx.auth.group}/{commit}-{category}-{since}.jsonl')
    .done( annotateResult );

    /**
     * Get the contents of all files in a fileset that have been updated since
     * a reference commit.
     */
    const getFilesetUpdatedContents = pipeline( cacheDir )
    .init( initPipeline )
    .open( async ({ ctx, category, since, commit, fileset }, outs ) => {
        let result = await listFilesetUpdates( ctx, category, since, commit, fileset );
        result.pipe( outs );
    })
    .step( async ({ ctx, commit }, outs, ins ) => {
        let files = await jsonlStreamJoin( ins );
        Git.zipFilesInCommit( ctx.repoPath, commit, files, outs );
    },
    'internal/filesets/{ctx.account}/{ctx.repo}/group-{ctx.auth.group}/{commit}-{category}-{since}.zip')
    .done( annotateResult );

    return {
        listFilesetFiles,
        getFilesetContents,
        listFilesetUpdates,
        getFilesetUpdatedContents
    };

}
