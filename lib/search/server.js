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
    ensureDirForFile,
    fingerprint 
} = require('@locomote.sh/utils');

const { pipeline } = require('@locomote.sh/pipeline');

const DB        = require('./db');
const Indexer   = require('./indexer');
const IPC       = require('../ipc');

const { queue } = require('../async');

const SearchQueue = 'search.search';

const {
    listFilesInCache,
    clearRepoCache,
    pruneRepoCache
} = require('./cache');

const Log = require('log4js').getLogger('search');

/**
 * Start the search service.
 */
async function init( branchdb, builder, core, settings, server ) {

    const cacheDir = settings.search.cacheDir || '.';
    const maxCacheSize = settings.search.perBranchMaxCacheSize || 250000;

    // Ensure a location exists for the search DB.
    let dbPath = settings.search.dbPath;
    await ensureDirForFile( dbPath );

    // Connect to the search DB.
    Log.debug('Opening search DB at %s...', dbPath );
    // First open the connection in writeable mode; this is to allow DB
    // initialization if none exists.
    await DB.connect( dbPath, true );
    // Now open the read-only connection used for search queries.
    const db = await DB.connect( dbPath );

    // Startup the repo indexer.
    const indexer = await Indexer.make( branchdb, builder, core, settings );

    // The search pipeline. Search results are cached to disk for a
    // short period; this is done both for performance and for cross-
    // process communication reasons.
    const search = pipeline( cacheDir )
    // Initialize the request by fingerprinting the search term.
    .init( async ( account, repo, branch, term, mode = 'any', path ) => {
        // Convert search term to lowercase - search is case insensitive,
        // and we want the same fingerprint for 'Text' 'text' or 'tExT'.
        term = term.toLowerCase();
        // Calculate search fingerprint.
        let fingerprint = fingerprint([ term, mode, path ]);
        // Get the latest indexed commit for the repo being searched.
        let commit = await db.lastCommitForScope( account, repo, branch );
        // If no commit found - meaning that the scope doesn't exist in
        // the search DB - then default to all zeros.
        commit = commit || '00000000';
        return {
            account,
            repo,
            branch,
            term,
            mode,
            path,
            commit,
            fingerprint
        };
    })
    // Execute the search query and save the results to disk.
    .open( async ({ account, repo, branch, term, mode, path }, outs ) => {
        try {
            await db.search( account, repo, branch, term, mode, path, row => {
                queue( SearchQueue, () => {
                    outs.write( JSON.stringify( row ) );
                    outs.write('\n');
                });
            });
            await queue( SearchQueue, () => outs.end() );
        }
        catch( err ) {
            Log.error( err );
            // TODO
        }
        // Schedule an operation to prune the cache directory.
        process.nextTick( () => {
            pruneRepoCache( maxCacheSize, cacheDir, account, repo, branch );
        });
    },
    '{account}/{repo}/{branch}/{commit}-{fingerprint}.json')
    .done();

    this._indexer = indexer;
    this._search = search;
}

exports.init = init;
