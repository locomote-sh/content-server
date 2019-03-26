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

const { Settings } = require('./settings');
const understruct = require('understruct');
const log4js = require('log4js');

/// Start the server.
async function start( settings ) {
    // Ensure settings are a Settings object.
    if( !(settings instanceof Settings) ) {
        settings = new Settings( settings );
    }
    // Read the app backbone config.
    let backbone = settings.get('app.backbone');
    if( !backbone ) {
        throw new Error('No app backbone configuration at app.backbone');
    }
    // Configure the logging system.
    log4js.configure( settings.get('log4js') );
    // Push app settings to top of backbone config.
    backbone.unshift({ settings });
    // Start the app backbone.
    let logger = log4js.getLogger('app')
    try {
        logger.info('Starting backbone...');
        await understruct.start( backbone, msg => logger.info( msg ) );
        logger.info('Backbone started');
    }
    catch( e ) {
        if( e.cause ) {
            logger.error( e.message );
            logger.error( e.cause );
        }
        else logger.error( e );
    }
}

exports.start = start;
