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

// Standard log4js setup - intended to be used by the build scripts.
module.exports = function( logFile, level ) {
    const log4js = require('log4js');
    log4js.configure({
        appenders: {
            console:    { type: 'console' },
            file:       { type: 'file', filename: logFile }
        },
        categories: {
            default: {
                appenders: ['console','file'],
                level:  level || 'error'
            }
        }
    });
}
