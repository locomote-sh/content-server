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
        /**
         * Make build information from account / repo / branch names.
         */
        makeBuildInfo: function( account, repo, branch ) {
            // Rebuild key with extracted fields.
            const key      = `${account}/${repo}/${branch}`;
            // Build path to repo.
            const path     = `${account}/${repo}.git`;
            // The absolute path to the repo.
            const absPath  = core.makeContentRepoPath( account, repo, branch );
            // The path to the repo; same as absPath.
            const repoPath = absPath;
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
