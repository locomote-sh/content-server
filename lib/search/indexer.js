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

const DB = require('./db');
const Git = require('./git');

const {
    queue,
    opqueue
} = require('../async');

const Log = require('log4js').getLogger('search/indexer');

// TODO: How does this code relate to filedb/search ???

/**
 * Make a content record for the search DB.
 * This function will always return a search record, even if the updated
 * path doesn't belong to any fileset, or belongs to a non-searchable fileset
 * For those cases, the function will return a record with deleted: true - this
 * is to ensure that records removed from a fileset due to a configuration change 
 * get cleared from the search DB.
 *
 * @param repoDir   The path to the repo being updated.
 * @param filesets  A list of filesets.
 * @param commit    A commit hash.
 * @param update    Info about an updated file, with the following properties:
 *                  - status:   The file status.
 *                  - path:     The path to the updated file.
 */
async function makeSearchRecord( repoDir, filesets, commit, update ) {
    let { status, path } = update;
    if( status !== 'deleted' ) {
        // Iterate over available filesets in find one to use to read
        // the search record.
        for( let i = 0; i < filesets.length; i++ ) {
            let fileset = filesets[i];
            // Find first fileset that contains the current path.
            if( fileset.contains( path ) ) {
                let { processor } = fileset;
                // Generate the file record.
                let record = await processor.makeFileRecord( repoDir, path, true, commit );
                if( !record ) {
                    // If no record returned then continue to next fileset.
                    continue;
                }
                let { id, category } = record;
                let result = { id, path, category, deleted: false };
                // Make the search record.
                Object.assign( result, await processor.makeSearchRecord( record ) );
                // Return the result.
                return result;
            }
        }
    }
    // No idx record found; return a delete record.
    return { path, deleted: true };
}

const IndexerQueue = 'search.indexer';

/**
 * Perform a current-state index.
 * This takes the current state of the repo as the most recent commit
 * on the specified branch, and processes all updates between the
 * reference 'since' commit and the current commit.
 * @param scope     The DB scope.
 * @param filesets  An array of filesets.
 * @param ctx       The request context.
 */
function currentStateIndex( scope, filesets, ctx ) {
    return new Promise( async ( resolve, reject ) => {
        let { branch, repoPath } = ctx;
        try {
            // Start a new DB transaction for the commit.
            await scope.startTransaction()
            let commit = await Git.getCurrentCommitHash( repoPath, branch );
            let pending = 0;
            // List all updates in the source commit.
            let updates = Git.listUpdatesSinceCommit( repoPath, scope.since, branch );
            // Process each update.
            updates.on('data', update => {
                if( !update ) return; // Skip undefined results.
                pending++;
                // Pause the updates stream whilst the current update is processed.
                updates.pause();
                // Execute the following on a queue; this is to avoid saturating
                // the number of used system processes.
                queue( IndexerQueue, async () => {
                    Log.debug(' Indexing [%d] %s/%s...', pending, ctx.key, update.path );
                    try {
                        // Make a search record for the update.
                        let record = await makeSearchRecord( repoPath, filesets, commit, update );
                        // Update the search record.
                        await scope.updateContent( record );
                        // Resume the updates stream for next update record.
                        if( --pending < 1 ) {
                            updates.resume();
                        }
                    }
                    catch( err ) {
                        // Destroy updates stream if error - the error will resurface
                        // as an error on the stream.
                        updates.destroy( err );
                    }
                });
            });
            // Handle the end of the updates stream.
            updates.on('end', () => {
                queue( IndexerQueue, async () => {
                    Log.debug('Completed indexing of %s', ctx.key );
                    try {
                        // Update the scope record.
                        await scope.updateScope( commit );
                        // Commit all updates related to the current commit.
                        await scope.commit();
                        // Resolve the operation.
                        resolve();
                    }
                    catch( err ) {
                        // Destroy updates stream if error - the error will resurface
                        // as an error on the stream.
                        updates.destroy( err );
                    }
                });
            });
            // Error reading or processing the updates stream. Rollback the
            // current updates transaction.
            updates.on('error', err => {
                Log.error('Error indexing [C] %s', ctx.key, err );
                // Rollback the current transaction.
                queue( IndexerQueue, async () => {
                    await scope.rollback();
                    resolve();
                });
            });
        }
        catch( e ) {
            Log.error('Error indexing [B] %s', ctx.key, err );
            // Rollback the current transaction.
            queue( IndexerQueue, async () => {
                await scope.rollback();
                resolve();
            });
        }
    });
}

async function make( branchdb, builder, core, filesets, settings ) {
    
    // Connect to the search DB.
    let dbPath = settings.search.dbPath;
    const db = await DB.connect( dbPath, true );

    // Create a queue for running indexing operations.
    const UpdateQueue = opqueue('sh.locomote.search.indexer', updateSearchIndex );

    // Schedule indexing of all available public branches.
    let publics = branchdb.listPublic();
    Log.debug('Preparing to index %d public branches...', publics.length );
    for( let i = 0; i < publics.length; i++ ) {
        let { account, repo, branch } = publics[i];
        let info = core.makeBuildInfo( account, repo, branch );
        UpdateQueue( info );
    }

    // Register event listener to reindex branches after update.
    builder.on('content-repo-update', info => {
        let { account, repo, branch } = info;
        if( branchdb.isPublicBranch( account, repo, branch ) ) {
            UpdateQueue( info );
        }
    });

    const indexingDisabled = settings.search.indexingDisabled;
    if( indexingDisabled ) {
        Log.warn('Search indexing disabled');
    }

    /**
     * Update the search index for a specific account/repo/branch.
     * @param ctx   A context object for the account/repo/branch being updated.
     */
    async function updateSearchIndex( ctx ) {
        if( indexingDisabled ) {
            return;
        }
        Log.debug('Indexing %s', ctx.key );
        try {
            let { account, repo, branch } = ctx;
            // Create a scoped connection to the search DB.
            let scope = await db.makeScope( account, repo, branch );
            // Load filesets for the target branch. ** NOTE **: The original longterm
            // design goal was to allow fileset configs to be defined in the repo,
            // which meant the possibility of them changing between commits. This
            // could have a considerable impact on the following code, and for now
            // only the fileset config for the branch is considered.
            let _filesets = await filesets.getFilesets( ctx, branch );
            // Filter out non-searchable filesets.
            _filesets = _filesets.filter( fs => fs.searchable );
            // Perform the index.
            await currentStateIndex( scope, _filesets, ctx );
        }
        catch( e ) {
            Log.error('Error indexing [A] %s', ctx.key, e );
        }
    }

    return {
        /// Queue a reindex of a repo.
        reindex: function( account, repo, branch ) {
            let info = core.makeBuildInfo( account, repo, branch );
            UpdateQueue( info );
        }
    }
}

exports.make = make;
