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

const Path = require('path')

/**
 * A class for encapsulating methods for performing content 
 * negotiation.
 */
class ContentNegotiator {

    constructor() {}

    /**
     * Return a key which uniquely identifies the decision context
     * used by the content negotiator to choose a resource
     * represention.
     * The content negotiator should return the same resource
     * path for all data contexts with the same key.
     */
    getContextKey( ctx, req ) {
        // This negotiator chooses a resource path using only
        // the request path, so that can be used as the decision
        // context key.
        return req.path;
    }

    /**
     * Return a path referencing the parent resource of a
     * representation path.
     *
     * The resource path is used to address a content resource; a
     * representation path addresses a specific representation of
     * a resource.
     *
     * The default implementation assumes resources addressed by
     * directory with a default implementation in a file named
     * 'index.html'; so e.g. if the representation path is 
     * 'a/b/c/index.html' then the resource path is 'a/b/c/'.
     *
     * @param path  A file path.
     * @param cache A function for accessing the module cache.
     */
    getParentResourcePath( path, cache ) {
        if( Path.basename( path ) == 'index.html') {
            return Path.dirname( path ) + '/'
        }
        return path
    }

    /**
     * Return the path of the representation to use for the resource
     * referenced by the path argument, which matches the accepts
     * headers.
     * If the request path has a trailing slash (e.g. a/b/c/) then
     * the representation path is derived by appending 'index.html'.
     *
     * @param ctx       A request context.
     * @param accepts   Accepts headers.
     * @param path      The request path.
     * @param cache     A function for accessing the module cache.
     *
     * @returns A deferred promise resolving to a path.
     *          The default implementation returns the path argument.
     */
    getRepresentationPath( ctx, accepts, path, cache ) {
        let plen = path.length;
        if( plen == 0 || path == '/' ) {
            path = 'index.html';
        }
        else if( path[plen - 1] == '/' ) {
            path = Path.join( path, 'index.html');
        }
        return path;
    }
}

exports.ContentNegotiator = ContentNegotiator
