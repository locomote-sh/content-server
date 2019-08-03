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

const Low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

/**
 * Make the build DB.
 * The build DB is used to keep a permanent record of completed builds.
 * It is used during the builder startup process to detect and restart
 * build that were interrupted during a previous system shutdown, and
 * to detect unnecessary builds on the build queue.
 */
function make( settings ) {

    const dbPath = settings.get('build.builddb');
    const adapter = new FileSync( dbPath );
    const db = Low(adapter);

    /**
     * Get a nested value, creating new nodes as needed.
     */
    function getOrCreate( node, ...names ) { 
        return names.reduce( ( node, name ) => {
            const result = node.get( name );
            if( result.value() ) {
                return result;
            }
            return node.set( name, {}).get( name );
        }, node );
    }

    /**
     * Add a build completion record to the DB.
     * @param account   An account name.
     * @param repo      The name of the repo being built.
     * @param branch    The name of the branch being built.
     * @param commit    The hash of the latest branch commit when the
     *                  build started.
     * @param code      The build completion code.
     */
    async function addBuildCompletion( account, repo, branch, commit, code ) {
        const result = await getOrCreate( db, account, repo )
            .set( branch, { commit, code })
            .write();
        return result;
    }

    /**
     * Get the commit hash of the last completed build on a repo branch.
     * @param account   An account name.
     * @param repo      The name of a repo.
     * @param branch    The name of a branch.
     * @return A commit hash, or undefined if no build has been recorded
     *         as completed for the specified branch and repo.
     */
    async function getLastBuildCommit( account, repo, branch ) {
        const result = db
            .get( account )
            .get( repo )
            .get( branch )
            .value();
        if( !result ) {
            return null;
        }
        const { commit } = result;
        return commit;
    }

    return { addBuildCompletion, getLastBuildCommit };

}

module.exports = { make };

