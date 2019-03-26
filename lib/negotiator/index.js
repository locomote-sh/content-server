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

const Log = require('log4js').getLogger('content-negotiation');
const LRU = require('lru-cache');

const { ContentNegotiator } = require('./negotiator');

const { registerHook } = require('@locomote.sh/pipeline');

const DefaultContentNegotiator = new ContentNegotiator();

const ResourcesCache = new LRU({ max: 100 });

/**
 * This module provides implementation hooks for content negotiation methods.
 */
module.exports = function( settings, builder ) {

    const negotiators = settings.get('publish.cneg',{});

    builder.on('content-repo-update', ( info ) => {
        ResourcesCache.del( info.key );
    });

    // A cache of resolved content negotiations, keyed by request context key.
    const ContentNegotiatorsByCtxKey = {};

    // Get a content negotiator for a request.
    function getContentNegotiator( ctx ) {
        let cneg = ContentNegotiatorsByCtxKey[ctx.key];
        if( !cneg ) {
            // No cached result found, resolve a negotiator for the request.
            cneg = negotiators[ctx.key]                     // Branch specific key
             || negotiators[`${ctx.account}/${ctx.repo}`]   // General repo key
             || negotiators[ctx.account]                    // General account key
             || DefaultContentNegotiator;                   // Default key
            // Add result to cache for quicker subsequent lookups.
            ContentNegotiatorsByCtxKey[ctx.key] = cneg;
        }
        return cneg;
    }

    /**
     * Get resources from the resources cache.
     * @param repoKey   The key of the parent content repository.
     * @param make      A function to generate the resources if not found in
     *                  the cache. Should return a deferred promise resolving
     *                  to the resources result.
     * @return A deferred promise resolving to the required resources.
     */
    async function getResources( repoKey, make ) {
        let rscs = ResourcesCache.get( repoKey );
        if( rscs ) {
            return rscs;
        }
        rscs = await make();
        ResourcesCache.set( repoKey, rscs );
        return rscs;
    }

    /**
     * Return a file path to use as the response to a given request.
     *
     * @param ctx   A request context (see httpapi).
     * @param req   A HTTP request.
     * @param path  The requested path.
     * @returns A deferred promise, resolving to the path to use with the
     *          request.
     */
    async function pathForRequest( ctx, req, path ) {
        let cneg = await getContentNegotiator( ctx );
        return cneg.getRepresentationPath( ctx, req.headers, path, getResources );
    }

    /**
     * Test whether a path is the preferred representation path for a request.
     * Derives the resource name from the path, then the path for that resource,
     * before testing whether the derived path matches the path argument.
     */
    async function isPreferredPathForRequest( ctx, req, path ) {
        let cneg = await getContentNegotiator( ctx );
        // Calculate resource path.
        let rscPath = cneg.getParentResourcePath( path, getResources );
        // If the path passed to this function is the resource path then
        // return the resource path as the preferred path.
        // This is done to support filtering of search results, so that search
        // records can reference the parent resource path instead of a specific
        // file.
        if( rscPath == path ) {
            return true;
        }
        // Lookup preferred representation path for request.
        let accepts = req.headers;
        repPath = await cneg.getRepresentationPath( ctx, accepts, rscPath, getResources );
        // Return true if preferred rep path matches the path argument.
        return repPath == path;
    }

    /**
     * Return a content negotiator decision context key for a given request.
     * @param ctx   A request context (see httpapi).
     * @param req   A HTTP request.
     * @returns A key uniquely identifing the content negotiator decision context.
     */
    async function contextKeyForRequest( ctx, req ) {
        let cneg = await getContentNegotiator( ctx );
        return cneg.getContextKey( ctx, req );
    }

    /**
     * A file DB pipeline hook. The hook is called after the file DB generates each
     * file record, and is used to filter out records for file representations which
     * aren't relevant to the client.
     * @param record    The file record being processed.
     * @param vars      Context variables for the current pipeline invocation.
     * @return The file record, or undefined if the record should be excluded from
     * the pipeline results.
     */
    async function updateHook( record, vars ) {
        let { ctx } = vars;
        let cneg = await getContentNegotiator( ctx );
        let rscPath = cneg.getParentResourcePath( record.path, getResources );
        let accepts = ctx.auth.accepts;
        let repPath = await cneg.getRepresentationPath( ctx, accepts, rscPath, getResources );
        if( repPath == record.path ) {
            return record;
        }
        return undefined;
    }

    // Register the file db pipeline hook.
    registerHook('filedb.updates', 'post', 'make-record', updateHook );

    return { pathForRequest, isPreferredPathForRequest, contextKeyForRequest }
}

