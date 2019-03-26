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

const assert = require('assert');

const { workerQueue } = require('../async');

const WorkerCount = 100;

/**
 * Initialize the file DB pipeline variable scope.
 */
function initScope( acm, builder, filesets, cacheDir ) {
    // Initialize scope with module dependencies.
    let scope = {
        acm,
        builder,
        filesets,
        cacheDir
    };
    // Add support functions.
    scope = Object.assign( scope, require('./support').make( scope ) );
    // Add file update feed functions.
    scope = Object.assign( scope, require('./updates').make( scope ) );
    // Add file info db functions.
    scope = Object.assign( scope, require('./fileinfo-db').make( scope ) );
    // Add fileset content functions.
    scope = Object.assign( scope, require('./filesets').make( scope ) );
    // Add file content functions.
    scope = Object.assign( scope, require('./files').make( scope ) );
    // Add search functions.
    scope = Object.assign( scope, require('./search').make( scope ) );
    // Return result.
    return scope;
}

function start( acm, builder, filesets, settings ) {

    const cacheDir = settings.get('publish.cache.location');

    const scope = initScope( acm, builder, filesets, cacheDir );

    return {
        /**
         * Return a list of all files in a specified repository.
         * @param ctx       The request context.
         */
        listAllFiles: workerQueue( WorkerCount, ctx => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            return scope.listAllFiles( ctx );
        }),
        /**
         * Return a list of all files in a specified repository which have been
         * updated since a reference commit.
         * @param ctx       The request context.
         * @param since     The reference commit.
         */
        listUpdatesSince: workerQueue( WorkerCount, ( ctx, since ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            if( !since ) {
                throw new Error('Reference commit must be provided');
            }
            return scope.listUpdatesSince( ctx, since );
        }),
        /**
         * Generate a zip file containing all files within a fileset category.
         * @param ctx       The request context.
         * @param category  The category of the fileset being fetched.
         */
        getFilesetContents: workerQueue( WorkerCount, ( ctx, category ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            if( !category ) {
                throw new Error('Fileset category name must be provided');
            }
            return scope.getFilesetContents( ctx, category );
        }),
        /**
         * Generate a zip file containing all files within a fileset category updated
         * since a reference commit.
         * @param ctx           The request context.
         * @param category      The category of the fileset being fetched.
         * @param since         The reference commit.
         */
        getFilesetUpdatedContents: workerQueue( WorkerCount, ( ctx, category, since ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            if( !category ) {
                throw new Error('Fileset category name must be provided');
            }
            if( !since ) {
                throw new Error('Reference commit hash must be provided');
            }
            return scope.getFilesetUpdatedContents( ctx, category, since );
        }),
        /**
         * Return a list of the files within a fileset category.
         * @param ctx       The request context.
         * @param category  The category of the fileset being fetched.
         */
        listFilesetFiles: workerQueue( WorkerCount, ( ctx, category ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            if( !category ) {
                throw new Error('Fileset category name must be provided');
            }
            return scope.listFilesetFiles( ctx, category );
        }),
        /**
         * Return a list of the files within a fileset category which have been
         * updated since a reference commit.
         * @param ctx           The request context.
         * @param category      The category of the fileset being fetched.
         * @param since         The reference commit.
         */
        listFilesetUpdates: workerQueue( WorkerCount, ( ctx, category, since ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            if( !category ) {
                throw new Error('Fileset category name must be provided');
            }
            if( !since ) {
                throw new Error('Reference commit hash must be provided');
            }
            return scope.listFilesetUpdates( ctx, category, since );
        }),
        /**
         * Read a file's contents from a repository.
         * The function is exposed as an async worker queue, limited to 10 concurrent
         * requests; this is to avoid EMFILE errors when under high load.
         *
         * @param ctx   A request context; specifies the content repository, branch etc.
         * @param path  The path to the required file, relative to the repo root.
         */
        getFileContents: workerQueue( WorkerCount, ( ctx, path ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            if( !path ) {
                throw new Error('File path must be provided');
            }
            return scope.getFileContents( ctx, path );
        }),
        /**
         * Read a file record.
         * The function is exposed as an async worker queue, limited to 10 concurrent
         * requests; this is to avoid EMFILE errors when under high load.
         *
         * @param ctx   A request context; specifies the content repository, branch etc.
         * @param path  The path to the required file, relative to the repo root.
         */
        getFileRecord: workerQueue( WorkerCount, ( ctx, path ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error('Request context must be provided');
            }
            if( !path ) {
                throw new Error('File path must be provided');
            }
            return scope.getFileRecord( ctx, path );
        }),
        /**
         * Test whether a path exists within a request context.
         */
        exists: workerQueue( WorkerCount, async ( ctx, path ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error(' Request context must be provided');
            }
            let db = await scope.getFileInfoDB( ctx );
            if( !db ) {
                return false;
            }
            return db[path] !== undefined;
        }),
        /**
         * Get a repository's search index.
         * @param ctx   A request context; specifies the content repository, branch
         *              etc.
         */
        getSearchIndex: workerQueue( WorkerCount, ( ctx ) => {
            // Check function arguments.
            if( !ctx ) {
                throw new Error(' Request context must be provided');
            }
            return scope.getSearchIndex( ctx );
        }),
        /**
         * Get a repository's search records.
         * @param account   A Locomote account.
         * @param repo      A content repo name.
         * @param branch    A content repo branch name.
         * @param commit    An optional reference commit hash.
         */
        getSearchRecords: workerQueue( WorkerCount, ( account, repo, branch, commit ) => {
            return scope.getSearchRecords( account, repo, branch, commit );
        })
    };
}

module.exports = start;
