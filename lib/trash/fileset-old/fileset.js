/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const FGlobs = require('../fileglob');
const { FilesetProcessor } = require('./processor');
const { fingerprint } = require('../utils');

/**
 * A fileset.
 */
class Fileset {

    constructor( definition, priority = 0 ) {

        if( !definition ) {
            throw new Error('Fileset definition is required');
        }

        let {
            category,
            cache,
            cacheControl,
            restricted = false,
            searchable = false,
            include,
            includes = [],
            exclude,
            excludes = [],
            acm,
            processor
        } = definition;

        // The fileset category.
        if( !category ) {
            throw new Error('Fileset category must be provided');
        }
        this.category = category;

        if( !Array.isArray( includes ) ) {
            throw new Error('Fileset includes must be an array');
        }
        if( include !== undefined ) {
            includes.push( include );
        }
        if( !Array.isArray( excludes ) ) {
            throw new Error('Fileset excludes must be an array');
        }
        if( exclude !== undefined ) {
            excludes.push( exclude );
        }
        if( typeof restricted != 'boolean' ) {
            restricted = false;
        }
        if( typeof searchable != 'boolean' ) {
            searchable = false;
        }
        if( typeof acm != 'function' ) {
            acm = files => files;
        }

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

        // The fileset contents processor.
        if( !(processor instanceof FilesetProcessor) ) {
            processor = new FilesetProcessor( this.category );
        }
        this._processor = processor;

        this._globset = FGlobs.makeCompliment( includes, excludes );

        // A unique fingerprint for the fileset and its configuration.
        let canonical = JSON.stringify([
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
     * @param repoPath  The path to the content repository being processed.
     * @param path      A file path.
     * @param active    A boolean indicating whether the file is active or not.
     * @param commit    The commit being processed; can be used to read the
     *                  file's data from the appropriate commit.
     */
    makeFileRecord( repoPath, path, active, commit ) {
        let record = this._processor.makeFileRecord( repoPath, path, active, commit );
        return record;
    }

    /**
     * Pipe a file's contents from the source repo to an output stream.
     * Used when serving a file's contents.
     * @param ctx       A file DB request context.
     * @param path      A file path.
     * @param commit    The commit being accessed.
     * @param outs      An output stream to write the file to.
     */
    pipeContents( ctx, path, commit, outs ) {
        return this._processor.pipeContents( ctx, path, commit, outs );
    }

}

exports.Fileset = Fileset;
