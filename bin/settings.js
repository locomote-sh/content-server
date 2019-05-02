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
const { Settings } = require('../lib/settings');

/**
 * Default system settings. All settings are organized as <category>.<sub-category>.<setting>.
 * When merging, settings are merged down to the sub-category level; individual settings below
 * this level will overwrite default settings.
 */
const DefaultSettings = new Settings({
    app: {
        backbone: require('../lib/backbone')
    },
    log4js: {
        appenders: {
            console:    { type: 'console' },
            locomote:   { type: 'file', filename: 'locomote.log' }
        },
        categories: {
            default: {
                appenders: ['console','locomote'],
                level:  'debug'
            }
        }
    },
    content: {
        repo: {
            // The location of the content repositories.
            home:           Path.resolve('./content_repos'),
            // Repository manifest filename.
            manifest:       'locomote.json',
            // Location of Locomote related files in the content repo.
            locomoteDir:    '_locomote'
        }
    },
    publish: {
        auth: {
            defaults: {
                method: 'basic',
            },
            methods: {
                'basic':        require('../lib/http-auth/basic'),
                'test':         require('../lib/http-auth/test')
            }
        },
        // Response cache settings.
        cache: {
            // The location of the publish cache.
            location: Path.resolve('./publish_cache'),
            // Garbage collector settings.
            gc: {
                period: 60, // Run GC once an hour.
                expire: 7,  // Expire files after 7 days.
                preserve: []
            }
        },
        // HTTP API settings.
        httpAPI: {
            // The service name, as it appears in response headers.
            serviceName:            'Locomote.sh',
            // HTTP basic authentication realm name.
            authRealmFormat:        'Locomote/{key}',
            // The path to mount the API under.
            mount:                  '',
            // The port to listen on.
            port:                   8014,
            // Default HTTP response cache control.
            cacheControl:           'public, must-revalidate, max-age=60',
            // Whether to gzip encode responses.
            gzipEncode:             true,
            // Account specific request processors. A map of async functions,
            // keyed by account name. Each function takes ( req, res ) args
            // and should return an async promise resolving to the result. The
            // function should return 'true' for normal request processing to
            // continue, or 'false' if the function has completed the request
            // processing (in which case it must return a response to the
            // client).
            accountProcessors:      {}
        }
    },
    // Build workflow settings.
    build: {
        // If true then the builder is disabled.
        disabled:                       true,
        // A location on the filesystem used as a builds workspace.
        workspaceHome:                  Path.resolve('./workspace'),
        // Port & hostname that the updates listener binds to.
        updatesListener: {
            port:                       8870,
            host:                       'localhost'
        },
        gogsWebhookSecret:              'xxx',
        handleInternalCUNotifications:  true
    },
    /*
    // Terminal settings.
    terminal: {
        port:       1970,
        pbPort:     1971,
        hostname:   'localhost',
        // If true then terminal will listen on command line.
        cli:        true
    },
    */
    search: {
        // Path to the system search database.
        dbPath:                 'search.sqlite',
        // Cache location for search results.
        cacheDir:               Path.resolve('./publish_cache/search'),
        // Maximum on-disk size of cached search results.
        perBranchMaxCacheSize:  250000
    }
});

exports.DefaultSettings = DefaultSettings;
