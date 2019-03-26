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

const TT = require('@locomote.sh/tinytemper');

const Log = require('log4js').getLogger('httpapi');

// Read content from a file db result.
function readContent( result ) {
    return new Promise( ( resolve, reject ) => {
        const ins = result.readable();
        const buffer = [];
        ins.on('data', data => buffer.push( data ) );
        ins.on('end',  () => {
            let content = Buffer.concat( buffer ).toString();
            resolve( content );
        });
        ins.on('error', reject );
    });
}

async function sendDynamicResult( req, res, result ) {
    // TODO: Allow the template engine to use to be defined
    // in the repo manifest; for now, default to tinytemper.
    try {
        let content = await readContent( result );
        content = TT.eval( content, req.query );
        res.set('Content-Type', result.mimeType );
        res.end( content );
    }
    catch( e ) {
        res.sendStatus( 500 );
        Log.error( req.originalUrl, e );
    }
}

module.exports = sendDynamicResult;
