/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const Git     = require('../git');
const Cheerio = require('cheerio');
const Log     = require('log4js').getLogger('fsp');

const { FilesetProcessor } = require('./processor');


// Get the indexable content of a page or post. Returns the text content
// of the element with ID = 'content'.
function readIndexableContent( html ) {
    let text = '';
    if( html ) {
        // Extract text content from post HTML.
        text = Cheerio.load( html ).text();
        // Strip extraneous whitespace.
        text = text.split(/\s+/g).join(' ');
    }
    return text;
}

/**
 * An HTML pages fileset processor.
 * This fileset processor is used to build the file DB representation of HTML
 * pages by parsing the file contents and extracting certain key values.
 * At a minimum, the processor reads the page title from its <title> element,
 * and the page's HTML content from its <body> element. This behaviour can be
 * modified and extended by including <meta> elements in the HTML with the
 * following names:
 * - locomote.selector.content: Specify an alternative CSS selector for the
 *   page content; the default value is 'body'.
 * - locomote.page.title: Specify the page title. Overrides the <title> element.
 * - locomote.page.type: The page type; defaults to 'page'.
 * - locomote.page.sort: The page sort order.
 * - locomote.page.image: Specify the path to an image to associate with the page.
 * - locomote.page.meta: JSON encoded page meta data.
 * - keywords: Extract page keywords.
 */
class PageFSP extends FilesetProcessor {

    constructor( category ) {
        super( category );
    }

    async makeFileRecord( repoPath, path, active, commit ) {
        let record = await super.makeFileRecord( repoPath, path, active, commit );
        if( record.status == 'deleted' ) {
            return false;
        }
        let html = await Git.readFileAtCommit( repoPath, commit, record.path );
        // Parse the HTML.
        let $ = Cheerio.load( html );
        // Setup the record.
        record.page = {
            title:  $('title').text(),
            type:   'page'
        };
        // Defaults vars.
        let bodySel = 'body';
        // Process the page's meta data.
        $('meta').each( ( idx, meta ) => {
            let $meta = $( meta );
            switch( $meta.attr('name') ) {
            case 'locomote-selector-body':
                bodySel = $meta.attr('content');
                break;
            case 'locomote-page-title':
                record.page.title = $meta.attr('content');
                break;
            case 'locomote-page-type':
                record.page.type = $meta.attr('content');
                break;
            case 'locomote-page-sort':
                record.page.sort = $meta.attr('content');
                break;
            case 'locomote-page-image':
                record.page.image = $meta.attr('content');
                break;
            case 'locomote-page-meta':
                try {
                    record.meta = JSON.parse( $meta.attr('content') );
                }
                catch( e ) {
                    // JSON parse error - need some way to feed to the
                    // build log.
                }
                break;
            case 'keywords':
                record.page.keywords = $meta.attr('content');
                break;
            }
        });
        // Read the document body content.
        let body = $( bodySel ).html();
        if( body ) {
            record.page.body = body.trim();
        }
        // If page image specified then convert path to file ID.
        if( record.page.image ) {
            let image = await this._iddb.get( record.page.image, repoPath );
            if( image ) {
                record.page.image = image.id;
            }
        }
        return record;
    }

    async makeSearchRecord( record ) {
        let { id, path, page: { title, content, keywords } } = record;
        content = readIndexableContent( content );
        return { id, path, title, content, keywords };
    }
}

module.exports = { PageFSP }
