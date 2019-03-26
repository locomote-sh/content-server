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

const FGlob      = require('@locomote.sh/fileglob');
const tinytemper = require('@locomote.sh/tinytemper');
const LRU        = require('lru-cache');

const { fingerprint } = require('@locomote.sh/utils');

const { format } = require('util');

const Log = require('log4js').getLogger('acm');

function AuthenticationError( status, message, headers ) {
    this.status = status;
    if( message ) {
        this.message = message;
    }
    else switch( status ) {
    case 401:
        this.message = 'Authentication error';
        break;
    case 500:
        this.message = 'Internal server error';
        break;
    default:
        this.message = 'Error';
    }
    this.headers = headers;
}

function start( settings, manifests, builder, filesets ) {

    const globalAuthSettings = settings.get('publish.auth.defaults');
    const authMethods        = settings.get('publish.auth.methods');
    const authRealmFormat    = settings.get('publish.httpAPI.authRealmFormat');

    // A cache of per-repo authentication settings.
    const RepoAuthSettings = new LRU({ max: 1000 });

    // Register event listener with builder to remove settings from cache
    // when a content repo is updated.
    builder.on('content-repo-update', ( info ) => {
        RepoAuthSettings.del( info.key );
    });

    const { getFilesets } = filesets;


    /**
     * Get the authentication settings appropriate for the request context.
     */
    async function getAuthSettingsForContext( ctx ) {
        // Check for cached settings.
        let settings = RepoAuthSettings.get( ctx.key );
        if( settings ) {
            return settings;
        }
        const repoPath = ctx.repoPath;
        const branch = ctx.branch;
        // Settings not found; read manifest and filesets for requested repo.
        let [ manifest, commitHash, filesets ] = await Promise.all([
            manifests.load( repoPath, branch ),
            manifests.getCommitHash( repoPath ),
            getFilesets( ctx, branch )
        ]);
        // Parse the manifest and read auth section.
        let { auth } = manifest;
        // Create a new settings object by extending global settings:
        // TODO: Extend account settings instead.
        settings = Object.create( globalAuthSettings );
        // Copy settings from manifest.
        settings = Object.assign( settings, auth );
        settings.filesets = filesets;
        // Generate a lookup of fileset fingerprints by fileset category
        // name.
        settings.filesets.fingerprints = filesets
            .reduce( ( result, fileset ) => {
                result[fileset.category] = fileset.fingerprint;
                return result;
            }, {});
        // Extract ACM rewrite functions.
        settings.rewrites = filesets.reduce( ( rewrites, fileset ) => {
            if( typeof fileset.acm == 'function' ) {
                rewrites[fileset.category] = fileset.acm;
            }
            else {
                // Default rewrite function - return record unchanged.
                rewrites[fileset.category] = record => record;
            }
            return rewrites;
        }, {});
        // Add a fingerprint; this is to support caching of authentication
        // contexts, and allows authentication methods to detect manifest
        // changes.
        settings.fingerprint = commitHash;
        // Add settings to cache.
        RepoAuthSettings.set( ctx.key, settings );
        return settings;
    }

    /// Locale identifier pattern - e.g. en_US.
    const LocaleIDPattern = /^\w+(_\w+)/;
    /// Prefix for platform group names.
    const PlatformGroupNamesPrefix = 'platform.';
    /// Current Visible Set group name prefix.
    const CVSGroupNamePrefix = 'CVS:';

    /**
     * Inspect a request and derive additional ACM group memberships and
     * filter functions from the request's attributes.
     * @param req       An HTTP request object.
     * @returns An object with 'group' and 'filter' properties.
     *          - The group property is a list of additional group names.
     *          - The filter property is an ACM filter function.
     */
    function getRequestDerivedAuthSettings( req ) {
        const result = {
            groups:     [],
            filter:     (record => true),
            accepts:    {} // Accepts headers
        };
        // Attempt to read platform details from the UA string.
        const userAgent = req.get('User-Agent');
        // Check for client locale. Note that this expects a single locale
        // identifier, and doesn't support weighted values.
        const locale = req.get('Accept-Language');
        if( locale && LocaleIDPattern.test( locale ) ) {
            result.groups.push('Accept-Language:'+locale );
            result.accepts['Accept-Language'] = locale;
            // Note that it is important that accepts headers have a corresponding
            // ACM group, in order for the ACM fingerprint to be fully describe the
            // ACM context.
        }
        // Check for file name filters. These can be specified as filter=<includes>,
        // or as filter[includes]=<list>, filter[excludes]=<list>. In each case, the
        // value is a comma separated list of file patterns.
        let filter = req.query.filter;
        if( filter ) {
            if( typeof filter == 'string' ) {
                filter = { includes: filter };
            }
            if( filter.includes ) {
                filter.includes = filter.includes.split(',');
            }
            else {
                filter.includes = [];
            }
            if( filter.excludes ) {
                filter.excludes = filter.excludes.split(',');
            }
            else {
                filter.excludes = [];
            }
            const fglob = FGlob.makeCompliment( filter.includes, filter.excludes );
            result.filter = (record => fglob.matches( record.path ));
            // Add an ACM group whose name is the fingerprint of the JSON
            // representation of the filter object.
            result.groups.push( fingerprint( JSON.stringify( filter ) ) );
        }
        else {
            // LS-13: Check for a client visible set submitted in the body of a POST
            // request. This is a JSON string encoding an object which maps file IDs
            // to file versions, and describes what files the client can currently
            // see. The filter function filters these out so that only modified or
            // new files are returned to the client.
            // (Note that key order in the CVS is important, to ensure consistent
            // hash values).
            const cvs = req.body && req.body.cvs;
            if( cvs ) {
                // Add ACM group ID for the CVS.
                result.groups.push( CVSGroupNamePrefix+fingerprint( cvs ) );
                // Create a lookup by parsing the submitted value.
                const cvsLookup = JSON.parse( cvs );
                result.filter = ( record ) => {
                    const version = cvsLookup[record.id];
                    // version == undefined => current record isn't in the visible set
                    // version != record.version => current record is different
                    // record.status == 'deleted' => record was visible but now not
                    return version === undefined
                        || version != record.version.id
                        || record.status == 'deleted';
                };
            }
        }
        return result;
    }

    /**
     * Make an authentication context.
     * @param req               An HTTP request object.
     * @param authUser          An object describing an authenticated user.
     * @param authSettings      Authentication settings for the user's account.
     */
    function makeAuthContext( req, authUser, authSettings ) {
        // Get additional group memberships derived from the request.
        const additionalSettings = getRequestDerivedAuthSettings( req );
        // Make group name lookup.
        const groups = {};
        authUser.groups.forEach( ( name ) => {
            groups[name] = true;
        });
        additionalSettings.groups.forEach( ( name ) => {
            groups[name] = true;
        });
        // Make lookup of accessible group names. This is the set of named groups
        // for the user (which may or may not correspond to fileset category names)
        // + the set of unrestricted fileset category names.
        const accessible = authSettings.filesets.reduce( ( accessible, fileset ) => {
            let category = fileset.category;
            if( !fileset.restricted ) {
                accessible[category] = true;
            }
            return accessible;
        }, groups );
        // Make canonical group identifier.
        const fingerprints = authSettings.filesets.fingerprints;
        let cgroups = Object.keys( accessible )
            .sort()
            // Replace fileset category names with categorical IDs; keep
            // all other IDs.
            .map( name => fingerprints[name] || name );
        // Create the ACM group ID.
        const groupID = fingerprint( cgroups.join() );
        // Create the ACM group ID minus any CVS group ID. This will be identical to
        // groupID in most cases, as the CVS group ID will only be present when the
        // client is performing a file DB reset, and in which case the client needs
        // an ACM group ID without the CVS group, for use in subsequent update
        // requests. (If the client uses the group ID with the CVS, then it will
        // trigger another DB reset when it requests an update without submitting a
        // CVS).
        cgroups = cgroups.filter( id => !id.startsWith( CVSGroupNamePrefix ) );
        const $groupID = fingerprint( cgroups.join() );
        // Make authentication context.
        return {
            settings:   authSettings,
            userInfo:   authUser,
            accessible: accessible,
            group:      groupID,
            $group:     $groupID,
            filter:     additionalSettings.filter,
            platform:   additionalSettings.platform
        };
    }

    /**
     * Authenticate a request.
     * @param ctx   A request context.
     * @param req   A HTTP request.
     * @param res   A HTTP response.
     */
    async function authenticate( ctx, req, res ) {
        try {
            let authSettings = await getAuthSettingsForContext( ctx );
            let { method } = authSettings;
            let authRealm = tinytemper.eval( authRealmFormat, ctx );
            // The secure property on the request context is a way of enforcing
            // authentication on a request.
            if( ctx.secure && !req.get('Authorization') ) {
                // Secure mode but no authorization header, so return an
                // authentication challenge.
                throw authenticationRequiredError( authRealm );
            }
            let authenticator = authMethods[method];
            if( !authenticator ) {
                let msg = format('Authentication method for %s not found: %s',
                                    ctx.key, method )
                throw new AuthenticationError( 500, msg );
            }
            Log.debug('Using auth method %s for %s', method, ctx.key );
            let authUser = await authenticator( req, authSettings, authRealm );
            // Auth methods must either return a user (which may be anonymous /
            // unauthenticated), or generate an error.
            if( authUser === undefined ) {
                throw new Error('Authentication method must return an auth user');
            }
            // Make the authentication context.
            let auth = await makeAuthContext( req, authUser, authSettings );
            if( auth ) {
                Log.debug('Authenticated %s', auth.userInfo.user );
                ctx.auth = auth;
            }
            return auth;
        }
        catch( err ) {
            if( err instanceof AuthenticationError ) {
                throw err;
            }
            Log.error('Authentication failure', err );
            throw new AuthenticationError( 500, 'Authentication method error');
        }
    }

    /**
     * Filter file DB records according to the authorization context.
     * @deprecated
     */
    function filter( ctx, records ) {
        // Read accessible groups from auth context.
        const accessible = ctx.auth.accessible;
        // Filter records by the filter function (paths) and accessible groups.
        const filter = ctx.auth.filter;
        return records.filter( ( record ) => {
            return accessible[record.category] && filter( record );
        });
    }

    /**
     * Rewrite file DB records according to the authorization context.
     * @deprecated
     */
    function rewrite( ctx, records ) {
        // Read ACM filter functions from auth settings.
        const rewrites = ctx.auth.settings.rewrites;
        if( !rewrites ) {
            // No rewrites, return records unchanged.
            return records;
        }
        // Rewrite records according to the ACM filter functions.
        return records.map( ( record ) => {
            let rewrite = rewrites[record.category];
            return rewrite ? rewrite( record, ctx ) : record;
        })
        .filter( ( record ) => {
            // The rewrite function can return undefined/false if the whole record
            // should be removed.
            return !!record;
        });
    }

    /**
     * Apply ACM filter and rewrite functions to a file db record.
     * @param ctx       A request context.
     * @param record    A file DB record.
     * @return The file record with any ACM rewrites applied; or
     * false if the record isn't available within the current request
     * context.
     */
    function filterAndRewrite( ctx, record ) {
        let { category } = record;
        // Filter record.
        let { accessible, filter } = ctx.auth;
        if( !accessible[category] ) {
            return undefined;
        }
        if( !filter( record ) ) {
            return undefined;
        }
        // Rewrite record.
        let { rewrites } = ctx.auth.settings;
        let rewrite = rewrites[category];
        if( rewrite ) {
            record = rewrite( record, ctx );
        }
        return record;
    }

    /**
     * Test whether a file at a specified path and with the specified category
     * is accessible.
     */
    function isAccessible( ctx, path, category ) {
        // Return true if the file belongs to a category, and that category
        // is accessible.
        Log.debug('isAccessible: path=%s, category=%s', path, category );
        return category && ctx.auth.accessible[category];
    }

    return {
        authenticate,
        filter,
        rewrite,
        filterAndRewrite,
        isAccessible
    }
}

function authenticationRequiredError( authRealm ) {
    return new AuthenticationError(
        401,
        format('Authentication required: %s', authRealm),
        { 'WWW-Authenticate': format('Basic realm="%s"', authRealm ) });
}

exports.start = start;
exports.error = function( status, message ) {
    return new AuthenticationError( status, message );
}
exports.authenticationRequiredError = authenticationRequiredError;
exports.isAuthenticationError = function( err ) {
    return err instanceof AuthenticationError;
}

/**
 * Utility function for providing request ACM filters to a single record.
 * See also the filter() function above.
 * This function was added to support the search http api, which due to
 * its streaming nature needed an acm filter function that worked on records
 * one at a time rather than as an array. Will be possible to revert to
 * a single filter implementation when the filedb is refactored to a
 * streaming implementation.
 */
exports.accessible = function( req, record ) {
    let auth = req.ctx.auth;
    // Read accessible groups from auth context.
    let accessible = auth.accessible || {};
    // Filter records by the filter function (paths) and accessible groups.
    let filter = auth.filter;
    return accessible[record.category] && filter( record );
}

/// Read the ACM group ID from a request.
exports.group = function( req ) {
    return req.ctx.auth.group;
}
