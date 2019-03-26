/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const Path  = require('path');
const Log   = require('log4js').getLogger('fsp');

const { PageFSP } = require('./page-fsp');
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

    async pipeContents( ctx, path, commit, outs ) {
        if( Path.extname( path ) == '.html' ) {
            // Prepend the base path the repo is accessed under to absolute
            // paths in HTML content.
            outs = new HTMLTransformer( ctx.basePath, outs );
        }
        return super.pipeContents( ctx, path, commit, outs );
    }

}

module.exports = { RelocatablePageFSP }
