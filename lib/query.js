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

// A database holding basic information about files on specific
// branches of a content repository.

const {
    ensureDir,
    fingerprint
} = require('@locomote.sh/utils');

const Path = require('path');

const {
    jsonlStreamJoin
} = require('@locomote.sh/pipeline');

const QueryAPI = require('@locomote.sh/query-api/lib/locomote');

const Log = require('log4js').getLogger('query');

module.exports = function( builder, filedb, filesets, settings ) {

    const dbDir = Path.join( settings.get('publish.cache.location'), 'idb' );

    const {
        addFileRecords,
        readLatestCommit,
        handleQueryRequest: _handleQueryRequest,
        makeContentOrigin
    } = QueryAPI( filesets, dbDir );

    function getRequestOrigin( ctx ) {
        const { account, repo, branch, auth: { group } } = ctx;
        const name = encodeURIComponent(`${account}/${repo}/${branch}/${group}`);
        return makeContentOrigin( name );
    }

    /**
     * The set of fully up-to-date file dbs.
     */
    const Synced = {};

    /**
     * Update set of synced file dbs after a content update.
     */
    builder.on('content-repo-update', info => {
        const { account, repo, branch } = info;
        const key = `${account}/${repo}/${branch}`;
        delete Synced[key];
    });

    /**
     * Test if the file db for the repo referenced by a request context is in sync.
     */
    function isSynced( ctx ) {
        const { key, auth: { group } } = ctx;
        const entry = Synced[key];
        return entry && entry.has( group );
    }

    /**
     * Mark the file db for the repo referenced by a request context as in sync.
     */
    function setSynced( ctx ) {
        const { key, auth: { group } } = ctx;
        const entry = Synced[key];
        if( entry ) {
            entry.add( group );
        }
        else Synced[key] = new Set([ group ]);
    }

    /**
     * Query the filedb for updated files.
     * @param ctx   A request context.
     * @param since An optional since parameter.
     */
    function listFileUpdates( ctx, since ) {
        return since
            ? filedb.listUpdatesSince( ctx, since )
            : filedb.listAllFiles( ctx );
    }

    /**
     * Write updated file records to a file db instance.
     * @param ctx   A request context.
     */
    async function updateDB( ctx, origin ) {
        // Read the latest commit.
        const since = await readLatestCommit( origin );
        // Open a stream on the list of updated files.
        const result = await listFileUpdates( ctx, since );
        const ins = await result.readable();
        // TODO Use an iterator to provide a fully streamed list of records.
        const records = await jsonlStreamJoin( ins );
        await addFileRecords( origin, records );
    }

    /**
     * Handle a HTTP query request.
     */
    async function handleQueryRequest( ctx, req, res ) {
        try {
            // Get a content origin for the request.
            const origin = getRequestOrigin( ctx );
            // Check whether the file db needs to be refreshed.
            if( !isSynced( ctx ) ) {
                Log.debug('Refreshing file db for %s', ctx.key );
                // Ensure that the DB file location exists.
                await ensureDir( dbDir );
                // Update the file db.
                await updateDB( ctx, origin );
                setSynced( ctx );
            }
            // Delegate the request to base handler.
            await _handleQueryRequest( origin, req, res );
        }
        catch( e ) {
            Log.error('Handling HTTP request', e );
            res.sendStatus( 500 );
        }
    }

    return {
        httpapi: {
            endpoints: {
                'query.api': handleQueryRequest
            }
        }
    }

}


