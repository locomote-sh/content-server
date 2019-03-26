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

// Create lookup of mime types keyed by file extension.
const Exts = {};

// Populate the exts lookup.
function populateLookup() {
    let db = require('mime-db');
    for( let mimeType in db ) {
        let { extensions } = db[mimeType];
        if( extensions ) {
            for( let ext of extensions ) {
                Exts[ext] = mimeType;
            }
        }
    }
}

populateLookup();

/**
 * Lookup a MIME type by file extension.
 * @param ext A file extension, with or without a leading full stop.
 */
exports.forExtension = function( ext ) {
    if( ext === undefined ) {
        return undefined;
    }
    if( ext.charCodeAt( 0 ) == 0x2e ) {
        ext = ext.slice( 1 );
    }
    return Exts[ext];
}

/**
 * Lookup a MIME type for a file path.
 * @param path A file path.
 */
exports.forPath = function( path ) {
    if( path === undefined ) {
        return undefined;
    }
    let ext = Path.extname( path ).substring( 1 );
    return Exts[ext];
}

