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

// Database of content repo branch information.

const Git   = require('./git');
const Path  = require('path');

const { exec } = require('@locomote.sh/utils');

const Log = require('log4js').getLogger('branchdb');

/**
 * Find all git repository directories under a specified root directory.
 * Assumes the following:
 * 1. That the repositories are bare repos, and so their directory name ends
 *    with .git;
 * 2. That repository dirs are arranged in a {root}/{account}/{repo} structure.
 * Returns a list of objects with the following properties:
 * - path:      The full path to the repository.
 * - account:   The name of the account the repository belongs to.
 * - repo:      The name of the repository.
 */
async function findRepoDirs( dir ) {
    // Ensure that 'dir' has a trailing slash - this is so that any symlink
    // in dir's place is properly dereferenced.
    if( dir[dir.length - 1] != '/' ) {
        dir += '/';
    }
    const baseDir = dir;
    const cmd = 'find'
    const args = [ baseDir, '-type', 'd', '-maxdepth', '2', '-name', '*.git' ]
    const lines = await exec( cmd, args );
    // Command returns a list of paths.
    const repos = lines.map( ( line ) => {
        // Split the root dir from the start of each path.
        let relPath = line.substring( dir.length );
        // Path may have a leading /, so remove it.
        if( relPath[0] == '/' ) {
            relPath = relPath.substring( 1 );
        }
        // Path should now be in format {account}/{repo}.git
        const fields = relPath.split('/')
        if( fields.length == 2 ) {
            // Rebuild the repo path by joining the relative path to the search
            // directory.
            //const repoPath = line;
            const repoPath = Path.join( baseDir, relPath );
            const [ account, dir ] = fields;
            const repo = dir.substring( 0, dir.length - 4 ); // Discard .git at end
            // Return result.
            return {
                repoPath,
                account,
                repo
            };
        }
        return false;
    });
    // Filter out any results which couldn't be parsed.
    return repos.filter( repo => !!repo );
}

// Start a new public repo DB from settings.
module.exports = async function( settings, manifests ) {

    const branchDB = await loadBranchInfo( settings, manifests );

    // Perform a lookup on the branch DB.
    function lookup( path, init ) {
        return path.reduce( ( node, key ) => {
            let value = node && node[key];
            if( value === undefined && init ) {
                value = node[key] = {};
            }
            return value;
        }, branchDB );
    }

    /**
     * Load branch info for a specific repo.
     * @param account   The repo account.
     * @param repo      The repo name.
     * @param repoPath  The repo path.
     */
    async function loadBranchInfoForRepo( account, repo, repoPath ) {

        // Load the manifest json.
        const manifest = await manifests.load( repoPath );

        // Read properties from manifest.
        let {
            public,
            build: {
                profile
            } = {}
        } = manifest;

        // Resolve list of public branches.
        switch( typeof public ) {
            case 'undefined':
                public = []; // No public branches.
                break;
            case 'string':
                public = [ public ];
                break;
            default:
                if( Array.isArray( public ) ) {
                    public = public;
                }
                else {
                    public = [];
                }
        }

        // Load list of buildables from the build profile.
        let buildable;
        switch( typeof profile ) {
            case 'string':
                // Build profile specified as an ID, load profile from the
                // build configuration.
                profile = settings.get(`build.profiles.${profile}`);
                if( profile && profile.buildable ) {
                    buildable = profile.buildable;
                }
                else {
                    buildable = [];
                }
                break;
            case 'object':
                buildable = profile.buildable || [];
                break;
            case 'undefined':
            default:
                buildable = [];
        }

        return { account, repo, repoPath, buildable, public };
    }

    /**
     * Load the names of all public and buildable branches from all visible content repos.
     * Returns an object mapping account names to repo names for that account, and each
     * repo name to an object with a list of public and buildable branch names. Every
     * content repo will at a minimum have a branch named 'public' listed as a public
     * branch, and a branch named 'master' listed as a buildable branch.
     */
    async function loadBranchInfo( settings ) {

        const lookup = {};
        const contentRepoHome = settings.get('content.repo.home');
        const repos = await findRepoDirs( contentRepoHome );

        for( const { account, repo, repoPath } of repos ) {

            const branchInfo = await loadBranchInfoForRepo( account, repo, repoPath );
            
            let accountLookup = lookup[account];
            if( !accountLookup ) {
                accountLookup = lookup[account] = {};
            }
            accountLookup[repo] = branchInfo;
        }

        return lookup;
    }

    return {
        lookup: lookup,
        /**
         * Test if a name is a valid account name.
         */
        isAccountName: function( name ) {
            return branchDB[name] !== undefined;
        },
        /**
         * Test if a name is a valid repository name.
         */
        isRepoName: function( accountName, repoName ) {
            const account = branchDB[accountName];
            return account && account[repoName] !== undefined;
        },
        /**
         * Get a content repo's default public branch.
         */
        getDefaultPublicBranch: function( account, repo ) {
            const repoInfo = lookup([ account, repo ]);
            if( !repoInfo ) {
                return undefined;
            }
            // Return the first listed public branch.
            return repoInfo.public[0];
        },
        /**
         * Test that a branch of a content repo is a public branch.
         */
        isPublicBranch: function( account, repo, branch ) {
            const repoInfo = lookup([ account, repo ])
            if( !repoInfo ) {
                return false;
            }
            return repoInfo.public.includes( branch );
        },
        /**
         * Update the branch info for the repository.
         */
        updateBranchInfo: async function( account, repo ) {
            const repoHome = settings.get('content.repo.home');
            const repoPath = Path.join( repoHome, account, `${repo}.git`);
            const branchInfo = await loadBranchInfoForRepo( account, repo, repoPath );
            const accountInfo = lookup([ account ], true )
            accountInfo[repo] = branchInfo;
        },
        /**
         * Return a list of the buildable branches of all content
         * repositories.
         */
        listBuildable: function() {
            return Object.keys( branchDB )
            .reduce( ( result, account ) => {
                const repos = branchDB[account];
                return Object.keys( repos )
                .reduce( ( result, repo ) => {
                    const { repoPath, buildable } = repos[repo];
                    return buildable.reduce( ( result, branch ) => {
                        result.push({ repoPath, account, repo, branch });
                        return result;
                    }, result );
                }, result );
            }, []);
        },
        /**
         * Return a list of the public branches of all content
         * repositories.
         */
        listPublic: function() {
            return Object.keys( branchDB )
            .reduce( ( result, account ) => {
                const repos = branchDB[account];
                return Object.keys( repos )
                .reduce( ( result, repo ) => {
                    const { repoPath, public } = repos[repo];
                    return public.reduce( ( result, branch ) => {
                        result.push({ repoPath, account, repo, branch });
                        return result;
                    }, result );
                }, result );
            }, []);
        }
    };
}

