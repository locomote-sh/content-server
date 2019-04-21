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

// Core functions used by the app.

const Utils = require('@locomote.sh/utils');
const Path = require('path');

const Log = require('log4js').getLogger('core');

//module.exports = function( branchdb, settings ) {
module.exports = function( settings ) {

    const contentRepoHome = settings.get('content.repo.home');

    const core = {
        get contentRepoHome() { return contentRepoHome; },
        /**
         * Make the absolute path to a content repo.
         */
        makeContentRepoPath: function( account, repo, branch ) {
            return Path.join( contentRepoHome, account, repo+'.git' );
        },
        /**
         * Parse a content repo path into its home, account and repo parts.
         * Expects a path in {home}/{account}/{repo} format.
         * Returns false if the path doesn't match the expected format.
         */
        parseContentRepoPath: function( repoPath ) {
            let path = repoPath.substring( contentRepoHome.length );
            let parts = path.split('/');
            if( parts.length == 2 ) {
                let home    = contentRepoHome;
                let account = parts[0];
                let repo    = parts[1];
                // Split trailing .git from repo name.
                repo = repo.substring( 0, repo.length - 4 );
                return { home, account, repo };
            }
            return false;
        },
        /**
         * Return a list of the repository names available to an account.
         * Repositories under the specified path are assumed to be bare repos,
         * with a '.git' file name extension.
         */
        listContentRepoNames: async function( account ) {
            let path = Path.join( contentRepoHome, account );
            let files = await Utils.ls( path );
            return files
                .filter( file => file.match(/.git$/) )
                .map( file => file.replace(/(.git)?$/,'') );
        },

        /*
        // Parse the request path and extract repository info. Returns an
        // object which can be used as a request context.
        parseContentRequestPath: function( path, secure, onlyPublicBranches ) {
            if( onlyPublicBranches === undefined ) {
                onlyPublicBranches = true;
            }
            if( typeof path == 'string' ) {
                path = path.split('/');
            }
            // Extract account, repo and branch info from path.
            let account = path[0];
            let repo    = path[1];
            let branch  = path[2];
            // Return false if no account or repo info.
            if( !(account && repo) ) {
                return false;
            }
            // If the branch name starts with ~ then remove the ~; otherwise it's the
            // query name, not the branch name; default to 'master' instead.
            let trailing;
            if( branch && branch.charAt( 0 ) == '~' ) {
                branch = branch.substring( 1 );
                trailing = path.slice( 3 );
            }
            else {
                branch = 'public';
                trailing = path.slice( 2 );
            }
            if( onlyPublicBranches ) {
                // Check that the branch name is a public branch.
                if( !branchdb.isPublicBranch( account, repo, branch ) ) {
                    Log.info('Not a public branch:', path.join('/') );
                    return false;
                }
            }
            // Build the result and return.
            let result = {
                home:           contentRepoHome,
                account:        account,
                repo:           repo,
                branch:         branch,
                trailing:       trailing,
                key:            `${account}/${repo}/${branch}`,
                secure:         secure
            };
            let repoPath = core.makeContentRepoPath( account, repo, branch );
            Log.debug('Content repo path:', repoPath );
            result.repoPath = repoPath;
            return result;
        },
        */

        /**
         * Make build information from account / repo / branch names.
         */
        makeBuildInfo: function( account, repo, branch ) {
            // Rebuild key with extracted fields.
            let key      = `${account}/${repo}/${branch}`;
            // Build path to repo.
            let path     = `${account}/${repo}.git`;
            // The absolute path to the repo.
            let absPath  = core.makeContentRepoPath( account, repo, branch );
            // The path to the repo; same as absPath.
            let repoPath = absPath;
            return {
                key,        // The original key.
                account,    // The name of the account owning the updated repo.
                repo,       // The updated repo name.
                branch,     // The updated repo branch.
                path,       // The path to the repo, relative to the repo home.
                absPath,
                repoPath
            };
        }
    }

    return core;
}
