/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const { Fileset }            = require('./fileset');
const { FilesetProcessor }   = require('./processor');
const { RelocatablePageFSP } = require('./relocatable-page-fsp');
const { JSONDataFSP }        = require('./json-data-fsp');

const DefaultFilesets = [
    {
        category:       'app',
        cache:          'app',
        include:        '_app/**/*'
    },
    {
        category:       'app/templates',
        cache:          'app',
        include:        '_templates/**/*.html'
    },
    {
        category:       'assets',
        cache:          'content',
        cacheControl:   'public, must-revalidate, max-age=60',
        include:        '_assets/***'
    },
    {
        category:       'content/pages',
        cache:          'none',
        include:        '_pages/**/*.html',
        searchable:     true,
        processor:      new RelocatablePageFSP('content/pages')
    },
    {
        category:       'content/data',
        cache:          'none',
        include:        '_data/**/*.json',
        processor:      new JSONDataFSP('content/data')
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
 * @param commit    An optional commit-ish; if provided then return the definitions
 *                  in place at that commit (when definitions are defined within
 *                  a repo).
 */
async function getFilesets( ctx, commit ) {
    return DefaultFilesets;
}

async function getCategoryFileset( ctx, commit, category ) {
    let filesets = await getFilesets( ctx, commit );
    return filesets.find( fs => fs.category == category );
}

exports.getFilesets         = getFilesets;
exports.getCategoryFileset  = getCategoryFileset;
exports.Fileset             = Fileset;
exports.FilesetProcessor    = FilesetProcessor;

