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

const { AuthUser } = require('./auth-user');

const Log = require('log4js').getLogger('http-auth/test');

/**
 * Module for testing authentication.
 * Allows request authentication status + ACM group membership to be
 * specified as request parameters.
 * STRICTLY NOT FOR PRODUCTION USE!!
 */

/**
 * Authenticate a request using the aqua session cookie.
 * Use _auth_groups=aaa,bbb,ccc to specify the user's auth
 * group membership. Presence of the param implies an
 * authenticated user.
 */
function authenticate( req, authSettings, authRealm ) {

    let { _auth_groups } = req.query;

    let user;
    if( _auth_groups === undefined ) {
        user = new AuthUser();
    }
    else {
        let groups = _auth_groups.split(',');
        Log.debug('Authenticating user with groups: %s', groups.join(','));
        user = new AuthUser('Test', true, groups );
    }

}

module.exports = authenticate;
