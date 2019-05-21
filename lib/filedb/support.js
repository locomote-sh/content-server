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

    // -- Following two functions copied from @locomote.sh/utils/lib/change.js --

    /**
     * Convert a sequence of one or more octals to a string containing
     * the character equivalent.
     */
    function octalSeqToStr( octalSeq ) {
        const cps = octalSeq.split('\\').slice( 1 ).map( x => parseInt( x, 8 ) );
        return Buffer.from( cps ).toString('utf8');
    }

    /**
     * Correct a git filename presented with extended characters.
     * See https://git-scm.com/docs/git-status, third para of the "Short Format"
     * section for reference; filenames containing extended characters will
     * be presented quoted within double quotation marks (0x22) with extended
     * characters encoded as octet escape sequences.
     * This function removes the quotation marks and replaces escaped octal
     * pairs with the actual character.
     */
    function correctExtendedChars( s ) {
        if( s.charCodeAt( 0 ) == 0x22 && s.charCodeAt( s.length - 1 ) == 0x22 ) {
            return s
                // Remove surrounding quotes.
                .slice( 1, -1 )
                // Convert embedded octal sequences.
                .replace(/(\\\d\d\d)+/g, octalSeqToStr );
        }
        return s;
    }

    // --

    return {
        jsonPrint,
        annotateResult,
        getCurrentCommit,
        correctExtendedChars
    };

}
