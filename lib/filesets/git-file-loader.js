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

/**
 * An implementation of the fileset FileLoader interface that loads file
 * contents from a git repository.
 */
class GitFileLoader {

    /**
     * Create a new file loader.
     */
    GitFileLoader() {}

    /**
     * Read the git repository path from the request context.
     */
    _getRepoPath( ctx ) {
        const { repoPath } = ctx;
        if( !repoPath ) {
            throw new Error('Request context is missing repoPath');
        }
        return repoPath;
    }

    /**
     * Read the contents of the file at the specified path.
     * @param ctx       A request context.
     * @param path      The path of the file to read, relative to the base path.
     * @param version   The version of the file to read; ignored in this implementation.
     * @return Returns a promise which resolves to a Buffer containing the file's contents.
     */
    readFile( ctx, path, version ) {
        const repoPath = this._getRepoPath( ctx );
        return Git.readFileAtCommit( repoPath, version, path );
    }

    /**
     * Pipe the contents of the file at the specified path.
     * @param ctx       A request context.
     * @param path      The path of the file to read, relative to the base path.
     * @param version   The version of the file to read; ignored in this implementation.
     * @param outs      A writeable stream to pipe the contents to.
     * @return Returns a promise which resolves once the file's contents have been fully piped.
     */
    pipeFile( ctx, path, version, outs ) {
        const repoPath = this._getRepoPath( ctx );
        return Git.pipeFileAtCommit( repoPath, version, path, outs );
    }

}

module.exports = { GitFileLoader }

