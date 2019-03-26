/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const { FilesetProcessor } = require('./processor');

/**
 * A JSON data fileset processor.
 * Reads data from the associated JSON file and includes it in the file record.
 */
class JSONDataFSP extends FilesetProcessor {

    constructor( loader, category ) {
        super( loader, category );
    }

    /**
     * Make a file record.
     * @param ctx       A request context.
     * @param path      The path of the file being processed.
     * @param active    A flag indicating whether the file is active.
     * @param version   The file version (e.g. commit hash).
     */
    async makeFileRecord( ctx, path, active, version ) {
        const record = await super.makeFileRecord( ctx, path, active, version );
        if( record.status == 'deleted' ) {
            return false;
        }
        const json = await this.readFile( ctx, record.path, version );
        // Parse the JSON and assign to the record.
        record.data = JSON.parse( json.toString() );
        return record;
    }

}

module.exports = { JSONDataFSP }
