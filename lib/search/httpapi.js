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

const ACM = require('../acm');
const FS  = require('fs');

const { format } = require('util');
const { fingerprint } = require('@locomote.sh/utils');
const { queue } = require('../async');
const { streamJSONFile } = require('./support');

const ResponseQueue = 'search.http.response';

const Log = require('log4js').getLogger('search/http');

/**
 * Make the search HTTP API.
 */
function make( server ) {

    /// Calculate the e-tag for a search request.
    function eTag( req ) {
        let { s, m, p } = req.query;
        let group = ACM.group( req );
        return fingerprint([ s, m, p, group ], 20 );
    }

    /**
     * The search request handler.
     * @param ctx   The request context.
     * @param req   The request.
     * @param res   The response.
     * @param cneg  A content negotiator.
     */
    async function handler( ctx, req, res, cneg ) {

        // Read repo info from request.
        let { account, repo, branch } = ctx;

        // Read search info from request.
        let { s, m, p } = req.query;

        // Prepare the response.
        res.set('Content-Type', 'application/json');
        res.set('Cache-Control','public, must-revalidate, max-age=600');
        res.set('Etag', eTag( req ) );
        let count = 0;

        try {
            // Perform the search.
            let result = await server.search( account, repo, branch, s, m, p );
            try {
                // Steam file records from the result.
                await streamJSONFile( result.file, record => {
                    // Test if the record is accessible to the current user.
                    if( ACM.accessible( req, record ) ) {
                        // Following is done on an async queue to ensure correct
                        // write ordering of rows and end of response.
                        queue( ResponseQueue, async () => {
                            // Check path is the preferred representation of the resource.
                            let path = record.path;
                            let valid = await cneg.isPreferredPathForRequest( ctx, req, path );
                            if( valid ) {
                                // Check if at start of response.
                                res.write( count == 0 ? '[' : ',' );
                                // Write the current record.
                                res.write( JSON.stringify( record ) );
                                count++;
                            }
                        });
                    }
                });
            }
            catch( err ) {
                // Can't send an error response at this stage, as data may
                // have already be written to the client.
                Log.error('Writing search result', err );
            }
            // Close the response on the queue, to ensure it occurs after all rows
            // have been written.
            queue( ResponseQueue, async () => {
                if( count == 0 ) {
                    res.end('[]'); // Empty result.
                }
                else {
                    res.end(']');
                }
            });
        }
        catch( err ) {
            Log.error('Handling search request', err );
            res.end('[]'); // Empty result.
        }
    }

    // Export search endpoint.
    return {
        endpoints: { 'search.api': handler }
    }
}

exports.make = make;
