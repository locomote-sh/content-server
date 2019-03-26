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

/// Check for any incompleted workflow build steps.
async function run( server, branchdb ) {

    // A cache of source branch commits. The cache key is a target branch key
    // (i.e. account/repo/branch) and the value is an object whose keys are
    // source branch names, and whose values are the commit hash of the source
    // branch that was used to build the current version of the host (target)
    // branch.
    const sourcesCache = {};

    /**
     * Get the commit hash of a source branch that a target branch was built
     * from.
     * @param sourceInfo    Info (account/info/branch) on the source branch.
     * @param targetKey     The repo key of a target branch.
     * @return A commit hash, or undefined if the specified source hasn't
     * been used to build the specified target.
     */
    async function getSourceBranchCommit( sourceInfo, targetKey ) {
        let sourceKey = `${sourceInfo.repo}#${sourceInfo.branch}`;
        // Check for a previously cached result.
        let sources = sourcesCache[targetKey];
        if( sources ) {
            return sources[sourceKey];
        }
        // Parse the target key.
        let targetInfo  = server._parseBuildKey( targetKey );
        let repoPath    = targetInfo.absPath;
        let branch      = targetInfo.branch;
        // Read the sources.json file from the target branch.
        try {
            // TODO This can all be read via the manifest using json+link
            let sources = await Git.readFileAtBranch(
                repoPath, branch, '_locomote/sources.json', true )
            let json = JSON.parse( sources );
            // Update the cache and return the result.
            sourcesCache[targetKey] = sources;
            return sources[sourceKey];
        }
        catch( e ) {
            Log.warn('No sources.json found for %s', targetKey );
            return {};
        }
    }

    // Construct a list of buildable source branches which need to be built.
    // A source branch needs to be built if the commit hash for that branch in its
    // target branch doesn't match the source branch's current commit.
    // Source/target commit discrepencies should only exist because the server
    // process was previously stopped whilst outstanding builds were queued; the
    // purpose of this procedure is to ensure consistent build state after a restart.
    Log.debug('Listing buildable branches...');
    let buildable = branchdb.listBuildable();

    Log.debug('Found %d buildable branches...', buildable.length );
    let sources = await Promise.all( buildable.map( async ( item ) => {
        try {
            // Parse build key and read branch info.
            let source = server._makeBuildInfo( item.account, item.repo, item.branch );
            let path   = info.absPath;
            let branch = info.branch;
            // Read current commit for the branch.
            Log.debug('Reading commit info for %s...', info.key );
            let { commit } = await Git.getCurrentCommitInfo( path, branch );
            return { source, commit };
        }
        catch( e ) {
            // This can be caused because the source branch doesn't exist yet,
            // and so can't be built. Return false to indicate this.
            return false;
        }
    }));

    // Filter out false items, indicating non-existent branches.
    sources = sources.filter( item => !!item );

    // Process the valid sources.
    sources = await Promise.all( sources.map( item => {
        let { source } = item;
        Log.debug('Listing workflow targets for %s...', source.key );
        let targets = branchdb.listWorkflowTargets( source.key );
        return Promise.all( targets.map( async ( target ) => {
            Log.debug('Reading source branch commit for %s#%s -> %s...',
                source.repo, source.branch, target );
            let sourceCommits = await getSourceBranchCommit( source, target );
            item.current = sourceCommits.reduce( ( current, commit ) => {
                return current && commit == item.commit;
            }, true )
            item.targets = targets;
            return item;
        }));
    }));

    // Pending builds are all sources whose build targets aren't fully
    // up to date.
    let pending = sources.filter( item => !item.current )
    
    // Build a set of build targets of all pending items.
    let targets = pending.reduce( ( targets, item ) => {
        return item.targets.reduce( ( targets, key ) => {
            targets[key] = true;
            return targets;
        }, targets );
    }, {} );

    // Filter out any pending builds which are in the set of pending
    // build targets (these will be automatically built when their
    // source is built).
    pending = pending.filter( item => !targets[item.source.key] );

    // Queue the pending build.
    Log.debug('Queueing %d pending builds...', pending.length );
    pending.forEach( item => server._buildQueue( item.source ) );
}

exports.run = run;
