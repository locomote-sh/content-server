/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const Git = require('../git');
const Log = require('log4js').getLogger('fsp');

const { FilesetProcessor } = require('./processor');

/**
 * A JSON data fileset processor.
 * Reads data from the associated JSON file and includes it in the file record.
 */
class JSONDataFSP extends FilesetProcessor {

    constructor( category ) {
        super( category );
    }

    async makeFileRecord( repoPath, path, active, commit ) {
        let record = await super.makeFileRecord( repoPath, path, active, commit );
        if( record.status == 'deleted' ) {
            return false;
        }
        let json = await Git.readFileAtCommit( repoPath, commit, record.path );
        // Parse the JSON.
        record.data = JSON.parse( json );
        return record;
    }

}

module.exports = { JSONDataFSP }
