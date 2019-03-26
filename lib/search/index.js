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

const { IPCService } = require('understruct');
const { init } = require('./server');

const service = new IPCservice('search');

service.initClient = function( settings ) {
    this.http = require('./httpapi').make( this );
}

service.initServer = async function( branchdb, builder, core, settings ) {
    await init( branchdb, builder, core, settings, this );
    this.http = require('./httpapi').make( this );
}

service.messages = {
    /// Queue a reindex of a repo.
    reindex: function( account, repo, branch ) {
        this._indexer.reindex( account, repo, branch );
        return 'Ok';
    },
    /// Perform a search.
    search: function( account, repo, branch, term, mode, path ) {
        return this._search( account, repo, branch, term, mode, path );
    },
    ping: function() {
        return 'Search here!';
    }
}

module.exports = service;
