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
const Utils = require('@locomote.sh/utils');
const Path  = require('path');

const FS = require('fs');
const { spawn } = require('child_process');
const { promisify, format } = require('util');

const _stat = promisify( FS.stat );

// TODO: Branch name is a user selected value, so opens up a possible attack vector;
// e.g. if someone attempted something that passed a branch name like ";rm -Rf /" to
// one of the commands below; need to check (1) git imposed restrictions on branch
// names; (2) the different ways that a branch name can be passed into the code
// below; (3) possible ways to sanitize branch names before being used in code below
// (or in related code, e.g. creating a build workspace etc.);

// Format used for printing commit info.
// Fields are: Commit hash, commit time, committer email, subject.
// Value is URI encoded; unencoded value is '%h %ct %ce %s'
const CommitLogFormat = '%25h%20%25ct%20%25ce%20%25s';

// Command line templates.
var Commands = {
    'CurrentCommit':                `git log --pretty=format:${CommitLogFormat} -n 1 {branch}`,
    'ListAllTrackedFilesAtCommit':  "git ls-tree -r --name-only --full-tree {commit}",
    'ListUpdatedFilesSinceCommit':  "git diff --name-status {since} {ref}",
    'ListCommits':                  "git log --date-order --pretty={format} --branches=*",
    // List all commit hashes on current branch since a reference commit.
    'ListCommitHashesSinceCommit':  "git rev-list --abbrev-commit {since}..HEAD",
    // See http://stackoverflow.com/a/424142 for explanation.
    'ListFilesInCommit':            "git diff-tree --root -r {commit}",
    'ReadFileAtCommit':             "git show {commit}:{path}",
    'ZipFilesInCommit':             "git archive --format=zip -o {zip} {commit} {files}",
    'LastCommitForFile':            `git log --pretty=format:${CommitLogFormat} -n 1 {branch} -- {file}`,
    'Status':                       "git status",
    'IsBare':                       "git rev-parse --is-bare-repository",
    'Pull':                         "git pull",
    'Push':                         "git push -u origin {branch}",
    // git clone reports progress to stderr; -q switches to quite mode.
    'Clone':                        "git clone -q {ref} {dir}",
    'Init':                         "git init --bare",
    'InitWithTemplate':             "git init --bare --template={template}",
    //'CheckoutNewBranch':            "git checkout -b {branch}",
    'CheckoutRemoteBranch':         "git checkout -B {branch} origin/{branch}",
    // Following all taken from https://stackoverflow.com/a/13969482/8085849 and comments.
    'CheckoutNewBranch':            "git checkout --orphan {branch}",
    'ClearBranch':                  "git rm --cached -r .",
    'PrintCurrentBranch':           "git rev-parse --abbrev-ref HEAD",
    'RemoveUntrackedFiles':         "git clean -fd",
    'Add':                          "git add -A .",
    'Commit':                       "git commit -m {message}",
    'CommitWithAuthor':             "git commit -m {message} --author={author}",
    'DiffIndex':                    "git diff-index --quiet HEAD",
    'IsValidCommit':                "git cat-file commit {commit}",
    // List local branches in a repo.
    // Adapted from comment on http://stackoverflow.com/a/18359250
    'ListBranches':                 "git for-each-ref --format=%(refname:short):%(objectname) refs/heads/",
    // List all branches in a repo, including remotes.
    'ListAllBranches':              "git branch -a",
    // Do a hard reset to a specific commit
    'HardReset':                    "git reset --hard {commit}",
    // Check for staged changes.
    // See https://stackoverflow.com/a/5737794/8085849 and other comments on the
    // same question.
    // See https://stackoverflow.com/questions/2657935/checking-for-a-dirty-index-or-untracked-files-with-git/2659808#2659808
    'CheckForStagedChanges':        "git status --porcelain",
    'ListFileHashes':               "git ls-files -s {pattern}",
    'ListAllFilesOnBranch':         "git ls-tree -r {branch}",
    // https://stackoverflow.com/q/5167957/8085849
    'TestForBranch':                "git rev-parse --verify {branch}"
};

var Log = require('log4js').getLogger('git');

/**
 * Execute a named command with the specified arguments.
 * Returns a promise resolving to the command's stdout. The stdout
 * is parsed into an array of output lines.
 * @param cwd           The working directory.
 * @param cmdline       The command to execute, followed by its arguments.
 * @param returnCode    A flag indicating whether to return the command's exit code,
 *                      rather than its stdout.
 * @param binary        A flag indicating that the command's output is binary. The
 *                      function attempts to concatentate text output into a single
 *                      string, this flag can be used to disable that behaviour.
 * @param stream        An optional writeable stream; if provided then then the
 *                      command's stdout is piped to it. When used, the command will
 *                      always return its exit code rather than stdout (i.e. as if
 *                      the returnCode argument was true).
 * @param env           An optional set of environment variables.
 */
function exec( cwd, cmdline, returnCode, binary, stream, env ) {
    return new Promise( ( resolve, reject ) => {
        if( !Array.isArray( cmdline ) ) {
            // Split and unescape command line arguments.
            // See escapeArgs() function below.
            cmdline = cmdline.trim().split(' ').map( unescape );
        }
        Log.debug('%s> %s', cwd, cmdline.join(' ') );
        let cmd     = cmdline[0];
        let args    = cmdline.slice( 1 );
        let stdout  = [], stderr = [];
        let proc    = spawn( cmd, args, { cwd, env });
        if( stream ) {
            returnCode = true;
            proc.stdout.pipe( stream );
        }
        else proc.stdout.on('data', ( data ) => {
            stdout.push( data );
        });
        proc.stderr.on('data', ( data ) => {
            stderr.push( data );
        });
        proc.on('error', reject );
        proc.on('close', ( code ) => {
            if( returnCode ) {
                resolve( code );
            }
            else if( code != 0 ) {
                let err;
                if( stderr.length > 0 ) {
                    err = Buffer.concat( stderr ).toString();
                    Log.trace('stderr: %s', err );
                }
                else if( stdout.length > 0 ) {
                    err = Buffer.concat( stdout ).toString();
                    Log.trace('stdout: %s', err );
                }
                else {
                    err = format('%s exit %d', cmdline.join(' '), code );
                }
                reject( err );
            }
            else if( binary ) {
                // Output is binary, so don't process further.
                resolve( Buffer.concat( stdout ) );
            }
            else {
                stdout = Buffer.concat( stdout ).toString();
                Log.trace('stdout: %s', stdout );
                // Split output into separate lines, filter empty lines.
                let result = stdout
                    .split('\n')
                    .filter( line => line.length > 0 );
                resolve( result );
            }
        });
    });
}

// Escape command line arguments by applying URL escaping; this is to avoid problems
// with arguments containing spaces, semicolons etc.
function escapeArgs( args ) {
    for( let name in args ) {
        let arg = args[name];
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

// Promote command templates to command functions.
Object.keys( Commands )
.forEach( ( key ) => {
    let command = Commands[key];
    Commands[key] = ( cwd, args, returnCode, binary, stream, env ) => {
        args = escapeArgs( args );
        return exec( cwd, TT.eval( command, args ), returnCode, binary, stream, env );
    };
});

// Format commit information returned by git -log
function formatCommitInfo( lines ) {
    // Result is in format e.g. d748d93 1465819027 committer@email.com A commit message
    // First field is the truncated hash; second field is a unix timestamp (seconds
    // since epoch); third field is the committer email; subject is everything after.
    var fields = lines[0].match(/^([0-9a-f]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return {
        id:         fields[1],
        commit:     fields[1],
        date:       new Date( Number( fields[2] ) * 1000 ),
        committer:  fields[3],
        subject:    fields[4]
    };
}

/**
 * Return information on the current (latest) commit in the specified repo directory.
 * @param repoDir   The location of the repository to query.
 * @param branch    Optional branch to query.
 * @param testFor   If true then tests to see if the branch exists first, otherwise
 *                  assumes that the branch does exist but may return an error if it
 *                  doesn't. If true and the branch doesn't exist then the function
 *                  returns false.
 * Returns an object with the following properties:
 * - commit:    The commit hash (in short format);
 * - date:      A Date object with the date of the commit.
 * - subject:   The commit message.
 */
async function getCurrentCommitInfo( repoDir, branch, testFor = false ) {
    let ok = true;
    if( testFor ) {
        let code = await Commands.TestForBranch( repoDir, { branch: branch }, true );
        // TestForBranch will return 0 if the branch does exist.
        ok = (code => code == 0);
    }
    if( !ok ) {
        return false
    }
    let lines = await Commands.CurrentCommit( repoDir, { branch: branch||'' });
    if( !lines || lines.length == 0 ) {
        let msg = format('git.getCurrentCommitInfo: No commit info returned for %s %s',
            repoDir, branch||'' )
        throw new Error( msg )
    }
    return formatCommitInfo( lines );
}

/**
 * Get info on the last commit in which a specific file was updated.
 */
async function getLastUpdateCommitInfoForFile( repoDir, branch, file ) {
    if( !branch ) {
        let msg = 'git.getLastUpdateCommitInfoForFile: branch must be specified';
        throw new Error( msg );
    }
    if( !file ) {
        let msg = 'git.getLastUpdateCommitInfoForFile: file must be specified';
        throw new Error( msg );
    }
    let lines = await Commands.LastCommitForFile( repoDir, { branch: branch, file: file });
    if( !lines || lines.length == 0 ) {
        return undefined; // No commit info to return.
    }
    return formatCommitInfo( lines );
}

/**
 * Return a list of all the tracked (i.e. active) files at a specified commit.
 */
function listAllTrackedFilesAtCommit( repoDir, commit ) {
    return Commands.ListAllTrackedFilesAtCommit( repoDir, { commit: commit });
}

/**
 * Return a list, in chronological order, of all file additions to a repository.
 * The function returns a list of modified items with { type: path: commit: }
 * properties.
 *
 * TODO: The command "git log --raw --date-order --reverse --diff-filter=A" might
 * be a more efficient way to return all file additions in date order, but needs
 * to be tested. See https://stackoverflow.com/a/41338708/8085849
 */
async function listFileAdditions( repoDir, since ) {
    // List all commits in chronological order in the target repo.
    let commits = await Commands.ListCommits( repoDir, { format: '%H' });
    // Commits are returned in reverse chronological order, i.e. most recent
    // commit first, first commit last, so reverse the order.
    commits = commits.reverse();
    // If a since commit arg is specified then find the index of the
    // commit in the listed results and only return the commits since.
    if( since ) {
        // If the since commit isn't valid then return an empty array.
        var idx = commits.indexOf( since );
        commits = idx > -1 ? commits.slice( idx + 1 ) : [];
    }
    // Sequentially list files in each commit, extract additions and return
    // as a single list.
    let outputs = [];
    for( let commit of commits ) {
        outputs.push( await Commands.ListFilesInCommit( repoDir, { commit: commit }) );
    }
    // The outputs arg is an array of lines; lines are an array of lines
    // of output from the git command, where the first line is the commit
    // being examined, and each following line looks like the following:
    //
    //      :000000 100644 0000..<snip>..0000 285d..<snip>..00776 A	path/to/file.txt
    //
    // We are only interested in the last two fields of each line.
    return outputs.reduce( ( result, lines ) => {
        let commit = lines[0];
        let additions = lines.slice( 1 )
        // Parse updates into [ op, path ] tuples.
        .map( ( line ) => {
            let r = /^:\d+\s\d+\s\w+\s\w+\s(\w+)\s+(.*)$/.exec( line );
            return [ r[1], r[2] ];
        })
        // Filter the list to only include file additions.
        .filter( update => update[0] == 'A' )
        // Create an addition item.
        .map( ( update ) => {
            return {
                type:   update[0],
                commit: commit,
                path:   update[1]
            };
        });
        // Add additions to the result.
        return result.concat( additions );
    }, []);
}

/**
 * Return a map of the names of files updated since a specified commit, relative
 * to a reference commit. The result maps file names to a boolean flag specifying
 * whether the file is active or not in the reference commit (e.g. because it has
 * been deleted since the previous commit).
 * @param repoDir   The path to the git repository.
 * @param ref       A reference commit ID.
 * @param since     An optional since commit ID.
 */
async function listUpdatedFilesSinceCommit( repoDir, ref, since ) {
    try {
        // If no since commit is provided then default to listing all files on branch.
        if( since === undefined ) {
            let files = await listAllTrackedFilesAtCommit( repoDir, ref );
            return files.reduce( ( result, file ) => {
                result[file] = true;
                return result;
            }, {});
        }
        let files = await Commands.ListUpdatedFilesSinceCommit( repoDir, { ref: ref, since: since });
        // Git file status flags:
        // ' ' = unmodified
        //  M = modified
        //  A = added
        //  D = deleted
        //  R = renamed
        //  C = copied
        //  U = updated but unmerged
        return files.reduce( ( result, file ) => {
            var status = file.charAt( 0 );
            file = file.substring( 1 ).trim();
            // TODO Are renames handled correctly here? i.e. is the file path
            // here the name being renamed from (in which case code is correct),
            // or the name being renamed to (in which case this code is wrong).
            result[file] = !(status == 'D' || status == 'R');
            return result;
        }, {});
    }
    catch( err ) {
        // This can fail because the since commit isn't valid; in this case,
        // try repeating the operation without the since param.
        return listUpdatedFilesSinceCommit( repoDir, ref );
    }
}

/**
 * Read the contents of a file at a specified commit.
 * When reading binary files, set the 'binary' flag to true.
 */
async function readFileAtCommit( repoDir, commit, path, binary ) {
    let contents = await Commands.ReadFileAtCommit( repoDir, { commit, path }, false, binary );
    if( binary ) {
        // Binary content returned as a Buffer instance.
        return contents;
    }
    // Text (i.e. non-binary) contents are returned as an array of lines;
    // Rejoin lines back into a single string.
    return contents.join('\n');
}

/**
 * Read the contents of a file at the latest commit in a specified branch.
 * This is a synonym for readFileAtCommit.
 */
const readFileAtBranch = readFileAtCommit;

/**
 * Read the contents of a file at a specified commit and pipe to a writeable stream.
 */
function pipeFileAtCommit( repoDir, commit, path, stream ) {
    let args = { commit, path };
    return Commands.ReadFileAtCommit( repoDir, args, true, true, stream );
}

/**
 * Generate a zip file containing the contents of the specified file versions from
 * the specified commit.
 */
function zipFilesInCommit( repoDir, commit, files, zip ) {
    let args = { commit, files, zip };
    return Commands.ZipFilesInCommit( repoDir, args );
}

/**
 * Test whether an initialized git repository exists at the specified path.
 * Returns an object with isDir and isRepo properties, specifying respecitively
 * whether a directory exists at the specified path, and whether it contains a git
 * repository.
 */
async function isRepoAtPath( repoDir, isBare ) {
    let result = { isDir: false, isRepo: false };
    try {
        let stats = await _stat( repoDir );
        if( stats.isDirectory() ) {
            result.isDir = true;
            if( isBare ) {
                let lines = await Commands.IsBare( repoDir );
                result.isRepo = ('true' == lines[0]);
            }
            else {
                await Commands.Status( repoDir );
                result.isRepo = true;
            }
        }
    }
    catch( e ) {
        if( e.code != 'ENOENT' ) {
            throw e;
        }
    }
    return result;
}

/** Refresh a repository by pulling updates from its remote. */
function pull( repoDir ) {
    return Commands.Pull( repoDir );
}

/** Push a local branch to remote. */
function push( repoDir, branch ) {
    return Commands.Push( repoDir, { branch: branch });
}

/**
 * Clone a repository from a remote.
 * Note that the repository is cloned into the directory at repoDir, and *not* into
 * a sub-directory of repoDir named after the repository.
 */
async function clone( repoDir, ref, branch ) {
    let parentDir = path.dirname( repoDir );
    await Utils.ensureDir( parentDir );
    let dir = path.basename( repoDir );
    await Commands.Clone( parentDir, { ref: ref, dir: dir });
    if( branch ) {
        await checkout( repoDir, branch );
    }
}

/** Initialize a bare repository at the specified path. */
function init( repoDir, template ) {
    if( template ) {
        return Commands.InitWithTemplate( repoDir, { template: template });
    }
    else {
        return Commands.Init( repoDir );
    }
}

/** Checkout a branch. */
async function checkout( repoDir, branch ) {
    // Different forms of the checkout command need to be used, depending
    // on whether the branch already exists on the remote or not; so start
    // by listing all available branches, and check whether a branch name
    // in the form remotes/origin/{branch} exists.
    let stdout = await Commands.ListAllBranches( repoDir );
    let remoteBranch = 'remotes/origin/'+branch;
    let found = stdout.some( ( line ) => {
        return line.trim() == remoteBranch;
    });
    if( found ) {
        // Checkout existing branch.
        await Commands.CheckoutRemoteBranch( repoDir, { branch: branch });
    }
    else {
        // Checkout new branch and clear its contents.
        await Commands.CheckoutNewBranch( repoDir, { branch: branch });
        await Commands.ClearBranch( repoDir, {} );
        await Commands.RemoveUntrackedFiles( repoDir, {} );
    }
}

/** Add all modified files to the next commit. */
function add( repoDir ) {
    return Commands.Add( repoDir );
}

/**
 * Commit files.
 * @param repoDir   The path to the repository.
 * @param committer Committer information; an object with name and email properties.
 * @param message   The commit message.
 */
async function commit( repoDir, committer, message ) {
    // First check whether there is anything staged to be committed, otherwise
    // commit will return an error.
    let stdout = await Commands.CheckForStagedChanges( repoDir, {} );
    // If stdout is empty then there are no staged changes.
    if( stdout.join('').length == 0 ) {
        return true;
    }
    let author = `${committer.name} <${committer.email}>`;
    await Commands.CommitWithAuthor( repoDir, { message, author }, false, false, null );
    /*
    // Else there are staged changes to commit.
    let env = {
        GIT_COMMITTER_NAME:     committer.name,
        GIT_COMMITTER_EMAIL:    committer.email
    };
    return Commands.Commit( repoDir, { message }, false, false, null, env );
    */
}

/** Test if changes exist within a repo. */
async function hasChanges( repoDir ) {
    // Check if a repo has local changes. This is useful before doing a commit, as
    // git-commit will return error code 1 otherwise. See
    // http://stackoverflow.com/a/8123841
    // DEPRECATED: The commit() function has been modified to directly incorporate
    // a more reliable index check.
    let code = await Commands.DiffIndex( repoDir, {}, true );
    // NOTE: This is currently a bit of a kludge to get the system working. The
    // command -
    //
    //  git diff-index --quiet HEAD
    //
    // will output to stderr -
    // 
    //  fatal: ambiguous argument 'HEAD': unknown revision or path not in the
    //  working tree.
    //
    // with exit code 128 if invoked on a newly initialized repository with
    // nothing yet committed. (However, the command will return 0 in otherwise
    // normal circumstances, where there are no updated files). 
    // The code below interprets exit code 128 as meaning that there *are*
    // changes to commit (i.e. it assumes the above error condition); if this
    // isn't the case (e.g. because some other error condition exists) then
    // this will likely be detected and reported again by the subsequent commit
    // command.
    return code == 1 || code == 128;
}

/** Test if a commit hash exists in the specified repo. */
async function isValidCommit( repoDir, commit ) {
    let code = await Commands.IsValidCommit( repoDir, { commit: commit }, true );
    return code == 0;
}

/**
 * Test if a branch name is for a valid branch in the specified repo.
 * A synonym for isValidCommit.
 */
const isValidBranch = isValidCommit;

/**
 * Return a list of the local branches in a repository.
 * Returns a list with { branch: commit: } properties; the commit property gives the
 * hash of the latest commit to the branch.
 */
async function listBranches( repoDir ) {
    let lines = await Commands.ListBranches( repoDir, {} );
    return lines.map( ( line ) => {
        const [ branch, commit ] = line.split(':');
        return { branch, commit }
    });
}

/**
 * Return a list of all commits in a repository.
 */
async function listCommits( repoDir ) {
    let commits = await Commands.ListCommits( repoDir, { format: '%H %s' });
    return commits.map( ( commit ) => {
        let idx = commit.indexOf(' ');
        let hash = commit.substring( 0, idx );
        let subject = commit.substring( idx + 1 );
        return {
            commit:     hash,
            message:    subject
        };
    });
}

/**
 * Return a list of all commit hashes in repo since a reference commit.
 */
async function listCommitHashesSinceCommit( repoDir, since ) {
    if( since ) {
        return Commands.ListCommitHashesSinceCommit( repoDir, { since: since });
    }
    // If no since param then just return a list of all commits.
    let commits = await listCommits( repoDir );
    return commits.map( item => item.commit );
}

/**
 * Do a hard reset to a specific commit.
 */
function reset( repoDir, commit ) {
    return Commands.HardReset( repoDir, { commit: commit });
}

/**
 * List the SHA1 hashes of files in the repo.
 * @param pattern   An optional file name pattern, or list of patterns, to match.
 */
async function listFileHashes( repoDir, pattern ) {
    let lines = await Commands.ListFileHashes( repoDir, { pattern });
    // Result is formatted like:
    // 100644 43cf9548d6d27e698c0edc90c1a5ef2dea32c12c 0	README.md
    // Return a list of items with { hash: path: } properties - this is
    // to match the return format of utils.readFileHashes.
    return lines
    .map( line => {
        let r = /^\d+ (\w+) \d+\s+(.*)$/.exec( line );
        if( r ) {
            let hash = r[1];
            let path = r[2];
            return { hash, path };
        }
        return false;
    })
    .filter( line => !!line );
}

async function listAllFilesOnBranch( repoDir, branch ) {
    let lines = await Commands.ListAllFilesOnBranch( repoDir, { branch });
    // Result is formatted like:
    // 100755 blob 4b8b45b97528e4fe4b3b26ce010e0d9e3db67302	index.js
    return lines.map( line => {
        // NOTE use a regex rather than a String.split here because the
        // filename may contain spaces.
        let r = /^\d+ \w+ \w+\s(.*)$/.exec( line );
        return r && r[1];
    });
}

async function getCurrentBranch( repoDir ) {
    let lines = await Commands.PrintCurrentBranch( repoDir );
    return lines[0];
}

exports.getCurrentCommitInfo = getCurrentCommitInfo;
exports.getLastUpdateCommitInfoForFile = getLastUpdateCommitInfoForFile;
exports.listAllTrackedFilesAtCommit = listAllTrackedFilesAtCommit;
exports.listUpdatedFilesSinceCommit = listUpdatedFilesSinceCommit;
exports.listFileAdditions = listFileAdditions;
exports.readFileAtCommit = readFileAtCommit;
exports.readFileAtBranch = readFileAtBranch;
exports.pipeFileAtCommit = pipeFileAtCommit;
exports.zipFilesInCommit = zipFilesInCommit;
exports.isRepoAtPath = isRepoAtPath;
exports.pull = pull;
exports.push = push;
exports.clone = clone;
exports.init = init;
exports.checkout = checkout;
exports.add = add;
exports.commit = commit;
exports.hasChanges = hasChanges;
exports.isValidCommit = isValidCommit;
exports.isValidBranch = isValidBranch;
exports.listBranches = listBranches;
exports.listCommits = listCommits;
exports.listCommitHashesSinceCommit = listCommitHashesSinceCommit;
exports.reset = reset;
exports.listFileHashes = listFileHashes;
exports.listAllFilesOnBranch = listAllFilesOnBranch;
exports.getCurrentBranch = getCurrentBranch;
exports.exec = exec;
