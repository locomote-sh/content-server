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

const TT    = require('@locomote.sh/tinytemper');
const spawn = require('child_process').spawn;

const Duplex = require('stream').Duplex;

const Log = require('log4js').getLogger('search/git');

// TODO: Using stream.Transform here should greatly simplify the implementation.
class GitStream extends Duplex {
    // Construct a new pipeline data stream.
    constructor( processor = (item => item) ) {

        let _buffer = '';

        super({
            readableObjectMode: true,
            // Write data to the stream.
            write: function( chunk, encoding, callback ) {
                if( encoding == 'buffer' ) {
                    _buffer += chunk.toString();
                }
                else {
                    _buffer += chunk;
                }
                let lines = _buffer.split('\n');
                let i = 0;
                while( i < lines.length - 1 ) {
                    let line = lines[i++].trim();
                    if( line.length > 0 ) {
                        let obj = this.processor( line );
                        this._push( obj );
                    }
                }
                _buffer = lines[i];
                callback();
            },
            read: function( size ) {
                // Setup a new queue.
                let queue = this._queued;
                this._queued = [];
                // Unpause the stream.
                this._paused = false;
                // Replay queued objects. Note that some of these may end
                // up back on the new queue if push() returns false.
                queue.forEach( obj => this._push( obj ) );
            },
            final: function( callback ) {
                // At end of stream, write a newline to the buffer to flush
                // out any remaining data.
                this._write('\n', undefined, () => {
                    this._push( null );
                    callback();
                });
            }
        });
        // The line processor.
        this.processor = processor;
        // Flag + queue for _push + _read functions.
        this._paused = false;
        this._queued = [];
    }
    _push( obj ) {
        // Contract for Readable.read + Readable.push says to push objects
        // until push() returns false, in which case nothing should be pushed
        // again until after the read() method is called.
        if( this._paused ) {
            // Readable stream is paused, so queue presented objects.
            this._queued.push( obj );
        }
        else {
            // Readable stream is not paused so push object through.
            this._paused = !this.push( obj );
        }
    }
}

/**
 * Escape command line arguments by applying URL escaping; this is to avoid problems
 * with arguments containing spaces, semicolons etc.
 */
function escapeArgs( args ) {
    for( var name in args ) {
        var arg = args[name];
        if( Array.isArray( arg ) ) {
            // List arguments are converted to space separated string
            // of escaped values.
            arg = arg.map( escape ).join(' ');
        }
        else {
            arg = escape( arg );
        }
        args[name] = arg;
    }
    return args;
}

/**
 * Execute a named command with the specified arguments.
 * Returns a promise resolving to the command's stdout. The stdout
 * is parsed into an array of output lines.
 * @param cwd           The working directory.
 * @param command       The name of the command template to execute.
 * @param params        A list of command template parameters.
 * @param outs          A stream to write the command's stdout to.
 * @param env           An optional set of environment variables.
 */
function exec( cwd, command, params, outs, env ) {
    return new Promise( ( resolve, reject ) => {
        // Lookup the command template.
        let template = Commands[command];
        if( !template ) {
            throw new Error(`Bad command template name: ${command}`);
        }
        // Generate the command and arguments.
        let [ cmd, ...args ] = TT.eval( template, escapeArgs( params ) )
            .trim()
            .split(/\s+/g)
            .map( unescape );
        // Spawn the command.
        let proc = spawn( cmd, args, { cwd, env });
        // Pipe stdout to the out stream.
        if( outs ) {
            proc.stdout.pipe( outs );
        }
        // Pipe stderr to its buffer.
        proc.stderr.on('data', data => Log.debug('stderr %s %s: %s', cmd, args.join(' '), data.toString() ) );
        // Handle errors.
        proc.on('error', e => {
            if( outs ) {
                outs.error( e );
            }
            reject( e );
        });
        // Make sure stdout is ended.
        proc.on('close', code => {
            if( outs ) {
                outs.end();
            }
            resolve( code );
        });
    });
}

// Format for output from the CurrentCommit command (see below).
const CommitLogFormat = '%h %ct %ce %s';

// Command line templates.
const Commands = {
    // https://stackoverflow.com/q/5167957/8085849
    'TestForBranch':                "git rev-parse --verify {branch}",
    'CurrentCommit':                "git log --pretty=format:{format} -n 1 {branch}",
    // List all commit hashes on current branch since a reference commit.
    'ListCommitHashesSinceCommit':  "git rev-list --abbrev-commit {since}..HEAD",
    'ListCommits':                  "git log {branch} --date-order --pretty={format}",
    // See http://stackoverflow.com/a/424142 for explanation.
    'ListUpdatesInCommit':          "git diff-tree --root -r {commit}",
    'ListUpdatesSinceCommit':       "git diff --name-status {since} {branch}",
    'ListAllTrackedFiles':          "git ls-tree -r --name-only --full-tree {ref}",
    'IsValidCommit':                "git cat-file commit {commit}"
};

/// Format commit information returned by git -log
function formatCommitInfo( line ) {
    // Result is in format e.g. d748d93 1465819027 committer@email.com A commit message
    // First field is the truncated hash; second field is a unix timestamp (seconds
    // since epoch); third field is the committer email; subject is everything after.
    let fields = line.match(/^([0-9a-f]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if( fields ) {
        return {
            id:         fields[1],
            commit:     fields[1],
            date:       new Date( Number( fields[2] ) * 1000 ),
            committer:  fields[3],
            subject:    fields[4]
        };
    }
    return false;
}

/**
 * Return information on the current (latest) commit in the specified repo directory.
 * @param repoDir   The location of the repository to query.
 * @param branch    The branch to query.
 * Returns an object with the following properties:
 * - commit:    The commit hash (in short format);
 * - date:      A Date object with the date of the commit.
 * - subject:   The commit message.
 */
async function getCurrentCommitInfo( repoDir, branch ) {
    let result = false;
    let code = await exec( repoDir, 'TestForBranch', { branch });
    if( code == 0 ) {
        let outs = new GitStream();
        outs.on('data', line => {
            result = formatCommitInfo( line );
        });
        let format = CommitLogFormat;
        await exec( repoDir, 'CurrentCommit', { branch, format }, outs );
    }
    return result;
}

/**
 * Get the hash of the latest commit on the specified repo / branch.
 */
async function getCurrentCommitHash( repoDir, branch ) {
    let info = await getCurrentCommitInfo( repoDir, branch );
    return info.commit;
}

/**
 * Return a list of all commit hashes in repo since a reference commit.
 */
function listCommitHashesSinceCommit( repoDir, since, branch ) {
    let outs = new GitStream('commit');
    if( since ) {
        exec( repoDir, 'ListCommitHashesSinceCommit', { since }, outs );
    }
    else {
        exec( repoDir, 'ListCommits', { branch, format: '%h' }, outs );
    }
    return outs;
}

/**
 * Git file status flags:
 * ' ' = unmodified
 *  M = modified
 *  A = added
 *  D = deleted
 *  R = renamed
 *  C = copied
 *  U = updated but unmerged
 */
const UpdateTypes = {
    ' ': 'unmodified',
    'M': 'modified',
    'A': 'added',
    'D': 'deleted',
    'R': 'renamed',
    'C': 'copied',
    'U': 'unmerged'
}

/**
 * Return a list of the files updates in a specified commit.
 */
function listUpdatesInCommit( repoDir, commit ) {
    let outs = new GitStream('data', line => {
        // The outputs arg is an array of lines; lines are an array of lines
        // of output from the git command, where the first line is the commit
        // being examined, and each following line looks like the following:
        //
        //      :000000 100644 0000..<snip>..0000 285d..<snip>..00776 A	path/to/file.txt
        //
        // We are only interested in the last two fields of each line.
        let [ , flag, path ] = /^:\d+\s\d+\s\w+\s\w+\s(\w+)\s+(.*)$/.exec( line );
        let status = UpdateTypes[flag];
        // Return the result.
        return { status, path };
    });
    exec( repoDir, 'ListUpdatesInCommit', { commit }, outs );
    return outs;
}

/**
 * List all updates made to a repo since a reference commit.
 */
async function listUpdatesSinceCommit( repoDir, since, branch ) {
    // Create the result stream without a processor; we'll provide this
    // later once we know which command will be used.
    let outs = new GitStream();
    // Check whether we have a valid since commit.
    if( !since ) {
        return false;
    }
    try {
        let code = await exec( repoDir, 'IsValidCommit', { commit: since });
        if( code == 0 ) {
            // Have a valid since commit, so list just those updates
            // since the commit.
            outs.processor = ( line ) => {
                // Line is in format: <flag> <path>
                let [ flag, path ] = line.split(/\s+/);
                let status = UpdateTypes[flag];
                return { status, path };
            };
            exec( repoDir, 'ListUpdatesSinceCommit', { since, branch }, outs );
        }
        else {
            // No valid since commit, so list all updates on branch.
            let status = UpdateTypes['M'];
            // Each result lines specifies a file path.
            outs.processor = ( line ) => {
                return { status, path: line };
            };
            exec( repoDir, 'ListAllTrackedFiles', { ref: branch }, outs );
        }
    }
    catch( e ) {
        outs.error( e );
    }
    return outs;
}

exports.getCurrentCommitInfo        = getCurrentCommitInfo;
exports.getCurrentCommitHash        = getCurrentCommitHash;
exports.listCommitHashesSinceCommit = listCommitHashesSinceCommit;
exports.listUpdatesInCommit         = listUpdatesInCommit;
exports.listUpdatesSinceCommit      = listUpdatesSinceCommit;
