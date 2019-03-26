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

const { exec }  = require('@locomote.sh/utils');

const FS   = require('fs');
const Path = require('path');

const Log = require('log4js').getLogger('search/cache');

const stat = require('util').promisify( FS.stat );

/**
 * List all the files in a branch of a repo's cache.
 * @param cacheDir  The path to the search on-disk cache location.
 * @param account   An account name.
 * @param repo      A repo name.
 * @param branch    A branch name.
 * @return Returns a list of file items; each item has the file path
 * and stat information on the file.
 */
async function listFilesInCache( cacheDir, account, repo, branch ) {
    // The path to the branch's cached search results.
    let cachePath = Path.join( cacheDir, account, repo, branch );
    // List the files in the cache.
    let files = exec('find', [ '.', '-type', '-f', '-name', '*.json' ], cachePath );
    // Get info for each file.
    let infos = [];
    for( let i = 0; i < files.length; i++ ) {
        let path = files[i];
        let info = await stat( path );
        infos.push({ path, info });
    }
    return infos;
}

/**
 * Clear previously generated search results from the on-disk cache.
 * @param cacheDir  The path to the search on-disk cache location.
 * @param account   An account name.
 * @param repo      A repo name.
 * @param branch    A branch name.
 */
async function clearRepoCache( cacheDir, account, repo, branch ) {
    // List all files in the branch cache.
    let files = await listFilesInCache( cacheDir, account, repo, branch );
    // Delete any files that are found.
    if( files.length > 0 ) {
        let paths = files.map( file => file.path );
        await exec('rm', paths, cacheDir );
        Log.info('Deleted %d file(s) from cache for %s/%s/%s.',
                files.length, account, repo, branch );
    }
}

/**
 * Prune files from the search results on-disk cache.
 * Tries to keep total space usage of a repo's on-disk cache is kept below a
 * maximum by removing least recently used files from the cache. The function
 * won't however delete any cached files accessed less than a minute ago, to
 * avoid deleting results which might be still in use - consequently, cache
 * space usage might increase under heavy load.
 * @param maxCacheSize  The maximum allowed disk usage for the cache.
 * @param cacheDir      The path to the search on-disk cache location.
 * @param account       An account name.
 * @param repo          A repo name.
 * @param branch        A branch name.
 */
async function pruneRepoCache( maxCacheSize, cacheDir, account, repo, branch ) {
    // List all files in the branch cache.
    let files = listFilesInCache( cacheDir, account, repo, branch );
    // Calculate the size usage of the cache.
    let size = files.reduce( ( total, file ) => total + file.info.size, 0 );
    // Check whether cache size limit has been exceeded.
    if( size > maxCacheSize ) {
        // Filter out any files modified recently - this is to avoid deleting
        // results which might still be in use.
        let now = Date.now();
        files = files.filter( f => now - f.info.atime > 60000 );
        // Order cache items by last modification time ascending.
        files.sort( ( a, b ) => b.info.mtime - a.info.mtime );
        // Build list of paths to remove.
        let paths = [];
        while( size > maxCacheSize && files.length > 0 ) {
            let file = files.shift();
            paths.push( file.path );
            size -= file.info.size;
        }
        // Delete files.
        await exec('rm', paths, cacheDir );
    }
}

exports.listFilesInCache = listFilesInCache;
exports.clearRepoCache   = clearRepoCache;
exports.pruneRepoCache   = pruneRepoCache;

