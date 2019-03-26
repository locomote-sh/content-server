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

const Git    = require('./git');
const Path   = require('path');
const format = require('util').format;

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
    let cmd = 'find'
    let args = [ dir, '-type', 'd', '-maxdepth', '2', '-name', '*.git' ]
    let lines = await exec( cmd, args );
    // Command returns a list of paths.
    let repos = lines.map( ( line ) => {
        // Split the root dir from the start of each path.
        let relPath = line.substring( dir.length );
        // Path may have a leading /, so remove it.
        if( relPath[0] == '/' ) {
            relPath = relPath.substring( 1 );
        }
        // Path should now be in format {account}/{repo}.git
        let fields = relPath.split('/')
        if( fields.length == 2 ) {
            let path = line;
            let [ account, dir ] = fields;
            let name = dir.substring( 0, dir.length - 4 ); // Discard .git at end
            // Return result.
            return { path, account, name };
        }
        return false;
    });
    // Filter out any results which couldn't be parsed.
    return repos.filter( repo => !!repo );
}

/**
 * List the target branch names for a branch workflow.
 * @param workflow  A branch workflow, as an array of workflow steps.
 * @return A list of branch names targetted by the workflow.
 */
function listWorkflowTargetsForBranch( workflow ) {
    let targets = workflow 
        // Extract workflow step target.
        .map( step => step.target )
        // Normalize the target so that it contains the repo name.
        .map( target => {
            switch( target.indexOf('#') ) {
            case -1:
                return `${repoName}#${target}`;
            case 0:
                return repoName+target;
            default:
                return target;
            }
        });
    return targets;
}

/// Return a list of a workflow's target branch names.
function listWorkflowTargets( workflow ) {
    // The result.
    let targets = [];
    // Check workflow value.
    if( typeof workflow !== 'object' ) {
        Log.warn('Unexpected workflow value: %o', workflow );
        return targets;
    }
    // Extract branch-specific workflows from repo workflow definition.
    let branches = Object.values( workflow );
    for( let branch of branches ) {
        if( !branch ) {
            continue; // Null or undefined step.
        }
        // Ensure branch workflow is an array of steps.
        if( !Array.isArray( branch ) ) {
            branch = [ branch ];
        }
        // Append the list or targets for the current branch.
        targets = targets.concat( listWorkflowTargetsForBranch( branch ) );
    }
    // Remove duplicates from the result.
    targets = targets
        .sort()
        .filter( ( target, idx, arr ) => arr[idx - 1] != target );
    // Return.
    return targets;
}

/**
 * Load the names of all public and buildable branches from all visible content repos.
 * Returns an object mapping account names to repo names for that account, and each
 * repo name to an object with a list of public and buildable branch names. Every
 * content repo will at a minimum have a branch named 'public' listed as a public
 * branch, and a branch named 'master' listed as a buildable branch.
 */
async function loadBranchInfo( settings, manifests ) {
    const contentRepoHome = settings.get('content.repo.home');
    let repos = await findRepoDirs( contentRepoHome );
    for( let i = 0; i < repos.length; i++ ) {
        let repo = repos[i];
        // Load the manifest json.
        let manifest = await manifests.load( repo.path );
        // Read properties.
        let { public, workflow = {} } = manifest;
        // Read list of public branches.
        switch( typeof public ) {
            case 'undefined':
                repo.public = []; // No public branches.
                break;
            case 'string':
                repo.public = [ public ];
                break;
            default:
                if( Array.isArray( public ) ) {
                    repo.public = public;
                }
                else {
                    repo.public = [];
                }
        }
        // Read workflow definition and extract list of buildable and target branches.
        let buildable = Object.keys( workflow );
        let targets = listWorkflowTargets( workflow );
        Object.assign( repo, { buildable, targets });
    }
    // Convert the list of repo info into a lookup arranged as
    // account -> repo name -> repo info
    return repos.reduce( ( lookup, repo ) => {
        let account = lookup[repo.account]
        if( !account ) {
            account = lookup[repo.account] = {}
        }
        account[repo.name] = repo
        return lookup
    }, {});
}

// Start a new public repo DB from settings.
module.exports = async function( settings, manifests ) {

    let branchDB = await loadBranchInfo( settings, manifests );

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
            let account = branchDB[accountName];
            return account && account[repoName] !== undefined;
        },
        /**
         * Get a content repo's default public branch.
         */
        getDefaultPublicBranch: function( account, repo ) {
            let repoInfo = lookup([ account, repo ]);
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
            let repoInfo = lookup([ account, repo ])
            if( !repoInfo ) {
                return false;
            }
            return repoInfo.public.includes( branch );
        },
        /**
         * Update the branch info for the repository.
         */
        updateBranchInfo: async function( account, repo, manifest ) {
            let repoHome = settings.get('content.repo.home');
            let repoPath = Path.join( repoHome, account, `${repo}.git`);
            let { buildable } = await loadWorkflowInfoForRepo( repoPath );
            let accountInfo = lookup([ account ], true )
            accountInfo[repo] = {
                public:     readPublic( manifest ),
                buildable:  buildable
            };
        },
        /**
         * Return a list of the buildable branches of all content
         * repositories.
         */
        listBuildable: function() {
            return Object.keys( branchDB )
            .reduce( ( result, account ) => {
                let repos = branchDB[account];
                return Object.keys( repos )
                .reduce( ( result, repo ) => {
                    let branches = repos[repo].buildable;
                    return branches.reduce( ( result, branch ) => {
                        result.push({ account, repo, branch });
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
                let repos = branchDB[account];
                return Object.keys( repos )
                .reduce( ( result, repo ) => {
                    let branches = repos[repo].public;
                    return branches.reduce( ( result, branch ) => {
                        result.push({ account, repo, branch });
                        return result;
                    }, result );
                }, result );
            }, []);
        },
        /**
         * List the workflow build targets for a list of source branch repo keys.
         * Sources is a list of keys in account/repo/branch format. The result is
         * a list of branches in the same format.
         */
        listWorkflowTargets: function( sources ) {
            if( !Array.isArray( sources ) ) {
                sources = [ sources ];
            }
            return sources
            .map( ( source ) => {
                let result = [];
                // Split the key into its component parts.
                let [ account, repo, branch ] = source.split('/');
                // Lookup the target info for the account/repo/branch.
                let repoInfo = lookup([ account, repo ]);
                if( repoInfo ) {
                    // Lookup list of targets for source branch.
                    let targets = repoInfo.targets[branch];
                    if( targets ) {
                        result = targets.map( target => {
                            // Targets will be in repo#branch format; convert
                            // to account/repo/branch format.
                            let [ , branch ] = target.split('#');
                            return format('%s/%s/%s', account, repo, branch );
                        });
                    }
                }
                return result;
            })
            // Concat the separate results into a single array.
            .reduce( ( result, branches ) => result.concat( branches ), [] )
            // Sort and filter the array to produce a list of unique results.
            .sort()
            .filter( ( branch, idx, list ) => {
                return idx == 0 || list[idx - 1] != branch;
            });
        }
    };
}

