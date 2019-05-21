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

const {
    pipeline,
    lineTransformer,
    jsonlTransformer
} = require('@locomote.sh/pipeline');

const Git = require('./git');

const HookNS = 'filedb.updates';

const Log = require('log4js').getLogger('filedb');

exports.make = function( scope ) {

    const {
        acm,
        cacheDir,
        filesets: {
            makeFileRecord
        },
        jsonPrint,
        annotateResult,
        getCurrentCommit,
        correctExtendedChars
    } = scope;

    /**
     * Parse a line of git output.
     * This function assumes only the file path in each line. It returns a
     * one-item of array for compatibility with nameStatusParser().
     */
    function nameOnlyParser( line ) {
        // Use the full line as the file path, status is always true => active.
        // Handle extended chars in filename as reported by git.
        const path = correctExtendedChars( line );
        const status = true;
        return [
            { path, status }
        ];
    }

    /**
     * Parse a line of git output. This function assumes the file status code
     * followed by the file path. The function returns a one-item array in 
     * most cases, but when dealing with renames will return an array of two
     * items (a file deletion on the old filename, followed by an active file
     * for the new name).
     */
    function nameStatusParser( line ) {
        // The line will be in a format like the following:
        //      M       file.js
        //      R079    file-1.js      file-2.js
        // The first example shows a modified file; the second example shows
        // a renamed file, with the old filename followed by the new filename.
        // The number after the 'R' is a score showing file similarity (see
        // https://stackoverflow.com/a/35142442/8085849). In the second case,
        // the function returns an array with two items; one a file deletion
        // on the old filename; the second an active file item on the new name.
        // Git file status flags:
        // ' ' = unmodified
        //  M = modified
        //  A = added
        //  D = deleted
        //  R = renamed
        //  C = copied
        //  U = updated but unmerged
        const code = line[0];
        if( code == 'R' ) {
            // Note that line fields are tab separated.
            const fields = line.split('\t');
            return [
                { path: correctExtendedChars( fields[1] ), status: false },
                { path: correctExtendedChars( fields[2] ), status: true }
            ];
        }
        const path = correctExtendedChars( line.slice( 2 ) );
        const status = code != 'D';
        return [
            { path, status }
        ];
    }

    /**
     * Generate an array of file records from an array of file info items.
     * @param ctx       The request context.
     * @param commit    The commit being processed.
     * @param since     The 'since' commit reference.
     * @param items     An array of { path, status } file info items.
     * @param fsCache   A fileset cache.
     */
    function makeFileRecords( ctx, commit, since, items, fsCache ) {
        return Promise.all( items.map( async ( item ) => {
            const { path, status } = item;
            let record = await makeFileRecord( ctx, commit, path, status, fsCache );
            if( !record ) {
                // In a since query, a file may not have a file record because
                // of a fileset definition change - i.e. it's possible that the
                // file belonged to a fileset in the 'since' commit, but no
                // longer belongs to a fileset because of a definition change;
                // to ensure that those files get reported to the client as
                // 'deleted', try processing the file entry with fileset processors
                // for the older commit with the file set to inactive status.
                record = await makeFileRecord( ctx, since, path, false, fsCache );
            }
            return record;
        }));
    }

    /**
     * Process a stream of file updates presented as file records.
     * Applies ACM filters and rewrites, before appending control
     * records to the end of the stream.
     */
    async function processUpdates( vars, outs, ins ) {
        const { ctx, commit: version, valid } = vars;
        const { repoPath } = ctx;
        // If there is a valid flag present with a value of 'I' - indicating
        // an invalid 'since' parameter was passed to the updates query -
        // then prepend a control record to the result indicating that the
        // file DB contents need to be reset.
        if( valid === 'I' ) {
            const name = 'reset';
            const category = '$control';
            jsonPrint( outs, { name, category });
        }
        // Apply ACM filter, extract commit, category and fingerprint into.
        const categories = {};
        const commits = {};
        await jsonlTransformer( ins, outs, async ( record ) => {
            const { path } = record;
            // Add commit info for the file.
            const commit = await Git.readCurrentCommitForFile( repoPath, path, version );
            if( !commit ) {
                Log.warn(`Unable to read commit for ${repoPath}:${path}#${version}`);
                return;
            }
            // Apply ACM filter and rewrite.
            record = acm.filterAndRewrite( ctx, record );
            if( record ) {
                // Update category info.
                const { category } = record;
                const inplace = categories[category];
                if( inplace ) {
                    // Replace in place commit if file's commit is later.
                    if( inplace.date < commit.date ) {
                        categories[category] = commit;
                    }
                }
                else {
                    categories[category] = commit;
                }
                // Make sure commit info is recorded.
                commits[commit.id] = commit;
                // Rewrite file record to contain only the commit hash.
                record.commit = commit.id;
            }
            return record;
        }, HookNS, 'acm', vars );
        // Generate a category record for each fileset category in the update.
        // This stores the latest available hash for the fileset category.
        for( const name in categories ) {
            const commit = categories[name].id;
            const path = `.locomote/category/${name}`;
            const category = '$category';
            jsonPrint( outs, { path, commit, category, name });
        }
        // Generate a group ACM category record.
        jsonPrint( outs, {
            path:       '.locomote/acm/group',
            category:   '$acm',
            name:       'group',
            value:      ctx.auth.group 
        });
        // Generate commit records for each unique commit in the update.
        for( const hash in commits ) {
            const info = commits[hash];
            const path = `.locomote/commit/${hash}`;
            const category = '$commit';
            jsonPrint( outs, { path, info, category });
        }
        // Generate commit record for latest commit on branch.
        jsonPrint( outs, {
            path:       '.locomote/commit/$latest',
            category:   '$latest',
            commit:     vars.commit
        });
        outs.end();
    }

    /**
     * List all tracked files on a branch of a content repository.
     */
    const listAllFiles = pipeline( cacheDir )
    .init( async ( ctx, commit ) => {
        // Initialize pipeline - read current commit info.
        if( !commit ) {
            commit = await getCurrentCommit( ctx );
        }
        return { ctx, commit };
    })
    .open( ({ ctx, commit }, outs ) => {
        // List tracked files in the repository at specified commit.
        Git.listAllFilesAtCommit( ctx.repoPath, commit, outs );
    })
    .step( async ( vars, outs, ins ) => {
        const { ctx, commit } = vars;
        const fsCache = {}; // Fileset cache.
        // Transform list of file paths into file records.
        await lineTransformer( ins, outs, path => {
            // Handle extended chars in filename as reported by git.
            path = correctExtendedChars( path );
            return makeFileRecord( ctx, commit, path, true, fsCache );
        }, HookNS, 'make-records', vars );
        outs.end();
    },
    'internal/{ctx.account}/{ctx.repo}/records-{commit}.jsonl')
    .step( processUpdates, 
    'internal/{ctx.account}/{ctx.repo}/results-{commit}-{ctx.auth.group}.jsonl')
    .done( annotateResult );

    /**
     * List all files updated or modified since a reference commit.
     */
    const listUpdatesSince = pipeline( cacheDir )
    .init( async ( ctx, since, commit ) => {
        // Initialize pipeline.
        if( !commit ) {
            commit = await getCurrentCommit( ctx );
        }
        // Generate a flag indicating whether the since commit is valid.
        let valid = await Git.isValidCommit( ctx.repoPath, since );
        valid = valid ? 'V' : 'I';
        return { ctx, since, valid, commit };
    })
    .open( async ( vars, outs ) => {
        const { ctx: { repoPath }, since, valid, commit } = vars;
        if( valid != 'V' ) {
            // If the since commit isn't valid then it indicates an unusual
            // circumstance - for example, an incorrect since param value,
            // or a repo which has been recreated or restructured so that
            // a previous commit hash is no longer valid. Return the complete
            // file list in this case.
            Log.warn(`Since commit ${since} not valid in ${repoPath}`);
            await Git.listAllFilesAtCommit( repoPath, commit, outs );
        }
        else {
            // List files changed since the reference commit.
            await Git.listChangesSince( repoPath, commit, since, outs );
        }
    })
    .step( async ( vars, outs, ins ) => {
        const { ctx, since, valid, commit } = vars;
        // Fileset cache.
        const fsCache = {};
        // Choose a parser for line format - this depends on which git command
        // was used in the previous step.
        const lineParser = valid == 'V' ? nameStatusParser : nameOnlyParser;
        // Transform git listing into file records.
        await lineTransformer( ins, outs, async ( line ) => {
            const items = lineParser( line );
            const records = await makeFileRecords( ctx, commit, since, items, fsCache );
            return records;
        }, HookNS, 'make-records', vars, true );
        outs.end();
    },
    'internal/{ctx.account}/{ctx.repo}/records-{commit}-{since}-{valid}.jsonl')
    .step( processUpdates, 
    'internal/{ctx.account}/{ctx.repo}/results-{commit}-{since}-{valid}-{ctx.auth.group}.jsonl')
    .done( annotateResult );

    return {
        listAllFiles,
        listUpdatesSince
    };
}
