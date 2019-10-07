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

// Disk cache garbage collector.

const Path = require('path');

const FGlob    = require('@locomote.sh/fileglob');
const { exec } = require('@locomote.sh/utils');

const MSPerMinute   = 1000 * 60;
const DefaultPeriod = 60; // One hour.
const DefaultExpire = 28; // Expire files after 28 days.

const Log = require('log4js').getLogger('cachegc');

function start( settings ) {

    // The cache location.
    const { cache: { location, gc } } = settings.get('publish');
    // The sweep period; defined in minutes, converted to ms.
    const period = (gc.period || DefaultPeriod) * MSPerMinute;
    // The file expire period; defined in days.
    const expire = gc.expire || DefaultExpire;
    
    const { preserve = [] } = gc;
    const preserveFGlobs = FGlob.makeSet( preserve );

    async function run() {
        try {
            Log.debug('Running GC (%s)...', location );
            let args = [ '.', '-type', 'f', '-atime', '+'+expire ];
            let files = await exec('find', args, location );
            // Filter out preserved files.
            files = files.filter( file => {
                if( file.startsWith('./') ) {
                    file = file.slice( 2 );
                }
                return file.length > 0 && !preserveFGlobs.matches( file );
            });
            if( files.length > 0 ) {
                // Delete matching files.
                await exec('rm', files, location )
                Log.debug('Deleted %d files...', files.length );
            }
            else Log.debug('Nothing to delete');
        }
        catch( err ) {
            Log.error( err );
        }
    }

    setInterval( run, period ); // Schedule GC to run.
    run(); // Run the GC now...
}

exports.start = start;

