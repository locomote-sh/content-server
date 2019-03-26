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

const FS = require('fs');

/**
 * Stream data from a multi-object JSON file.
 * The source file should have one JSON object per line. Each line
 * will be parsed and then passed through to the callback function.
 * @param path      The path to a file.
 * @param onobject  A callback function accepting an object argument.
 */
function streamJSONFile( path, onobject ) {
    return new Promise( ( resolve, reject ) => {
        // A buffer holding data read from the file.
        let buffer = '';
        // Append to the buffer.
        function append( s ) {
            // Append string to end of buffer.
            buffer += s;
            // Split the buffer into lines.
            let lines = buffer.split('\n');
            // Process up to second-last line (the last line
            // may be incomplete if still reading).
            let i = 0;
            while( i < lines.length - 1 ) {
                // Read next line.
                let line = lines[i++];
                // If line is non-empty...
                if( line.length > 0 ) {
                    // ...then parse and pass through to callback.
                    let obj = JSON.parse( line );
                    onobject( obj );
                }
            }
            // Reset buffer to last line.
            buffer = lines[i];
        }
        // Open stream on file.
        let stream = FS.createReadStream( path );
        // Add handler to append data to buffer.
        stream.on('data', data => append( data.toString() ) );
        // At end of stream, write a newline to buffer to force parsing
        // of last line of data.
        stream.on('end',  () => {
            append('\n');
            resolve();
        });
        // Error handler.
        stream.on('error', err => reject( err ) );
    });
}

exports.streamJSONFile = streamJSONFile;
