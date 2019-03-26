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

const ACM       = require('../acm');
const BCrypt    = require('bcryptjs');
const LRU       = require('lru-cache');

const { AuthUser } = require('./auth-user');

const Log = require('log4js').getLogger('http-auth/basic');

// A cache of previously resolved authentication users.
// The cache is keyed by the authentication token + manifest fingerprint.
const AuthenticationUsers = new LRU({ max: 1000 });

function parseAuthHeader( header ) {
    let buffer;
    if( Buffer.fromString ) {
        buffer = Buffer.fromString( header, 'base64');
    }
    else {
        // Pre Node v.5.10.0
        buffer = new Buffer( header, 'base64');
    }
    return buffer.toString()
        .split(':')
        .map( decodeURIComponent ); // Note that username + password can be URI encoded.
}

/**
 * Perform HTTP Basic authentication with a user database stored with the repo's
 * authentication settings.
 */
async function authenticate( req, authSettings, authRealm ) {
    let cacheKey = authSettings.fingerprint;
    // Read the authentication header.
    let authHeader = req.get('Authorization');
    if( authHeader ) {
        cacheKey += authHeader;
    }
    // Check the cache.
    let authUser = AuthenticationUsers.get( cacheKey );
    if( authUser ) {
        return authUser;
    }
    // Cache miss; process the request fuller.
    if( authHeader ) {
        // Check the authentication method.
        let authFields = authHeader.split(' ');
        if( authFields[0] == 'Basic' ) {
            // Parse the authentication token.
            let tokens = parseAuthHeader( authFields[1] );
            // Read username and password.
            let username, password = tokens;
            // Lookup the username.
            let userInfo = authSettings.users && authSettings.users[username];
            if( userInfo ) {
                let ok = await new Promise( ( resolve, reject ) => {
                    BCrypt.compare( password, userInfo.password, ( err, ok ) => {
                        resolve( !err && ok );
                    });
                });
                if( !ok ) {
                    throw ACM.authenticationRequiredError( authRealm );
                }
                authUser = new AuthUser( username, true, userInfo.groups );
            }
            else {
                Log.debug('Username not found: %s', username );
                throw ACM.authenticationRequiredError( authRealm );
            }
        }
        else {
            Log.warn('Unsupported HTTP authentication method: %s', authFields[0] );
            throw ACM.authenticationRequiredError( authRealm );
        }
    }
    if( !authUser ) {
        // Unauthenticated request, return unauthenticated user.
        authUser = new AuthUser();
    }
    // Add to cache.
    AuthenticationUsers.set( cacheKey, authUser );
    return authUser;
}

module.exports = authenticate;
