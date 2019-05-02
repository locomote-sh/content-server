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

const Git = require('../git');
const Log = require('log4js').getLogger('builder');

/// Check for and resubmit any non-completed builds.
async function run( server, branchdb, buildb ) {

    // Construct a list of buildable source branches which need to be built.
    // This is done by comparing the hash of the latest commit on the source
    // branch with the hash of the last completed build recorded in the build
    // db.

    const buildable = branchdb.listBuildable();
    let len = buildable.length;
    Log.debug('Found %d buildable branch%s...', len, len == 1 ? '' : 'es' );

    const unbuilt = [];
    for( const item of buildable ) {

        const { repoPath, account, repo, branch } = item;

        const [ latest, lastBuilt ] = await Promise.all([
            // Get latest commit for branch, test for branch existance first.
            Git.getCurrentCommitInfo( repoPath, branch, true ),
            // Get last recorded build.
            buildb.getLastBuildCommit( account, repo, branch )

        ]);

        // Test whether to build the branch. Note that if the commit returned
        // by getCurrentCommitInfo is false then this indicates that the buildable
        // branch doesn't exist yet - do don't build a non-existent branch.
        if( latest !== false && latest.commit !== lastBuilt ) {
            unbuilt.push( item );
        }

    }

    len = unbuilt.length;
    Log.debug('Queueing %d pending build%s...', len, len == 1 ? '' : 's' );
    unbuilt.forEach( item => server._buildQueue( item ) );
}

exports.run = run;
