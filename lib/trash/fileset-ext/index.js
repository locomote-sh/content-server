/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const { Fileset }            = require('./fileset');
const { FilesetProcessor }   = require('./processor');
const { RelocatablePageFSP } = require('./relocatable-page-fsp');
const { JSONDataFSP }        = require('./json-data-fsp');

function init( loader ) {

    const DefaultFilesets = [
        {
            category:       'app',
            cache:          'app',
            include:        '_app/**/*'
        },
        {
            category:       'pages',
            cache:          'none',
            searchable:     true,
            processor:      new RelocatablePageFSP( loader, 'pages'),
            include:        '**/*.html'
        },
        {
            category:       'json',
            cache:          'none',
            processor:      new JSONDataFSP( loader, 'json'),
            include:        '**/*.json',
            excludes:       ['_server/**/*','locomote.json','_locomote/**/*']
        },
        {
            category:       'files',
            cache:          'content',
            cacheControl:   'public, must-revalidate, max-age=60',
            include:        '**/*',
            excludes:       ['_server/**/*','locomote.json','_locomote/**/*']
        },
        {
            category:       'server',
            cache:          'none',
            include:        '_server/**/*'
        }
    ].map( ( definition, idx ) => new Fileset( definition, idx ) );

    /**
     * Get filesets for a specified request context.
     * Currently just returns the static fileset definitions, but in future this
     * method can be used to support per-account or per-repo definitions, or to
     * read definitions directly from a repo.
     * @param ctx       A request context.
     * @param version   An optional version identifier (e.g. a git commit-ish); if
     *                  provided then return the definitions in placce at that point
     *                  in the version history.
     */
    async function getFilesets( ctx, version ) {
        return DefaultFilesets;
    }

    // TODO Renamed from getCategoryFileset
    async function getFilesetForCategory( ctx, version, category ) {
        const filesets = await getFilesets( ctx, version );
        return filesets.find( fs => fs.category == category );
    }

    // ---

    /**
     * Lookup the fileset for a file path on a branch of a content repo.
     * @param ctx       A request context.
     * @param version   A file history version identifier.
     * @param path      A file path, relative to a content repo root.
     * @param fsCache   Optional fileset cache; used to speed the lookup of
     *                  fileset definitions when processing multiple records.
     */
    async function getFilesetForPath( ctx, version, path, fsCache = {} ) {
        let filesets = fsCache[version];
        if( !filesets ) {
            filesets = await getFilesets( ctx, version );
            fsCache[version] = filesets;
        }
        // Note that filesets are returned in priority order; find the
        // first fileset that the file path belongs to and generate its
        // file record by processing with the fileset.
        const fileset = filesets.find( fileset => fileset.contains( path ) );
        return fileset;
    }

    /**
     * Make a file record from a git output line.
     * @param ctx       A request context.
     * @param version   A file history version identifier.
     * @param path      A file path, relative to a content repo root.
     * @param status    The default file record status, defaults to true
     *                  indicating an active record.
     * @param fsCache   Optional fileset cache; used to speed the lookup of
     *                  fileset definitions when processing multiple records.
     */
    async function makeFileRecord( ctx, version, path, status = true, fsCache ) {
        const fileset = await getFilesetForPath( ctx, version, path, fsCache );
        if( !fileset ) {
            return;
        }
        const record = fileset.makeFileRecord( ctx, path, status, version );
        return record;
    }

    return {
        getFilesets,
        getFilesetForCategory,
        getFilesetForPath,
        makeFileRecord 
    }

}

module.exports = {
    init,
    Fileset,
    FilesetProcessor
};
