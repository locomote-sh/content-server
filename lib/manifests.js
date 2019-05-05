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

const { loadJSON } = require('json-link');
const LRU  = require('lru-cache');
const Path = require('path');
const Git  = require('./git');

const ManifestFilename = 'locomote.json';

// Default manifest.
const DefaultManifest = {
    public: [ 'public' ],
    workflow: {}
};

module.exports = function() {

    // Cache of previously requested manifest instances, keyed by repo dir.
    // Manifests can be different, depending on the source branch (because
    // of branch specific links like the default workflow link above) so
    // each cache entry is a map of branch names to manifest instances.
    const ManifestCache = LRU({ max: 100 });
    // Cache of latest commit hashes for the manifest file on master branch
    // of a repo.
    const CommitCache = LRU({ max: 100 });

    this.onServiceBind('builder', ( builder ) => {
        // Clear repo cache when repo update received.
        builder.on('content-repo-update', info => {
            let { repoDir } = info;
            invalidateCache( repoDir );
        });
    });

    /**
     * Invalidate the manifest cache.
     */
    function invalidateCache( repoDir ) {
        ManifestCache.del( repoDir );
        CommitCache.del( repoDir );
    }

    /**
     * Load a manifest for a given request context.
     */
    async function load( repoDir, branch = 'master' ) {

        // The eventual result.
        let manifest;

        // Look up branch entries in the cache.
        let branches = ManifestCache.get( repoDir );
        if( branches ) {
            // Lookup requested branch on cache entry.
            manifest = branches[branch];
        }
        else {
            // Cache miss, create a new empty cache entry.
            branches = {};
            ManifestCache.set( repoDir, branches );
        }

        // If a cached manifest was found then return it.
        if( manifest ) {
            return manifest;
        }

        // Construct manifest path.
        let path = Path.join( repoDir, ManifestFilename );
        // Create an environment for resolving links within the json.
        let env = { SOURCE: branch };
        // Load the manifest from the path.
        manifest = Object.assign(
            {},
            DefaultManifest,
            // Note that manifest data is optional here - no error if
            // manifest file not found.
            await loadJSON( path, false, env, false )
        );

        // Cache the result.
        branches[branch] = manifest;

        // Return the result.
        return manifest;
    }

    /**
     * Return the commit hash of the latest version of the manifest on
     * a repo's master branch.
     * This is used for manifest fingerprinting by the ACM module.
     */
    async function getCommitHash( repoDir ) {
        // Check cache for entry.
        let cached = CommitCache.get( repoDir );
        if( cached ) {
            return cached;
        }
        let commit = '00000000';
        // Query repo for result.
        let info = await Git.getLastUpdateCommitInfoForFile(
            repoDir,
            'master',
            ManifestFilename );
        // Note that there won't be any commit info if the repo doesn't have
        // a manifest...
        if( info ) {
            commit = info.commit;
        }
        // Cache the result.
        CommitCache.set( repoDir, commit );
        // Return the result.
        return commit;
    }

    return { load, getCommitHash, invalidateCache };
}
