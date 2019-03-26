/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const Path  = require('path');

const { PageFSP }         = require('./page-fsp');
const { HTMLTransformer } = require('./html-transformer');

/**
 * A relocatable HTML page fileset processor.
 * Relocatable pages are static HTML pages which can be hosted under
 * arbitrary base path locations. This is done by rewriting absolute
 * path URLs within the HTML by prepending a base path to the URL
 * before it is served to the client.
 */
class RelocatablePageFSP extends PageFSP {

    constructor( category ) {
        super( category );
    }

    /**
     * Pipe a file's contents.
     * @param ctx       A file request context.
     * @param loader    A file loader.
     * @param path      The path to the file to pipe.
     * @param version   The version of the file to pipe.
     * @param outs      An output stream to pipe the file to.
     */
    async pipeContents( ctx, loader, path, version, outs ) {
        if( Path.extname( path ) == '.html' ) {
            // Prepend the base path the repo is accessed under to absolute
            // paths in HTML content.
            outs = new HTMLTransformer( ctx.basePath, outs );
        }
        return super.pipeContents( ctx, loader, path, version, outs );
    }

}

module.exports = { RelocatablePageFSP }
