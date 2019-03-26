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

const Utils         = require('@locomote.sh/utils');
const Git           = require('../git');
const Path          = require('path');
const { opqueue }   = require('../async');
const which         = require('util').promisify( require('which') );

const Log           = require('log4js').getLogger('builder');

function start( core, manifests, branchdb, settings, server ) {

    const { workspaceHome, disabled } = settings;

    if( disabled ) {
        Log.warn('Build queue disabled');
    }

    /**
     * Build and publish content in an updated repo.
     * @param info  Repo info parsed from the build key.
     */
    async function doBuild( info ) {

        if( disabled ) {
            return;
        }

        let { path, absPath, account, repo, branch } = info;

        try {

            Log.info('Building %s/%s/%s', account, repo, branch );

            // Read the manifest for the source branch.
            let manifest = await manifests.load( absPath, branch );

            // Update public and buildable branch info for the repo.
            branchdb.updateBranchInfo( account, repo, manifest );
            
            // Read the current commit info on the source branch.
            let commitInfo      = await Git.getCurrentCommitInfo( absPath, branch );
            // The source repo origin.
            let origin          = core.makeContentRepoPath( account, repo );
            // The source branch identifier.
            let source          = `${repo}:${branch}@${origin}`;
            // The current source commit.
            let initialCommit   = commitInfo.commit;
            // The account's workspace directory.
            let wsPath          = Path.join( workspaceHome, account );
            // The build environment.
            let env             = process.env;

            // Read a list of the commits contributing to the current build.
            let commits = await Git.listCommitHashesSinceCommit( absPath, initialCommit );

            // Build action script path & args.
            // See command line options for locomote-build script.
            let cmd  = await which('locomote-build');
            let args = [
                // Print build targets after executing workflow step.
                '--printTargets', 
                // Send log output to build log file.
                '--log', Path.join( wsPath, 'build.log'),
                // Execute the 'workflow' build action on the source branch.
                'workflow', source ];

            Log.debug('%s %s', cmd, args );

            // Ensure that the workspace exists.
            await Utils.ensureDir( wsPath );

            // Execute the build action.
            let result = await Utils.exec( cmd, args, wsPath, env );

            Log.info('Build complete: %s/%s/%s', account, repo, branch );

            // Emit a content build event.
            let event = { info, commits };
            server.emit('content-build', event );

            // Notify of changes to build targets.
            if( commits.length > 0 ) {

                // Read workflow target descriptors from the last non-empty
                // line of the build result. 
                result   = result.filter( s => s.trim().length > 0 );
                let json = result[result.length - 1];
                try {
                    let targets = JSON.parse( json );
                    targets.forEach( target => {
                        let { name, branch } = target;
                        let buildInfo = core.makeBuildInfo( account, name, branch );
                        server._notifyContentUpdate( buildInfo, 'internal');
                    });
                }
                catch( e ) {
                    if( e.name == 'SyntaxError' ) {
                        Log.error('Error parsing build result: %s', json );
                    }
                    else {
                        Log.error('Error notifying build targets', e );
                    }
                }
            }
        }
        catch( e ) {
            Log.error('Error building %s/%s/%s', account, repo, branch, e );
        }
        return true;
    }

    // Return a run queue for pending builds.
    return opqueue('sh.locomote.builder', info => doBuild( info ) );
}

exports.start = start;
