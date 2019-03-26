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

const spawn = require('child_process').spawn;

/**
 * Execute a git command and stream the result.
 * @param cwd   The command's working directory.
 * @param args  The git command's arguments.
 * @param outs  A writeable stream. The command's stdout is
 *              piped to this stream.
 * @param env   Optional environment variables.
 * @return A promise which resolves to the command's exit
 * code once the command completes.
 */
function stream( cwd, args, outs, env ) {
    return new Promise( ( resolve, reject ) => {
        let proc = spawn('git', args, { cwd, env });
        proc.stdout.pipe( outs );
        proc.on('error', reject );
        proc.on('close', resolve );
    });
}

/**
 * Execute a git command.
 * @param cwd   The command's working directory.
 * @param args  The git command's arguments.
 * @param env   Optional environment variables.
 * @return A promise resolving to an object with the command exit
 * code and all data written to the stdout and stderr streams by
 * the command.
 */
function exec( cwd, args, env ) {
    return new Promise( ( resolve, reject ) => {
        let proc = spawn('git', args, { cwd, env });
        let stdout = '', stderr = '';
        proc.stdout.on('data', data => stdout += data.toString() );
        proc.stderr.on('data', data => stderr += data.toString() );
        proc.on('error', error => reject({ error }) );
        proc.on('close', code  => resolve({ code, stdout, stderr }) );
    });
}

const LogFormat = '%h %ct %ce %s';

/**
 * Parse the result returned by a git log command using the standard
 * log format (see above).
 */
function parseLogResult({ error, code, stdout, stderr }) {
    // Check for error conditions.
    if( error ) {
        throw error;
    }
    if( code !== 0 ) {
        throw new Error(`${code}: ${stderr}`);
    }
    if( !stdout ) {
        // Undefined result indicates no info available.
        return undefined;
    }
    // Parse and return the result.
    // Result is in format e.g. d748d93 1465819027 committer@email.com A commit message
    // First field is the truncated hash; second field is a unix timestamp (seconds
    // since epoch); third field is the committer email; subject is everything after.
    let fields = stdout.match(/^([0-9a-f]+)\s+(\d+)\s+(\S+)\s+(.*)/);
    return {
        id:         fields[1],
        commit:     fields[1],
        date:       new Date( Number( fields[2] ) * 1000 ),
        committer:  fields[3],
        subject:    fields[4]
    };
}

/**
 * Read the current HEAD commit info for a branch of a content repo.
 * @param repoDir   A path to a content repository.
 * @param branch    A branch name.
 * @return A commit info object with the following properties:
 *          { id, commit, date, committer, subject }
 */
async function readCurrentCommit( repoDir, branch ) {
    // Execute the git command.
    let args = ['log',`--pretty=format:${LogFormat}`,'-n','1', branch ];
    let result = await exec( repoDir, args );
    return parseLogResult( result );
}

/**
 * Read the current commit of a file (i.e. the commit the file was last modified
 * in).
 * @param repoDir   A path to a content repository.
 * @param path      A file path, relative to the repo root.
 * @param branch    A branch name.
 * @return A commit info object with the following properties:
 *          { id, commit, date, committer, subject }
 */
async function readCurrentCommitForFile( repoDir, path, branch ) {
    let args = ['log',`--pretty=format:${LogFormat}`,'-n','1', branch, '--', path ];
    let result = await exec( repoDir, args );
    return parseLogResult( result );
}

/**
 * Test if a commit hash or name is valid for a repository.
 * @param repoDir   A path to a content repository.
 * @param commit    A commit hash.
 * @return Returns true if the commit is valid.
 */
async function isValidCommit( repoDir, commit ) {
    // Execute the git command.
    let { code } = await exec( repoDir, ['cat-file','commit', commit ]);
    return code == 0;
}

/**
 * List all tracked files at a specified commit.
 * @param repoDir   A path to a content repository.
 * @param commit    A commit hash.
 * @param outs      A writeable stream; the list of files is written
 *                  to this stream.
 * @return A promise which resolves to the command's exit code once
 * the command completes.
 */
function listAllFilesAtCommit( repoDir, commit, outs ) {
    return stream(
        repoDir,
        ['ls-tree','-r','--name-only','--full-tree', commit ],
        outs );
}

/**
 * List all modifications to tracked files since a reference commit.
 * @param repoDir   A path to a content repository.
 * @param commit    A commit hash.
 * @param since     A reference commit hash.
 * @param outs      A writeable stream; the path and status of every
 *                  modified file is written to this stream.
 * @return A promise which resolves to the command's exit code once
 * the command completes.
 */
function listChangesSince( repoDir, commit, since, outs ) {
    return stream(
        repoDir,
        ['diff','--name-status', since, commit ],
        outs );
}

/**
 * Generate a zip archive containing the contents of specified files
 * at a specified commit.
 * @param repoDir   A path to a content repository.
 * @param commit    A commit hash.
 * @param files     A list of file paths to include in the archive.
 * @param outs      A writeable stream; the path and status of every
 *                  modified file is written to this stream.
 * @return A promise which resolves to the command's exit code once
 * the command completes.
 */
function zipFilesInCommit( repoDir, commit, files, outs ) {
    return stream(
        repoDir,
        ['archive','--format=zip', commit ].concat( files ),
        outs );
}

module.exports = {
    readCurrentCommit,
    readCurrentCommitForFile,
    isValidCommit,
    listAllFilesAtCommit,
    listChangesSince,
    zipFilesInCommit
}
