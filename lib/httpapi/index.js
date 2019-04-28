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

const LocoVersion   = require('../version');

const express       = require('express');
const Acm           = require('../acm');
const Bodyparse     = require('body-parser');
const Cookieparse   = require('cookie-parser');
const Git           = require('../git');
const Path          = require('path');

const { format }    = require('util');

const Log           = require('log4js').getLogger('httpapi');

// Response handler for robots.txt requests. See issue #57.
function RobotsHandler( req, res ) {
    res.set('Content-Type','text/plain');
    res.send('User-agent: *\nDisallow:\n');
};

const sendDynamicResult = require('./dynamic');

function make( acm, cneg, filedb, branchdb, core, settings, app ) {

    // Generate an etag for a request.
    function makeETag( commit, group ) {
        return commit+'-'+group;
    }

    // Default cache control headers.
    const DefaultCacheControl = settings.get('httpAPI.cacheControl');
    // Generate cache control headers for a content response.
    function addCacheControlHeaders( headers, etag, result ) {
        // Try using cache control settings on file info, if any;
        // otherwise use the default settings.
        let cacheControl = (result && result.cacheControl)
                        || DefaultCacheControl;
        headers['Cache-Control'] = cacheControl;
        headers['Etag'] = etag;
        return headers;
    }

    function getCacheControlHeaders( etag, result ) {
        return addCacheControlHeaders( {}, etag, result );
    }

    // Generate content headers for a file content response.
    function addContentHeaders( headers, req, result ) {
        let { mimeType, path } = result;
        headers['Content-Type'] = mimeType;
        if( path ) {
            let { basePath } = req.ctx;
            headers['Content-Location'] = Path.join( basePath, path );
        }
        return headers;
    }

    // Check the If-None-Match header in a request and compare it to an etag.
    // Returns true if no match; else sends a 304 response to the client and
    // returns false.
    function ifNoneMatch( req, res, etag, result ) {
        const header = req.get('If-None-Match');
        if( header == etag ) {
            res.set( getCacheControlHeaders( etag, result ) );
            res.sendStatus( 304 ); // Not Modified
            return false;
        }
        return true;
    }

    // Send to a client a result returned from the file DB.
    async function sendFileDBResult( req, res, result ) {
        if( !result ) {
            res.sendStatus( 404, 'File not found');
            return;
        }
        const { commit, group } = result;
        const etag = makeETag( commit, group );
        if( ifNoneMatch( req, res, etag, result ) ) {
            let headers = {};
            headers = addCacheControlHeaders( headers, etag, result );
            headers = addContentHeaders( headers, req, result );
            result.send( res, headers );
        }
    }

    // Send a JSON response.
    function sendJSON( res, data ) {
        res.set('Content-Type','application/json');
        const json = JSON.stringify( data, null, 4 );
        res.end( json );
    }

    /**
     * Handle an API request error.
     */
    function handleRequestError( ctx, req, res, err ) {
        if( Acm.isAuthenticationError( err ) ) {
            const { status, message, headers } = err;
            Log.debug('Authentication error: %s', message );
            if( headers ) {
                Object.keys( headers )
                .forEach( ( header ) => {
                    res.set( header, headers[header] );
                });
            }
            return sendError( ctx, req, res, status, message );
        }
        Log.error( err );
        if( err.code == 'ENOENT' ) {
            // File not found error; can occur within the file DB for a variety
            // of reasons, including when the requested branch doesn't exist
            // yet, e.g. because no build has been done.
            res.sendStatus( 404, 'File not found');
        }
        else {
            res.sendStatus( 500 );
        }
    }

    const api = express.Router();

    if( settings.get('httpAPI.gzipEncode') ) {
        Log.debug('Using gzip response encoding');
        let compression = require('compression');
        api.use( compression() );
    }

    const PoweredBy = settings.get('httpAPI.serviceName');
    api.use( ( req, res, next ) => {
        // Set the powered by header.
        res.setHeader('X-Powered-By', PoweredBy );
        // Log an API access.
        Log.debug('%s %s', req.method, req.originalUrl );
        next();
    });

    // application/x-www-form-urlencoded
    api.use( Bodyparse.urlencoded({ extended: true }) );
    // Parse request cookies.
    api.use( Cookieparse() );

    // Submodule endpoints - modules can export these on property of httpapi.endpoints,
    // and they will be mounted on repository specific endpoints.
    const Endpoints = {};
    // Listen for services with a conforming httpapi interface.
    const HTTPAPIPattern = { httpapi: { endpoints: 'object' } };
    app.onConformingServiceBind( HTTPAPIPattern, service => {
        let { httpapi: { endpoints } } = service;
        for( let path in endpoints ) {
            Log.info('Mounting %s...', path );
            Endpoints[path] = endpoints[path];
        }
    });

    // Info page.
    api.get('/', ( req, res ) => {
        res.set('Content-Type','text/html');
        res.send(`<h1>${PoweredBy} ${LocoVersion}</h1>`);
    });

    // Robots.txt handler.
    api.get('/robots.txt', RobotsHandler );

    // Sub-router for the content repo specific API.
    let repoAPI = express.Router();

    const DefaultReposByAccount = settings.get('httpAPI.defaultReposByAccount', {} );
    function getDefaultRepoForAccount( req, account ) {
        return DefaultReposByAccount[account];
    }

    // Mount the API for content repos.
    api.use('/', repoAPI );

    const AccountProcessors = settings.get('httpAPI.accountProcessors', {});

    // Middleware to parse the request path and call account specific processors.
    repoAPI.use( ( req, res, next ) => {
        // Read the portion of the path after the APIs mount point.
        // The + 1 after length is to capture the slash after baseUrl.
        let path = req.originalUrl.substring( req.baseUrl.length + 1 );
        // Remove any trailing query string.
        let qidx = path.indexOf('?');
        if( qidx > 0 ) {
            path = path.substring( 0, qidx );
        }
        // Split the full request URL into its component parts.
        // Note that a path like '/' is split into [ '', '' ], so filter out
        // empty paths.
        path = path.split('/').filter( s => s.length > 0 );
        // Set the parsed path on the request object.
        req.locomotePath = path;
        // Read the account name from the start of the path.
        let account = path[0];
        // Check for account specific middleware.
        let accountProcessor = AccountProcessors[account];
        if( accountProcessor ) {
            // Invoke the account processor before continuing.
            accountProcessor( req, res )
            .then( cont => {
                // Continue if the processor returns true.
                if( cont ) {
                    next();
                }
            })
            .catch( err => {
                Log.error(`Error invoking account processor for '${account}'`, err );
                res.sendStatus( 500 );
            });
        }
        // No account processor found, continue with request.
        else next();
    });

    // Middleware to build the request context for a content repo specific request.
    repoAPI.use( ( req, res, next ) => {

        // Read the locomote request path (see previous middleware function).
        let path = req.locomotePath;

        // Extract account, repo and branch info from the path.
        let idx = 0;
        let account = path[idx++];
        // Check for account addressing; this means a URL in format
        // https://locomote.sh/@account/repo...
        const accountAddr = account.charAt( 0 ) === '@';
        if( accountAddr ) {
            // If account addressing then remove leading @ from account name.
            account = account.substring( 1 );
        }
        // Check if account name is valid.
        if( !branchdb.isAccountName( account ) ) {
            Log.info('Account not found: %s', account );
            res.sendStatus( 404, 'Account not found');
            return;
        }
        // Check if next path component is a valid repo name.
        let repo = path[idx];
        if( branchdb.isRepoName( account, repo ) ) {
            idx++;
        }
        else if( 'robots.txt' === repo ) {
            RobotsHandler( req, res );
            return;
        }
        else {
            // Check if the account has a default repo name.
            // NOTE that when using default-repo functionality, it is important that
            // the default repo doesn't include a sub-folder that shares a name with
            // another repo in the same account. If this does happen then the folder
            // won't be accessible over http on the account-only path - requests will
            // be routed to the repository instead (see code above).
            repo = getDefaultRepoForAccount( req, account );
            if( !repo ) {
                Log.info('No default repository defined for account %s', account );
                res.sendStatus( 404, 'No default repository defined for account');
                return;
            }
        }
        // Check if next path component is a valid branch name.
        let branch = path[idx];
        if( branchdb.isPublicBranch( account, repo, branch ) ) {
            idx++;
        }
        else {
            // Get the default public branch for the repo.
            branch = branchdb.getDefaultPublicBranch( account, repo );
            if( !branch ) {
                Log.info('No public branch available for %s/%s', account, repo );
                res.sendStatus( 404, 'No public branch available');
                return;
            }
        }

        // Create a path referencing the content repo root. This is used later to
        // build a content location for the result.
        req.repoUrl = Path.join( req.baseUrl, path.slice( 0, idx ).join('/') );

        // Read trailing path.
        let trailing = path.slice( idx );

        // The potion of the path received by locomote-server that addresses the repo.
        // e.g. given a path /0.2/account/repo/path... => /0.2/account/repo
        // (Note that this can also include the branch name, if specified).
        let repoAddr = Path.join( req.baseUrl, path.slice( 0, idx ).join('/') );
        // The path that needs to be prepended to a file path (i.e. which is relative
        // to the repo root) to yield a publically addressible path.
        let basePath;
        if( accountAddr ) {
            // If account addressing then the base path is simply the repo address
            // with a '/' prefix.
            basePath = '/'+repoAddr;
        }
        else {

            // Following code is used when mounting a specific account and/or repo
            // under a custom host name.
            // TODO Review this to try and simplify it.

            // The *public path* this API is mounted under; e.g. /cms/0.2 for the locomote.sh
            // server, but can be / when using a custom domain.
            let mountPath = req.headers['x-locomote-mount-path']
                         || req.headers['x-locomote-base-path'] // Legacy
                         || '/';
            // The path on locomote-server that the reverse proxy is forwarding to; can be
            // /<account> or /<account>/<repo> when using a custom domain.
            let fwdPath = req.headers['x-locomote-forward-path'] || '';
            // The path that needs to be prepended to a file path (i.e. which is relative
            // to the repo root) to yield a publically addressible path.
            basePath = Path.join( mountPath, repoAddr.substring( fwdPath.length ) );
            if( basePath.charCodeAt( basePath.length - 1 ) != 0x2F ) {
                basePath += '/';
            }
        }
        // The hostname used by the client.
        let hostname = req.headers['x-forwarded-server'] || req.hostname;
        // A request can include a secure=true query parameter to force
        // secure mode; this is useful when an authentication challenge
        // is required in the response to unauthenticated requests (e.g.
        // to force a password dialog to display in the browser).
        let secure   = req.query.secure == 'true';
        // Construct a repo key.
        let key      = `${account}/${repo}/${branch}`;
        // Useful paths to the content repo filesystem.
        let home     = core.contentRepoHome;
        let repoPath = core.makeContentRepoPath( account, repo, branch );
        // Make the request context.
        req.ctx = {
            home,
            account,
            repo,
            branch,
            trailing,
            key,
            secure,
            repoPath,
            basePath,
            hostname
        };
        // Continue with request.
        next();
    });

    // Robots.txt
    repoAPI.get('*/robots.txt', RobotsHandler );

    // Authorize a request. This method is provided instead of a
    // standard login method; clients can use it to check that the
    // user credentials they have will authenticate correctly for
    // subsequent requests.
    repoAPI.post('*/authenticate.api', async ( req, res ) => {
        try {
            const { ctx } = req;
            ctx.secure = true; // Always a secure request.
            const { userInfo } = await acm.authenticate( ctx, req, res );
            // The userInfo object will include authenticated: true if
            // the request has fully authenticated.
            sendJSON( res, userInfo );
        }
        catch( err ) {
            handleRequestError( ctx, req, res, err );
        }
    });

    // List the available commits to the file db.
    repoAPI.get('*/commits.api', async ( req, res ) => {
        try {
            const { ctx } = req;
            await acm.authenticate( ctx, req, res );
            const commits = await Git.listCommits( ctx.repoPath, ctx.branch );
            sendJSON( res, commits );
        }
        catch( err ) {
            handleRequestError( ctx, req, res, err );
        }
    });

    // Handle a GET or POST request for file DB updates.
    async function handleUpdatesRequest( req, res, since, group ) {
        const { ctx } = req;
        try {
            await acm.authenticate( ctx, req, res )
            if( group !== undefined && group != ctx.auth.group ) {
                // LS-13: ACM group change, force a client reset.
                res.sendStatus( 205 ); // Reset content
                return;
            }
            // Generate the response.
            let result;
            if( since ) {
                result = await filedb.listUpdatesSince( ctx, since );
            }
            else {
                result = await filedb.listAllFiles( ctx );
            }
            sendFileDBResult( req, res, result );
        }
        catch( err ) {
            handleRequestError( ctx, req, res, err );
        }
    }

    // Get updates from the file db.
    repoAPI.get('*/updates.api', ( req, res ) => {
        const since = req.query.since;
        const group = req.query.group;
        handleUpdatesRequest( req, res, since, group );
    });

    // Receive a client visible set and return updates from the file db.
    repoAPI.post('*/updates.api', ( req, res ) => {
        const since = req.body && req.body.since;
        handleUpdatesRequest( req, res, since );
    });

    repoAPI.head('*/updates.api', async ( req, res ) => {
        try {
            const { ctx } = req;
            await acm.authenticate( ctx, req, res );
            const { repoPath, branch, auth: { group } } = ctx;
            const commit = await Git.getCurrentCommitInfo( repoPath, branch );
            // Use the result commit as the file etag.
            const etag = makeETag( commit.id, group );
            res.set( getCacheControlHeaders( etag ) );
            res.send( 200 );
            res.end();
        }
        catch( err ) {
            handleRequestError( ctx, req, res, err );
        }
    });

    // Handle a fileset GET or POST request.
    async function handleFilesetRequest( req, res, since ) {
        const { ctx } = req;
        const { mode, category } = req.params;
        if( mode != 'contents' && mode != 'list' ) {
            // Bad fileset query mode.
            res.sendStatus( 400 );
        }
        if( !category ) {
            // No file category specified.
            res.sendStatus( 400 );
            return;
        }
        try {
            await acm.authenticate( ctx, req, res );
            let result;
            if( since ) {
                if( mode == 'contents' ) {
                    result = await filedb.getFilesetUpdatedContents( ctx, category, since );
                }
                else {
                    result = await filedb.listFilesetUpdates( ctx, category, since );
                }
            }
            else {
                if( mode == 'contents' ) {
                    result = await filedb.getFilesetContents( ctx, category );
                }
                else {
                    result = await filedb.listFilesetFiles( ctx, category );
                }
            }
            sendFileDBResult( req, res, result );
        }
        catch( err ) {
            handleRequestError( ctx, req, res, err );
        }
    }

    // Get a fileset from the file db.
    repoAPI.get('*/filesets.api/:category/:mode', ( req, res ) => {
        handleFilesetRequest( req, res, req.query.since );
    });

    // Receive a client visible set and return a fileset from the file db.
    repoAPI.post('*/filesets.api/:category/:mode', ( req, res ) => {
        const since = req.body && req.body.since;
        handleFilesetRequest( req, res, since );
    });

    // Mount search api if search module is available.
    if( app.search ) {
        const handleSearchRequest = app.search.http.handler;
        // Perform a search of a repository's contents.
        repoAPI.get('*/search.api', async ( req, res ) => {
            try {
                const { ctx } = req;
                await acm.authenticate( ctx, req, res );
                handleSearchRequest( ctx, req, res, cneg );
            }
            catch( err ) {
                handleRequestError( ctx, req, res, err );
            }
        });
    }

    /**
     * Get a static file from a repo.
     */
    repoAPI.get('/*', async ( req, res ) => {
        const { ctx } = req;
        try {
            await acm.authenticate( ctx, req, res );
            // Check for sub-module endpoint.
            let endpoint = Endpoints[ctx.trailing[0]];
            if( endpoint ) {
                // Remove endpoint name from start of trailing path.
                ctx.trailing.shift();
                // Forward the request.
                return endpoint( ctx, req, res, cneg );
            }
            // No sub-module endpoint, process as a file request.
            let path = decodeURI( ctx.trailing.join('/') );
            // If the original request path ended with a slash then
            // ensure this is present on the file path - this is
            // necessary for the default content negotiator to
            // detect directory paths.
            if( req.originalUrl.endsWith('/') ) {
                path += '/';
            }
            // Choose file representation.
            path = await cneg.pathForRequest( ctx, req, path );
            if( !path ) {
                return sendError( ctx, req, res, 404, 'File not found');
            }
            let result;
            // Decide whether to return the file record or contents.
            if( req.query.format == 'record' ) {
                result = await filedb.getFileRecord( ctx, path );
            }
            else {
                result = await filedb.getFileContents( ctx, path );
            }
            // Error checks.
            if( !result ) {
                return sendError( ctx, req, res, 404, 'File not found');
            }
            // If there is a query parameter '@d' present then it will
            // enable dynamic mode for the file request; so if the file
            // is a text mime type then evaluate its contents against
            // the request parameters.
            if( req.query.hasOwnProperty('@d')
                && result.mimeType.indexOf('text/') == 0 ) {
                return sendDynamicResult( req, res, result );
            }
            // Send the file result back to the client.
            sendFileDBResult( req, res, result );
        }
        catch( err ) {
            handleRequestError( ctx, req, res, err );
        }
    });

    const { getErrorPageForCode } = require('./errors').make( filedb, cneg );

    /**
     * Send an error to the client.
     * Attempts to respond with an error page appropriate to the error code.
     * If none is found then sends an HTTP status response with no content.
     */
    async function sendError( ctx, req, res, code, message ) {
        let { accepts = '' } = req.headers;
        // Send a bare error response code if request isn't for text/html.
        if( !accepts.includes('text/html') ) {
            res.sendStatus( code, message );
            return;
        }
        // Lookup an error page path for the current repo; return a bare
        // response code if none found.
        let errorPath = await getErrorPageForCode( ctx, req, code );
        if( !errorPath ) {
            res.sendStatus( code, message );
            return;
        }
        try {
            // Fetch the error page from the file db.
            let result = await filedb.getFileContents( ctx, errorPath );
            if( result ) {
                // Send the error page to the client.
                sendFileDBResult( req, res, result );
            }
            else {
                // Error page not found for some reason.
                Log.warn('Error page not found at %s', errorPath );
                res.sendStatus( code, message );
            }
        }
        catch( err ) {
            Log.error('Failed to load error page', err );
            res.sendStatus( code, message );
        }
    }

    return api;
}


function start( acm, cneg, filedb, branchdb, core, settings ) {

    settings = settings.settings('publish');

    let app = this;
    let api = make( acm, cneg, filedb, branchdb, core, settings, app );

    Log.debug('Starting HTTP API...');
    let { mount, port } = settings.get('httpAPI');
    mount = '/'+mount;

    let server = express();
    server.use( mount, api );
    server.listen( port, () => {
        Log.info('HTTP API listening on port %s under %s', port, mount );
    });

    return api;
}

module.exports = start;
