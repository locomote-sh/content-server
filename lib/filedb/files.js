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

const Farmhash  = require('farmhash');
const MIMETypes = require('../mime-types');

const {
    pipeline,
    jsonlStreamJoin
} = require('@locomote.sh/pipeline');

const Log = require('log4js').getLogger('filedb');

// File DB pipeline ops for accessing single files and file records.
exports.make = function( scope ) {

    const {
        acm,
        cacheDir,
        filesets: {
            getFilesetForPath,
            makeFileRecord
        },
        getFileInfoDB,
        jsonPrint,
        annotateResult
    } = scope;

    /**
     * Initialize a file pipeline. Returns a pipeline vars object, or false
     * if the requested file path doesn't exist on the requested branch of
     * the source content repo.
     * @param ctx   A request context.
     * @param path  A file path, relative to the content repo root.
     */
    async function initPipeline( ctx, path ) {
        let { repoPath, branch, hostname, basePath } = ctx;
        // Lookup the requested file's latest commit on target branch.
        let db = await getFileInfoDB( ctx );
        let fileInfo = db[path];
        if( !fileInfo ) {
            // File doesn't exist on target branch.
            return false;
        }
        let { commit } = fileInfo;
        // Create a commit path composed of the first two digits of the commit
        // hash, followed by a path separator and then the remaining digits.
        let commitPath = commit.slice( 0, 2 )+'/'+commit.slice( 2 );
        // Calculate a hash of the file path - this is used in the cache path;
        // farmhash is used here as a fast alternative to e.g. SHA or similar.
        let pathHash = Farmhash.fingerprint32( path );
        // NOTE: commit is included in vars so that it is available on the
        // filedb result (see support.js#annotateResult) so that in turn it
        // is available when generating an etag for the response.
        return { ctx, fileInfo, commit, commitPath, path, pathHash };
    }

    /**
     * Read a file's contents from a repo and copy into the cache.
     */
    const getFileContents = pipeline( cacheDir )
    .init( initPipeline )
    .open( async ( vars, outs ) => {
        let { ctx, fileInfo: { commit }, path } = vars;
        let { branch } = ctx;
        // Lookup the fileset the path belongs to and delegate reading of the
        // file's contents to the fileset.
        let fileset = await getFilesetForPath( ctx, branch, path );
        if( fileset ) {
            await fileset.pipeContents( ctx, path, commit, outs );
        }
        outs.end();
    },
    'external/{ctx.hostname}{ctx.basePath}{commitPath}/{pathHash}-{ctx.auth.group}')
    .done( ( vars, result ) => {
        result = annotateResult( vars, result );
        // Add the file's MIME type to the result.
        result.mimeType = MIMETypes.forPath( vars.path );
        // Add the file's cache control.
        result.cacheControl = vars.fileInfo.cacheControl;
        return result;
    });
        

    /**
     * Return a file's file DB record.
     * Applies the relevant fileset processor, and ACM filter and rewrites.
     */
    const getFileRecord = pipeline( cacheDir )
    .init( initPipeline )
    .open( async ( vars, outs ) => {
        // Make the file record.
        let { path, ctx, fileInfo: { commit } } = vars;
        let { branch } = ctx;
        let record = await makeFileRecord( ctx, path, branch, true );
        record.commit = commit;
        // Print the result.
        jsonPrint( outs, record );
        outs.end();
    },
    'internal/{ctx.account}/{ctx.repo}/records/{commitPath}-{pathHash}.json')
    .step( async ( vars, outs, ins ) => {
        let { ctx } = vars;
        // Apply ACM filters & rewrites.
        // First join the input stream into a single-item list containing the record.
        let records = await jsonlStreamJoin( ins );
        let record = records[0];
        record = acm.filterAndRewrite( ctx, record );
        if( record ) {
            jsonPrint( outs, record );
        }
        outs.end();
    },
    'internal/{ctx.account}/{ctx.repo}/records/{commitPath}-{pathHash}-{ctx.auth.group}.json')
    .done( annotateResult );

    return {
        getFileContents,
        getFileRecord
    };
}
