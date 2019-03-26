/*************************************************************
 * Copyright Locomote Limited 2018 ---- All Rights Reserved. *
 * Unauthorized copying of this file is strictly prohibited. *
 *************************************************************/

const Git = require('../git');

/**
 * A class for processing file records and contents.
 */
class FilesetProcessor {

    /**
     * Create a new processor.
     * @param category  The fileset category name.
     */
    constructor( category, searchable = false ) {
        this._category = category;
    }

    /**
     * Generate a file record from a file path.
     * File records are used to populate the updates feed with info on modified files.
     * @param repoPath  The path to the content repository being processed.
     * @param path      A file path.
     * @param active    A boolean indicating whether the file is active or not.
     * @param commit    The commit being processed; can be used to read the
     *                  file's data from the appropriate commit.
     */
    async makeFileRecord( repoPath, path, active, commit ) {
        let category = this._category;
        let status = active ? 'published' : 'deleted';
        let record = { path, category, status };
        return record;
    }

    /**
     * Make category's the search record.
     */
    async makeSearchRecord( record ) {
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
    async pipeContents( ctx, path, commit, outs ) {
        let { repoPath } = ctx;
        await Git.pipeFileAtCommit( repoPath, commit, path, outs );
    }
}

exports.FilesetProcessor = FilesetProcessor;
