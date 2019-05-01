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
const FS            = require('fs');
const Git           = require('../git');
const Path          = require('path');
const { spawn }     = require('child_process');
const { opqueue }   = require('../async');
const Log           = require('log4js').getLogger('builder');


/**
 * Execute a build command.
 * @param cmd       The path to the command to execute.
 * @param args      An array of command arguments.
 * @param cwd       The command's working directory.
 * @param env       The command's runtime environment variables.
 * @param logFile   The path to a file to redirect the command's output to.
 */
async function exec( cmd, args, cwd, env, logFile ) {
    // Open the log file in append mode.
    const logOut = FS.createWriteStream( logFile, { flags: 'a' });
    try {
        // Schedule the command.
        const result = await new Promise( ( resolve, reject ) => {
            // Spawn the command.
            const proc = spawn( cmd, args, { cwd, env });
            // Pipe all output to the log file.
            proc.stdout.pipe( logOut );
            proc.stderr.pipe( logOut );
            // Completion handlers.
            proc.on('error', reject );
            proc.on('close', resolve );
        });
        // Return the command's exit code.
        return result;
    }
    finally {
        // Ensure log file is closed after all processing has completed.
        try {
            logOut.end();
        }
        catch( e ) {
            Log.error('Closing file %s', logFile, e );
        }
    }
}

function start( core, manifests, branchdb, settings, server ) {

    const {
        // The build workspace directory.
        workspaceHome,
        // An object mapping build configuration IDs to build configuration
        // module names of file paths. Individual repos can specify a build
        // configuration using { build: { configID } }.
        configurations = {},
        // A flag indicating whether builds are disabled.
        disabled = false,
        // Commit notification listener host and port.
        updatesListener
    } = settings;

    if( disabled ) {
        Log.warn('Build queue disabled');
    }

    /**
     * Build and publish content in an updated repo.
     * @param info  Repo info parsed from the build key.
     */
    async function doBuild( info ) {

        const { absPath, key, account, repo, branch } = info;

        try {

            Log.info('Building %s/%s/%s', account, repo, branch );

            // Read the manifest for the source branch.
            const manifest = await manifests.load( absPath, branch );

            // Update public and buildable branch info for the repo.
            branchdb.updateBranchInfo( account, repo, manifest );

            // If builds disabled then don't continue.
            if( disabled ) {
                return;
            }
            
            // The source repo origin.
            const origin    = core.makeContentRepoPath( account, repo );
            // The account's workspace directory.
            const buildDir  = Path.join( workspaceHome, account );
            // The build environment.
            const { env }   = process;
            // Read build configuration information from the manifest.
            const {
                build: {
                    configID,
                    configFile
                } = {}
            } = manifest;

            // Use npx as the main build command; the actual build script
            // is specified in the command args.
            const buildCommand = 'npx';

            // Build arguments.
            const args = ['locomote','build']; // Locomote build tool.
            // Add build configuration.
            if( configID ) {
                const configMod = configurations[configID];
                if( !configMod ) {
                    throw new Error(`Bad build configuration ID: ${configID}`);
                }
                args.push('--config');
                args.push( configMod );
            }
            if( configFile ) {
                args.push('--config');
                args.push( configFile );
            }
            // Send a notification after a commit.
            args.push('-EsendUpdatesNotification=true');
            args.push(`-EupdatesListenerHost=${updatesListener.host}`);
            args.push(`-EupdatesListenerPort=${updatesListener.port}`);
            // The build action to execute.
            args.push(`commit:${branch}`);
            // The origin of the repo being built.
            args.push( origin );

            // The build log file.
            const logFile = Path.join( buildDir, 'build.log');

            // Ensure that the workspace exists.
            await Utils.ensureDir( buildDir );

            // Execute the build command.
            Log.debug('%s %s', buildCommand, args );
            const code = await exec( buildCommand, args, buildDir, env, logFile );

            // If build command completed successfully then emit a content build event.
            if( code === 0 ) {

                Log.info('Build complete %s', key );

                // Emit a content build event.
                const event = { info, commits };
                server.emit('content-build', event );

            }
            else Log.warn('Build failure %s; exit code %d', key, code );
        }
        catch( e ) {
            Log.error('Error building %s', key, e );
        }
        return true;
    }

    // Return a run queue for pending builds.
    return opqueue('sh.locomote.builder', doBuild );
}

exports.start = start;
