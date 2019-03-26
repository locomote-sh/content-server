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

const Path = require('path');
const singleton = require('../async').cachingSingleton({ maxAge: 60000 });
const Log = require('log4js').getLogger('httpapi/errors');

/// Mask parts of an error code with x.
function maskCode( code, offset ) {
    return code.substring( 0, offset )+'xxx'.substring( 0, 3 - offset );
}

/// Make an error page handler.
function make( filedb, cneg ) {

    /**
     * Try to find an error page path for the specified request context and error code.
     * @param ctx   A request context.
     * @param req   A HTTP request.
     * @param code  An HTTP error code.
     */
    async function findErrorPageForCode( ctx, req, code ) {
        try {
            code = ''+code;
            let fileInfo;
            for( let i = 3; i > -1; i-- ) {
                // Make a modified code which includes the wildcard.
                let mask = maskCode( code, i );
                // Generate a path for the current code, in errors/xxx format.
                let path = Path.join('errors', code );
                let exists = false;
                // Let the content negotiator modify the path.
                path = await cneg.pathForRequest( ctx, req, path );
                if( path ) {
                    exists = await filedb.exists( ctx, path );
                }
                // If no match then try a path in errors/xxx.html format.
                if( !exists ) {
                    path += '.html';
                    exists = await filedb.exists( ctx, path );
                }
                // If file info returned then an error page exists at the specified
                // path, so return that path.
                if( exists ) {
                    return path;
                }
            }
        }
        catch( err ) {
            Log.error( err );
            return undefined;
        }
    }

    return {
        getErrorPageForCode: async ( ctx, req, code ) => {
            let cnegKey = await cneg.contextKeyForRequest( ctx, req );
            let opID = `getErrorPageForCode:${cnegKey}:${code}`;
            return singleton( opID, () => findErrorPageForCode( ctx, req, code ) );
        }
    }
}

exports.make = make;
