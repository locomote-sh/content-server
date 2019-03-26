/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const {
    makeCompliment 
//} = require('@locomote/fileglob');
} = require('../fileglob');

const {
    FilesetProcessor
} = require('./processor');

const {
    fingerprint
//} = require('@locomote/utils');
} = require('../utils');

/**
 * A fileset.
 */
class Fileset {

    constructor( definition, priority = 0 ) {

        if( !definition ) {
            throw new Error('Fileset definition is required');
        }

        const {
            category,
            cache,
            cacheControl,
            restricted      = false,
            searchable      = false,
            include,
            includes        = [],
            exclude,
            excludes        = [],
            acm             = files => files,
            processor       = new FilesetProcessor( category )
        } = definition;

        // The fileset category.
        if( !category ) {
            throw new Error('Fileset "category" property must be provided');
        }

        if( !Array.isArray( includes ) ) {
            throw new Error('Fileset "includes" property must be an array');
        }
        if( include !== undefined ) {
            includes.push( include );
        }
        if( !Array.isArray( excludes ) ) {
            throw new Error('Fileset "excludes" property must be an array');
        }
        if( exclude !== undefined ) {
            excludes.push( exclude );
        }
        if( typeof restricted != 'boolean' ) {
            throw new Error('Fileset "restricted" property must be a boolean');
        }
        if( typeof searchable != 'boolean' ) {
            throw new Error('Fileset "searchable" property must be a boolean');
        }
        if( typeof acm != 'function' ) {
            throw new Error('Fileset "acm" property must be a function');
        }
        // The fileset contents processor.
        if( !(processor instanceof FilesetProcessor) ) {
            throw new Error('Fileset "processor" property must be a FilesetProcessor instance');
        }

        this.category = category;

        // The fileset priority. Lower values mean higher priority.
        // When a file can belong to more than one fileset, it is assigned
        // to the highest priority fileset.
        this.priority = priority;

        // Flag indicating whether the fileset's contents are restricted.
        this.restricted = restricted;

        // Flag indicating whether the fileset's contents are searchable.
        this.searchable = searchable;

        // Apply the fileset's ACM filter to a list of file records.
        this.acm = acm;

        /// HTTP cache control headers.
        this.cacheControl = cacheControl;

        this._processor = processor;

        this._globset = makeCompliment( includes, excludes );

        // A unique fingerprint for the fileset and its configuration.
        const canonical = JSON.stringify([
            includes,
            excludes,
            restricted,
            processor.toString(),
            acm.toString()
        ]);
        this.fingerprint = fingerprint( canonical );
    }

    /**
     * Test if a file path belongs to the fileset.
     */
    contains( path ) {
        return this._globset.matches( path )
    }

    /**
     * Filter a list of file paths and return only those paths belonging to the
     * fileset.
     */
    filter( paths ) {
        return this._globset.filter( paths );
    }

    /**
     * Process a file path by generating its file record.
     * @param ctx       A request context.
     * @param path      A file path.
     * @param active    A boolean indicating whether the file is active or not.
     * @param version   A version identifier, e.g. commit hash.
     */
    makeFileRecord( ctx, path, active, commit ) {
        const record = this._processor.makeFileRecord( ctx, path, active, commit );
        return record;
    }

    /**
     * Pipe a file's contents from the source repo to an output stream.
     * Used when serving a file's contents.
     * @param ctx       A request context.
     * @param path      A file path.
     * @param version   A version identifier, e.g. commit hash.
     * @param outs      An output stream to write the file to.
     */
    pipeContents( ctx, path, commit, outs ) {
        return this._processor.pipeContents( ctx, path, commit, outs );
    }

}

exports.Fileset = Fileset;
