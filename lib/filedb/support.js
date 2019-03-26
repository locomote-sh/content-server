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

const Git = require('./git');

const Log = require('log4js').getLogger('filedb');

exports.make = function( scope ) {

    /**
     * A function to print JSON to an output stream.
     * @param outs  A writeable output stream.
     * @param data  An object to write to the stream.
     */
    function jsonPrint( outs, data ) {
        outs.write( JSON.stringify( data ) );
        outs.write('\n');
    }

    /**
     * Annotate pipeline results.
     * Adds commit and auth group info to the step result returned by a pipeline.
     */
    function annotateResult( vars, result ) {
        const { commit, ctx: { auth: { group } } } = vars;
        result.commit = commit;
        result.group  = group;
        return result;
    }

    /**
     * Get the current commit on a branch of a repo.
     */
    async function getCurrentCommit( ctx ) {
        const { repoPath, branch } = ctx;
        const { id } = await Git.readCurrentCommit( repoPath, branch );
        return id;
    }

    return {
        jsonPrint,
        annotateResult,
        getCurrentCommit
    };

}
