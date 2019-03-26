/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

/* A class for performing a URL normalization HTML transform.
 *
 * The transform class accepts an HTML input stream and rewrites
 * it so that every *absolute path* URL (i.e. any URL starting
 * with / but which isn't a domain name without URL scheme, e.g.
 * "//example.com/xxx") has a prefix prepended to the URL. This
 * is done so that static HTML files published by Locomote can
 * make absolute references to other files within the same
 * site, but without loosing the ability to host the site under
 * any arbitrary path on the server.
 *
 * The prefix rewrite only applies to certain attributes of a
 * small subset of HTML elements which are known to allow URLs
 * as the attribute value; this includes attributes like srcset
 * which may contain multiple URLs.
 *
 * The transform class uses a partial, lenient HTML parser to
 * extract tag and attribute names from the input stream. The
 * parser will never choke or report errors when presented
 * with malformed HTML, and should be able to correctly insert
 * URL prefixes in most HTML presented to it.
 *
 * The transformer will only operate on HTML 5 documents, i.e.
 * HTML documents with a <!DOCTYPE html> header. HTML documents
 * without the doctype header will be output unmodified.
 *
 * The transformer has the property that given an input stream
 * and an empty URL prefix value, then the transformer output
 * will be byte-for-byte identical to the input, whether or not
 * the input is valid HTML, malformed/invalid HTML, or non-HTML.
 */
const Transform = require('stream').Transform;

const Chars = Object.freeze({
    Tab:    0x09,
    LF:     0x0A,
    CR:     0x0D,
    Space:  0x20,
    '!':    0x21,
    '"':    0x22,
    "'":    0x27,
    '-':    0x2D,
    '/':    0x2F,
    '<':    0x3C,
    '=':    0x3D,
    '>':    0x3E,
    A:      0x41,
    Z:      0x5A,
    '_':    0x5F,
    a:      0x61,
    z:      0x7A
});

/// Convert an array of characters to a JS string.
function str( arr, enc ) {
    return Buffer.from( arr ).toString( enc );
}

/// Test if a character is a valid tag or attribute name character.
function isNameChar( ch ) {
    return (ch >= Chars.A && ch <= Chars.Z)
        || (ch >= Chars.a && ch <= Chars.z)
        || ch == Chars['-']
        || ch == Chars['_'];
}

// Test if a character is a valid tag name character.
function isTagChar( ch ) {
    return ch == Chars['!'] || isNameChar( ch );
}

/// Test if a character is a whitespace character.
function isWhitespace( ch ) {
    return ch == Chars.Space
        || ch == Chars.Tab
        || ch == Chars.LF
        || ch == Chars.CR;
}

/// Test if a character is a non-whitespace character.
function isNonWhitespace( ch ) {
    return !isWhitespace( ch );
}

/// Write an an attribute value.
function writeValue( vars, buffer ) {
    buffer.writeChunk( vars.attrValue );
}

/// Write an attribute value, adding the prefix if the value starts with a slash.
function prefixValue( vars, buffer ) {
    let value = vars.attrValue;
    // Write prefix if value starts with one slash but not two slashes.
    if( value[0] == Chars['/'] && value[1] != Chars['/'] ) {
        buffer.writeChunk( vars.prefix );
    }
    buffer.writeChunk( value );
}

/// Rewrite a set of image source set values.
function prefixSrcSetValues( vars, buffer ) {
    let values = str( vars.attrValue )
        .split(/,/gm)
        .map( v => {
            v = v.trim();
            if( v.charCodeAt( 0 ) == Chars['/'] ) { // slash
                return vars.prefix + v;
            }
            return v;
        })
        .join(', ');
    buffer.writeChunk( values );
}

/// Rewrite URLs in embedded CSS styles.
function prefixCSSURLValues( vars, buffer ) {
    let replacement = `url($1${vars.prefix}/$2`;
    let value = str( vars.attrValue ).replace(/\burl\((\s*)\/([^\/])/g, replacement );
    buffer.writeChunk( value );
}

function endOfTagCheck( ch, vars, continueState ) {
    if( ch == Chars['/'] ) { // slash
        // Close of tag, revert to write-through.
        return 'writethrough';
    }
    if( ch == Chars['>'] ) {
        if( 'script' == vars.tagName ) {
            // Opening <script> tag, find closing tag.
            return 'find-script-end';
        }
        // End of tag, revert to write-through.
        return 'writethrough';
    }
    return continueState;
}

/**
 * The set of supported attribute rewrites, keyed by tag name.
 * Each tag listed here may support one or more rewrites of named
 * attributes on the tag. Each attribute may have a different
 * value rewrite value.
 */
const RewriteTags = Object.freeze({
    base:   { href: prefixValue, target: prefixValue },
    link:   { href: prefixValue, style: prefixCSSURLValues },
    a:      { href: prefixValue, style: prefixCSSURLValues },
    source: { src: prefixValue, srcset: prefixSrcSetValues },
    img:    { src: prefixValue, srcset: prefixSrcSetValues, style: prefixCSSURLValues },
    iframe: { src: prefixValue, style: prefixCSSURLValues },
    embed:  { src: prefixValue, style: prefixCSSURLValues },
    video:  { src: prefixValue, style: prefixCSSURLValues },
    audio:  { src: prefixValue, style: prefixCSSURLValues },
    track:  { src: prefixValue, style: prefixCSSURLValues },
    script: { src: prefixValue },
    '*':    { style: prefixCSSURLValues }
});

const DOCTYPE = '!doctypehtml';

const SM = {
    'find-doctype': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        // Skip whitespace before doctype.
        if( isWhitespace( ch ) ) {
            return 'find-doctype';
        }
        // Start reading doctype.
        if( ch == Chars['<'] ) {
            vars.doctype = [];
            return 'read-doctype';
        }
        // Illegal or non-HTML content? Stop transforming doc.
        return 'writethrough-to-end';
    },
    'read-doctype': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        if( ch == Chars['>'] ) {
            // See if we have html doctype.
            let doctype = str( vars.doctype ).toLowerCase();;
            delete vars.doctype;
            if( doctype == DOCTYPE ) {
                return 'writethrough';
            }
            // Unrecognized doctype, stop transformation.
            return 'writethrough-to-end';
        }
        // Note that only non-whitespace chars are added to the doctype buffer.
        if( !isWhitespace( ch ) ) {
            vars.doctype.push( ch );
        }
        // If we've gone beyond the expected doctype length then stop trying to
        // transform the document.
        if( vars.doctype.length > DOCTYPE.length ) {
            delete vars.doctype;
            return 'writethrough-to-end';
        }
        // Continue reading doctype.
        return 'read-doctype';
    },
    'writethrough': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        if( ch == Chars['<'] ) {
            vars.tagName = [];
            return 'read-tag-name';
        }
        return 'writethrough';
    },
    'writethrough-to-end': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        return 'writethrough-to-end';
    },
    'read-tag-name': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        if( isTagChar( ch ) ) {
            vars.tagName.push( ch );
            return 'read-tag-name';
        }
        // Convert tag name to string.
        let tagName = str( vars.tagName ).toLowerCase();
        vars.tagName = tagName;
        // Check for start of comment.
        if( '!--' == tagName ) {
            vars.cbuff = [];
            return 'find-comment-end';
        }
        // Check if we have a set of rewrite attributes for the element.
        let attrs = RewriteTags[tagName];
        if( !attrs ) {
            // Global rewrites.
            attrs = RewriteTags['*'];
        }
        if( attrs ) {
            vars.attrs = attrs;
            return endOfTagCheck( ch, vars, 'find-attr-name-start');
        }
    },
    // Find the start of an attribute name.
    'find-attr-name-start': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        if( isNameChar( ch ) ) {
            vars.attrName = [ ch ];
            return 'read-attr-name';
        }
        return endOfTagCheck( ch, vars, 'find-attr-name-start' );
    },
    // Read an attribute name.
    'read-attr-name': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        if( isNameChar( ch ) ) {
            vars.attrName.push( ch );
            return 'read-attr-name';
        }
        // Check whether attribute name needs to be written.
        let attrName = str( vars.attrName );
        vars.writeAttr = vars.attrs[attrName] || writeValue;
        if( ch == Chars['='] ) {
            // Have the attribute assignment, find the start of value.
            return 'find-attr-value-start';
        }
        return 'find-attr-equals';
    },
    // Find attribute assignment.
    'find-attr-equals': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        if( ch == Chars['='] ) {
            return 'find-attr-value-start';
        }
        if( isNameChar( ch ) ) {
            // There was no assignment and this is start of the next attr name.
            vars.attrName = [ ch ];
            return 'read-attr-name';
        }
        return endOfTagCheck( ch, vars, 'find-attr-equals' );
    },
    // Find start of attribute value.
    'find-attr-value-start': ( ch, buffer, vars ) => {
        if( ch == Chars['"'] || ch == Chars["'"] ) {
            buffer.writeChar( ch );
            vars.endQuote = ch;
            vars.attrValue = [];
            return 'find-attr-value-end-quote';
        }
        if( isNonWhitespace( ch ) ) {
            vars.attrValue = [ ch ];
            return 'find-attr-value-end-no-quote';
        }
        return 'find-attr-value-start';
    },
    // Find end of quoted attribute value.
    'find-attr-value-end-quote': ( ch, buffer, vars ) => {
        if( ch == vars.endQuote ) {
            vars.writeAttr( vars, buffer );
            vars.attrValue = false;
            buffer.writeChar( ch );
            return 'find-attr-name-start'; 
        }
        if( ch == Chars['>'] ) { // End of tag without end quote.
            vars.writeAttr( vars, buffer );
            vars.attrValue = false;
            buffer.writeChar( ch );
            // Call end of tag check to ensure <script> handling.
            return endOfTagCheck( ch, vars, 'writethrough');
        }
        vars.attrValue.push( ch );
        return 'find-attr-value-end-quote';
    },
    // Find end of non-quoted attribute value.
    'find-attr-value-end-no-quote': ( ch, buffer, vars ) => {
        if( isWhitespace( ch ) ) {
            vars.writeAttr( vars, buffer );
            vars.attrValue = false;
            buffer.writeChar( ch );
            return 'find-attr-name-start'; 
        }
        if( ch == Chars['>'] ) { // End of tag without end quote.
            vars.writeAttr( vars, buffer );
            vars.attrValue = false;
            buffer.writeChar( ch );
            // Call end of tag check to ensure <script> handling.
            return endOfTagCheck( ch, vars, 'writethrough');
        }
        vars.attrValue.push( ch );
        return 'find-attr-value-end-no-quote';
    },
    // Find end of tag.
    'find-tag-end': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        return endOfTagCheck( ch, vars, 'find-tag-end' );
    },
    // Find end of <script> block.
    'find-script-end': ( ch, buffer, vars ) => {
        let next = 'find-script-end';
        buffer.writeChar( ch );
        if( ch == Chars['<'] ) {
            // Start of a tag, start recording its name.
            vars.currentTag = [];
        }
        else if( vars.currentTag ) {
            // Recording a tag name, add slash or name chars to the buffer...
            if( ch == Chars['/'] || isNameChar( ch ) ) {
                vars.currentTag.push( ch );
            }
            // ...else have the full tag name, check if it matches end of script...
            else if( str( vars.currentTag ) == '/script' ) {
                // ...and if so then revert to write-through mode.
                next = 'writethrough';
            }
            else delete vars.currentTag; // ...otherwise done with this tag.
        }
        return next;
    },
    // Find the end of a comment.
    'find-comment-end': ( ch, buffer, vars ) => {
        buffer.writeChar( ch );
        let { cbuff } = vars;
        // Rotate comment buffer.
        cbuff[0] = cbuff[1];
        cbuff[1] = cbuff[2];
        cbuff[2] = ch;
        // Check for end of comment sequence.
        if( cbuff[0] == Chars['-'] && cbuff[1] == Chars['-'] && cbuff[2] == Chars['>'] ) {
            return 'writethrough';
        }
        return 'find-comment-end';
    }
};   

/// Buffer for aggregating single character writes into multi-byte chunks.
class WriteBuffer {

    constructor( outs, size ) {
        this._buffer = Buffer.alloc( size );
        this._offset = 0;
        this._outs = outs;
    }

    writeChar( ch ) {
        if( this._offset >= this._buffer.length ) {
            this.flush();
        }
        this._buffer[this._offset++] = ch;
    }

    writeChunk( chunk ) {
        if( typeof chunk == 'string' ) for( let i = 0; i < chunk.length; i++ ) {
            this.writeChar( chunk.charCodeAt( i ) );
        }
        // chunk is array of buffer
        else for( let i = 0; i < chunk.length; i++ ) {
            this.writeChar( chunk[i] );
        }
    }

    flush() {
        if( this._offset > 0 ) {
            let chunk = this._buffer.slice( 0, this._offset );
            this._outs.push( chunk );
        }
        // Create a new buffer for new content - important not to reuse the
        // existing buffer, as some stream consumers won't immediately use
        // the data pushed to them.
        this._buffer = Buffer.alloc( this._buffer.length );
        this._offset = 0;
    }

}

/**
 * An HTML stream transformer.
 * Rewrites a defined set of attribute values so that absolute URLs within those
 * attributes are prefixed with a specified value.
 */
class HTMLTransformer extends Transform {

    /**
     * Make a new transformer.
     * @param ctx   A request context.
     * @param outs  An output stream.
     */
    constructor( prefix = '', outs ) {
        super();
        // Remove any trailing slash on the prefix (not needed, because
        // the values the prefix is prepended to will always start with
        // a slash).
        if( prefix[prefix.length - 1] == '/' ) {
            prefix = prefix.slice( 0, -1 );
        }
        this._vars   = { prefix };
        this._state  = 'find-doctype';
        this._buffer = new WriteBuffer( this, 4096 );
        this.pipe( outs );
    }

    _transform( chunk, encoding, callback ) {
        let vars   = this._vars;
        let state  = this._state;
        let buffer = this._buffer;
        let prev = state;
        let step = SM[state];
        for( let ch of chunk.values() ) {
            state = step( ch, buffer, vars );
            step = SM[state];
            if( !step ) {
                throw new Error(`Bad parser state transition: ${prev} -> ${state}`);
            }
            prev = state;
        }
        this._state = state;
        callback();
    }

    _flush( callback ) {
        let { attrValue } = this._vars;
        if( attrValue ) {
            this._buffer.writeChunk( attrValue );
        }
        this._buffer.flush();
    }

}

exports.HTMLTransformer = HTMLTransformer;

if( require.main === module ) {
    let [ , , source, prefix ] = process.argv;
    console.error('Prefix:', prefix );
    let transformer = new HTMLTransformer( prefix, process.stdout );
    require('fs').createReadStream( source ).pipe( transformer );
}
