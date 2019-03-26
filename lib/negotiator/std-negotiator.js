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

const Accepts   = require('./accepts');
const Git       = require('../git');
const Path      = require('path');
const Mime      = require('mime-types');
const { queue } = require('../async');
const Log       = require('log4js').getLogger('content-negotiation.std');

const { ContentNegotiator } = require('./negotiator');

// Regex for matching MIME types.
const TypePattern     = /^(application|audio|font|image|text|video)\/\S+$/;
// Regex for matching language identifiers.
const LanguagePattern = /^\w\w$/;
// Regex for matching character encodings.
const EncodingPattern = /^(ascii|latin1|iso8859-1|ucs-?2|ucs-?16le|utf-?8|base64|hex|gzip)$/;

// Lambda to test if a string is a MIME type identifier.
const isType     = s => TypePattern.test( s );
// Lambda to test if a string is a language identifer.
const isLanguage = s => LanguagePattern.test( s );
// Lambda to test if a string is a character encoding identifier.
const isEncoding = s => EncodingPattern.test( s );

/**
 * Convert a string to a representation key part.
 * Returns the string value, or '*' is the string is undefined.
 */
function keyPart( val ) { return val ? val : '*'; }

/**
 * A class describing a single representation of a resource.
 */
class Representation {

    constructor( path, attrs ) {
        // The representation path.
        this.path     = path;
        // The representation MIME type.
        this.type     = attrs.find( isType );
        // The representation language identifier.
        this.language = attrs.find( isLanguage );
        // The representation encoding.
        this.encoding = attrs.find( isEncoding );
    }

}

/**
 * A class describing a bundle of resource representations.
 * In the default implementation, individual representations are stored
 * in the bundle in an inverted tree structure, and referenced using a
 * key in the form <type>/<language>/<encoding>. The values for each key
 * part are read from the representation. If the representation doesn't
 * have a value for any part of the key then '*' is used instead. (See
 * the keyPart() function above).
 * Subclasses can modify this tree structure by overriding the makeKey(),
 * makeResolver(), and makeRep() methods. For example, if an additional
 * level should be included in the representation tree, then the
 * following changes might be made:
 * - Modify makeRep() to return a subclass of the Representation class
 *   with an additional property;
 * - Modify makeKey() to return a key with an additional fourth item
 *   derived from the additional property;
 * - Modfy makeResolver() to include a step which chooses the appropriate
 *   key value, given a request context.
 */
class Representations {

    constructor() {
        this.reps = {};
        this.resolver = this.makeResolver();
    }

    /**
     * Make a representation key.
     * The key is used to store the representation within the bundle tree.
     * The key is represented as an array of values, each item
     * corresponding to a level of the tree.
     * The default implementation returns [ type, language, encoding ].
     */
    makeKey( rep ) {
        return [
            keyPart( rep.type ),
            keyPart( rep.language ),
            keyPart( rep.encoding )
        ];
    }

    /**
     * Make a representation key resolver.
     * This function is the counterpart to makeKey(), and is used to
     * resolve resources stored using keys returned by that method.
     * The resolver is represented as an array of lambdas, where each
     * function resolves a value from a request context to use as the
     * key part at a particular level; e.g. in the default implementation,
     * the first lambda resolves a MIME type, the second resolves a language,
     * and the third resolves a character encoding. Any lambda can return
     * undefined if an appropriate value can't be resolved from the request.
     */
    makeResolver() {
        return [
            ( ctx, opts, headers ) => Accepts.mediaType( opts, headers ),
            ( ctx, opts, headers ) => Accepts.language( opts, headers ),
            ( ctx, opts, headers ) => Accepts.charset( opts, headers )
        ]
    }

    /**
     * Make a representation object.
     * @path    The path to the representation.
     * @attrs   A list of representation attributes, e.g. its MIME type of
     *          character encoding.
     */
    makeRep( path, attrs ) {
        return new Representation( path, attrs );
    }

    /**
     * Insert a representation into the bundle.
     * @path    The path to the representation.
     * @attrs   A list of representation attributes, e.g. its MIME type of
     *          character encoding.
     */
    insert( path, attrs ) {
        let rep = this.makeRep( path, attrs );
        let key = this.makeKey( rep );
        let node = this.reps;
        let i, id;
        for( i = 0; i < key.length - 1; i++ ) {
            id = key[i];
            let next = node[id];
            if( !next ) {
                next = node[id] = {};
            }
            node = next;
        }
        id = key[i];
        node[id] = rep;
    }

    /**
     * Choose a representation from the bundle.
     * @param headers   An object which includes accepts headers.
     */
    choose( ctx, headers ) {
        let node = this.reps;
        for( let i = 0; i < this.resolver.length; i++ ) {
            let opts = Object.keys( node );
            let opt = this.resolver[i]( ctx, opts, headers ) || '*';
            node = node[opt];
            if( !node ) {
                break;
            }
        }
        return node;
    }
}

class StandardNegotiator extends ContentNegotiator {

    /**
     * Make a negotiator decision context key.
     * This negotiator chooses a resource representation based on the
     * HTTP accepts headers, so these are returned as the decision key.
     */
    getContextKey( ctx, req ) {
        let headers  = req.headers;
        return [
            headers['accept-charset'],
            headers['accept-encoding'],
            headers['accept-language']
        ].join();
    }

    /**
     * List all resources in repo relevant to a request context.
     * The request context identifies a branch of a content repository to
     * read resources from.
     */
    getResources( ctx, cache ) {
        const self = this;
        // Queue requests to ensure that closely timeed catch misses for the
        // same repo don't result in multiple invocations of the cache populate
        // function.
        let queueID = 'std-negotiator.getResources.'+ctx.key;
        return queue( queueID, () => {
            // Read resources from the module cache. Resources will be cached
            // under the repo key. If no resources are found in the cache then
            // the resources are generated by invoking the second argument,
            // are stored in the cache and then returned.
            return cache( ctx.key, async () => {
                let files = await self.listResourceFiles( ctx );
                // Reduce the file list to a map of resource paths to
                // representation info.
                return files.reduce( ( resources, path ) => {
                    let filename = Path.basename( path );
                    // Any filename in the form index.* is a potential
                    // resource representation.
                    if( filename.startsWith('index.') ) {
                        // The resource path is the path to the file's
                        // parent directory.
                        let rscPath = Path.dirname( path )+'/';
                        // Handle special case when processing the root resource.
                        if( rscPath == './' ) {
                            rscPath = '/';
                        }
                        // The representation attributes are defined using
                        // the file's extension name(s).
                        let attrs = filename
                            .split('.')
                            .slice( 1 )
                            .map( attr => {
                                // Map file extensions to MIME types
                                // (Needed for accepts negotiation).
                                // If file extension doesn't correspond to a
                                // known MIME type then the attribute value
                                // is returned unchanged.
                                let mimeType = Mime.lookup( attr );
                                return mimeType || attr;
                            });
                        // Resolve a represenation bundle.
                        let reps = resources[rscPath];
                        if( !reps ) {
                            reps = resources[rscPath] = self.makeRepresentations();
                        }
                        // Insert the representation.
                        reps.insert( path, attrs );
                    }
                    return resources;
                }, {});
            });
        });
    }

    /**
     * List all available resource files.
     */
    listResourceFiles( ctx ) {
        let { repoPath, branch } = ctx;
        // List all files in the target content repo.
        return Git.listAllTrackedFilesAtCommit( repoPath, branch );
    }

    /**
     * Make a representation bundle.
     */
    makeRepresentations() {
        return new Representations();
    }

    /**
     * Return the general resource path for a specific representation path.
     * If the path has a filename like index.* then the path to the parent
     * directory is returned as the file path; otherwise, the path argument
     * is returned.
     */
    getParentResourcePath( path, cache ) {
        let filename = Path.basename( path );
        if( filename.startsWith('index.') ) {
            return Path.dirname( path );
        }
        return path;
    }

    /**
     * Return a representation of the specified path compatible with the
     * specified accepts headers.
     */
    async getRepresentation( ctx, accepts, path, cache ) {
        let resources = await this.getResources( ctx, cache );
        let rep = false;
        let reps = resources[path];
        if( reps ) {
            let headers = { accepts };
            rep = reps.choose( ctx, headers );
        }
        return rep;
    }

    /**
     * Return the path of a representation of the specified path compatible
     * with the specified accepts headers.
     */
    async getRepresentationPath( ctx, accepts, path, cache ) {
        // This function starts by assuming that the provided path is a resource
        // path. It appends a trailing slash if there isn't one already and then
        // passes the path to getRepresentation. That will then either find and
        // return a representation for the path, or not in which case the original
        // path is used as the result instead.
        // (The empty path - equivalent to / - is left unchanged).
        let rscPath = path;
        let last = path.length - 1;
        if( last < 0 || rscPath[last] != '/' ) {
            rscPath += '/';
        }
        // Try loading the path as a directory reference.
        let rep = await this.getRepresentation( ctx, accepts, rscPath, cache );
        return (rep && rep.path) || path;
    }
}

exports.Representation = Representation;
exports.Representations = Representations;
exports.StandardNegotiator = StandardNegotiator;
exports.keyPart = keyPart;
