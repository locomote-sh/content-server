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

// A database holding basic information about files on specific
// branches of a content repository.

const LRU = require('lru-cache');
const { singleton } = require('../async'); // Asynchronous singleton function.
const { lineParser } = require('@locomote.sh/pipeline');

// Create a cache to hold per-branch lookup tables.
const Cache = LRU({ max: 100 });

/**
 * Parse a json-lines stream and invoke a callback for each JSON
 * object in the stream.
 */
function jsonlStreamForEach( ins, fn ) {
    return lineParser( ins, async ( line ) => {
        if( line.length > 0 ) {
            await fn( JSON.parse( line ) );
        }
    });
}

exports.make = function( scope ) {

    const {
        filesets: { getFilesetForPath },
        builder,
        listAllFiles
    } = scope;

    // Register event listener with builder to remove cached file info
    // when a content repo is updated.
    builder.on('content-repo-update', ( info ) => {
        const { key } = info;
        Cache.del( key );
    });

    /**
     * Get the file info db for a request context.
     */
    function getFileInfoDB( ctx ) {
        // Use the context key as a cache key.
        const { key } = ctx;
        // Look for a currently cached db.
        const db = Cache.get( key );
        if( db ) {
            return db;
        }
        // Nothing cached, so generate a DB.
        return singleton( key, async () => {
            // List all active files on target repo + branch.
            const result = await listAllFiles( ctx );
            // Open a readable on the result.
            const ins = await result.readable();
            // Process each file record in the result and add a mapping from the
            // file path to its commit.
            const db = {};
            const fsCache = {};
            await jsonlStreamForEach( ins, async ( record ) => {
                const { path, commit } = record;
                // Ignore files without a commit.
                if( !commit ) {
                    return;
                }
                // Lookup the fileset for the current file.
                const fileset = await getFilesetForPath( ctx, commit, path, fsCache );
                if( fileset ) {
                    // Get file's cache control from the fileset.
                    const cacheControl = fileset.cacheControl;
                    // Add a db record.
                    db[record.path] = { commit, cacheControl };
                }
            });
            // Add to the cache and return.
            Cache.set( key, db );
            return db;
        });
    }

    return { getFileInfoDB };
}
