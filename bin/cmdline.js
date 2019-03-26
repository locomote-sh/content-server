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

// Read system default settings.
const settings = require('./settings').DefaultSettings;

// Process command line arguments.
let [ , , ...args ] = process.argv;

for( let arg of args ) {
    if( arg == '-v' || arg == '--version' ) {
        usage();
    }
    // Load settings and merge over defaults.
    let mod = Path.resolve( arg );
    console.log('Loading settings from %s...', mod );
    settings.merge( require( mod ) );
}

// Start the server.
require('../lib/index').start( settings );

// Print usage and exit.
function usage() {
    let cmd = Path.basename( process.argv[1] );
    console.log(`
Usage: ${cmd} [-v | --version] <settings...>

Where:
    [-v | --version]    Print version and exit.
    <settings...>       A JSON file or node.js module containing runtime settings.
                        Multiple settings files can be specified; later settings
                        will be merged over earlier settings.
`);
    process.exit( 1 );
}
