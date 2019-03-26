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

const Sqlite3 = require('sqlite3').verbose();

const Log = require('log4js').getLogger('search/db');

/// Limit the maximum number of search results to 1000 rows.
const SearchResultsLimit = 1000;

/// The search DB schema.
const Schema = [
    // The scope table; used to define a set of files that
    // belong to a specific branch of a content repo.
    `CREATE TABLE IF NOT EXISTS scope (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account     TEXT NOT NULL,
        repo        TEXT NOT NULL,
        branch      TEXT NOT NULL,
        index_date  TEXT,
        since       TEXT)`,
    // All scopes must be unique for account/repo/branch.
    `CREATE UNIQUE INDEX IF NOT EXISTS scope_key 
        ON scope (account, repo, branch)`,
    // The files table; defines a file at a specific path
    // within a specific scope.
    `CREATE TABLE IF NOT EXISTS files (
        id          TEXT NOT NULL,
        scopeid     INTEGER NOT NULL,
        path        TEXT NOT NULL,
        category    TEXT NOT NULL,
        title       TEXT NOT NULL,
        textid      INTEGER NOT NULL)`,
    // All file IDs must be unique within the scope.
    `CREATE UNIQUE INDEX IF NOT EXISTS files_scope_key
        ON files (id, scopeid)`,
    // Foreign key on the file text content.
    `CREATE INDEX IF NOT EXISTS files_text_key ON files (textid)`,
    // The searchable text content of a file.
    `CREATE VIRTUAL TABLE IF NOT EXISTS text USING fts4()`
];

/// A connection to the search database.
function Connection( path, writeable = false ) {
    let mode = writeable
        ? Sqlite3.OPEN_READWRITE | Sqlite3.OPEN_CREATE
        : Sqlite3.OPEN_READONLY;
    this._db = new Sqlite3.Database( path, mode );
}

/**
 * Initialize the database connection.
 * Ensures that the DB schema is created.
 */
Connection.prototype.init = async function( schema ) {
    for( let i = 0; i < schema.length; i++ ) {
        await this.run( schema[i] );
    }
}

/**
 * Ensure that a record exists for the specified scope.
 */
async function ensureScope( conn, account, repo, branch ) {
    let params = {
        $account:   account,
        $repo:      repo,
        $branch:    branch
    };
    // Test whether a scope record already exists.
    let sql = 'SELECT * FROM scope WHERE account=$account AND repo=$repo AND branch=$branch';
    let row = await conn.first( sql, params );
    if( row === undefined ) {
        // No scope record found, so insert a new one.
        sql = 'INSERT INTO scope (account, repo, branch) VALUES ($account, $repo, $branch)';
        let id = await conn.run( sql, params );
        row = { id, account, repo, branch };
    }
    return row;
}

/**
 * Make a file scope for the specified account/repo/branch.
 */
Connection.prototype.makeScope = async function( account, repo, branch ) {
    let scope = await ensureScope( this, account, repo, branch );
    return new Scope( this, scope );
}

/**
 * Get the since commit for a file scope.
 */
Connection.prototype.lastCommitForScope = async function( account, repo, branch ) {
    let params = {
        $account:   account,
        $repo:      repo,
        $branch:    branch
    };
    // Test whether a scope record already exists.
    let sql = 'SELECT since FROM scope WHERE account=$account AND repo=$repo AND branch=$branch';
    let row = await this.first( sql, params );
    return row && row.since;
}

/**
 * Run a SQL statement on the database.
 * Returns the 'lastID' property, when present.
 */
Connection.prototype.run = function( statement, params = [] ) {
    return new Promise( ( resolve, reject ) => {
        // NOTE: Important to use a function and not a lambda here, as
        // we need access to the function's 'this' argument so that the
        // lastID can be retrieved.
        this._db.run( statement, params, function( err ) {
            if( err ) {
                reject( err );
            }
            else {
                resolve( this.lastID );
            }
        });
    });
}

/**
 * Run a SQL query on the database and return all results.
 */
Connection.prototype.all = function( query, params = [] ) {
    return new Promise( ( resolve, reject ) => {
        this._db.all( query, params, ( err, rows ) => {
            if( err ) {
                reject( err );
            }
            else {
                resolve( rows );
            }
        });
    });
}

/**
 * Run a SQL query on the database and return the first result.
 */
Connection.prototype.first = async function( query, params ) {
    // NOTE this is just a thin wrapper for Connection.all - a more
    // efficient implementation (when expecting very large results)
    // would use the db.get() function.
    let rows = await this.all( query, params );
    return rows.length > 0 ? rows[0] : undefined;
}

const ExcerptLength = 500;

/**
 * Make an excerpt for a search result row.
 * The excerpt shows leading and trailing context around the first matching search
 * term. Matched search terms are highlighted with <em> tags.
 */
function makeExcerpt( row, term, mode ) {
    let text = row.content;
    let excerpt = '';
    if( text ) {
        // Construct list of terms.
        let terms;
        if( mode == 'exact' ) {
            terms = [ term ];
        }
        else {
            terms = term.split(/\s+/g);
        }
        // Find index of first match.
        // JS doesn't have a case-insensitive indexof function, so use a
        // lowercase version of the content text. (We want the original
        // case version later on, when we generate the excerpt).
        let lctext = text.toLowerCase();
        let fmidx = terms.reduce( ( fmidx, term ) => {
            let idx = lctext.indexOf( term );
            return idx > -1 ? Math.max( idx, fmidx ) : fmidx;
        }, 0 );
        // Extract an excerpt around the first match.
        let clen  = ExcerptLength / 2;
        let start = fmidx - clen;
        let end   = fmidx + clen;
        if( start < 0 ) {
            end -= start;
            start = 0;
        }
        if( end > text.length ) {
            let diff = end - text.length;
            if( start > diff ) {
                start -= diff;
            }
            else {
                start = 0;
            }
            end = text.length - 1;
        }
        // Extract excerpt.
        excerpt = text.substring( start, end );
        // Add ellipses if not at start/end.
        if( start > 0 ) {
            excerpt = '...'+excerpt;
        }
        if( end < text.length - 1 ) {
            excerpt = excerpt+'...';
        }
        // Highlight terms within the excerpt.
        excerpt = terms.reduce( ( excerpt, term ) => {
            let re = new RegExp( term, 'ig');
            return excerpt.replace( re, '<em>$&</em>');
        }, excerpt );
    }
    return excerpt;
}

/**
 * Search for text within a specified file scope.
 * This function is invoked with a function which is called once for each
 * result row found. The function returns a deferred promise which is
 * resolved once all results have been processed.
 * @param account   The account to search within.
 * @param repo      The repo to search within.
 * @param branch    The branch to search within.
 * @param term      The text to search for.
 * @param mode      The search mode; one of 'any', 'all' or 'exact'.
 * @param path      An optional context path. If specified then results are limited to
 *                  files under the specified path.
 * @param oneach    A callback for processing each result row.
 */
Connection.prototype.search = function( account, repo, branch, term, mode, path, oneach ) {
    // Generation search term parameter according to match mode.
    // See https://www.sqlite.org/fts3.html#_set_operations_using_the_enhanced_query_syntax
    let $term;
    switch( mode ) {
    case 'any':
        // e.g. 'one two three' -> 'one OR two OR three'
        $term = term.split(/\s+/g).join(' OR ');
        break;
    case 'all':
        // e.g. 'one two three' -> 'one AND two AND three'
        $term = term.split(/\s+/g).join(' AND ');
        break;
    case 'exact':
    default:
        // Use term as is.
        $term = term;
    }
    // FTS SQL.
    // NOTE: Following contains a hack to read the text content of matching
    // files, by selecting it from one of the ancillary tables generated by
    // sqlite when the FTS table is created (i.e. text_content.c0content).
    // This is a potentially brittle implementation, if other sqlite versions
    // were to change the schema used for these support tables.
    let sql = `SELECT
            files.id AS id,
            files.path AS path,
            files.title AS title,
            files.category AS category,
            text_content.c0content AS content
        FROM files, scope, text_content
        WHERE files.textid IN
            (SELECT rowid FROM text WHERE text MATCH $term LIMIT $limit)
        AND files.textid        = text_content.docid
        AND files.scopeid       = scope.id
        AND scope.account       = $account
        AND scope.repo          = $repo
        AND scope.branch        = $branch`;
    // If a context path is specified then append a clause to the SQL.
    if( path ) {
        sql += ' AND files.path LIKE $path';
        path = `${path}%`;
    }
    // Prepare query params.
    let ps = {
        $account:   account,
        $repo:      repo,
        $branch:    branch,
        $term:      $term,
        $limit:     SearchResultsLimit
    };
    if( path ) {
        ps.$path = path;
    }
    // Execute the query and stream the result; return a deferred promise which
    // resolves when all results have been written.
    return new Promise( ( resolve, reject ) => {
        this._db.each( sql, ps,
            ( err, row ) => {
                if( err ) {
                    Log.error('Handling row', err );
                }
                else {
                    row.excerpt = makeExcerpt( row, term, mode );
                    delete row.content;
                    oneach( row );
                }
            },
            err => {
                if( err ) {
                    reject( err );
                }
                else {
                    resolve();
                }
            });
    });
}

/**
 * A file scope. Defines a set of files for a specific account/repo/branch.
 */
function Scope( conn, scope ) {
    this._conn  = conn;
    this._scope = scope;
    // The hash of the last commit loaded into the db for the current
    // account/repo/branch.
    this.since  = scope.since;
    // The branch the scope is defined on.
    this.branch = scope.branch;
}

/**
 * Start a transaction.
 */
Scope.prototype.startTransaction = function() {
    return this._conn.run('BEGIN TRANSACTION');
}

/**
 * Commit the current transaction.
 */
Scope.prototype.commit = function() {
    return this._conn.run('COMMIT');
}

/**
 * Rollback the current transaction.
 */
Scope.prototype.rollback = function() {
    return this._conn.run('ROLLBACK TRANSACTION');
}

/**
 * Update the searchable text content for a file within the current scope.
 * @param record    A file record with the following properties:
 *                  - id:       The unique file ID.
 *                  - path:     The file path.
 *                  - title:    The file title.
 *                  - category: The fileset category.
 *                  - content:  The searchable text content.
 *                  - deleted:  True if the file has been deleted.
 */
Scope.prototype.updateContent = async function( record ) {
    let scopeid = this._scope.id;
    let conn    = this._conn;

    // Try to read a text ID for the record.
    let sql;
    let row;
    if( !record.id ) {
        // No file ID, try using the file path.
        let sql = 'SELECT id, textid FROM files WHERE scopeid=$scopeid AND path=$path';
        // Lookup text ID.
        let params = {
            $scopeid:   scopeid,
            $path:      record.path
        };
        row = await conn.first( sql, params );
    }
    else {
        // Lookup using file ID.
        let sql = 'SELECT id, textid FROM files WHERE scopeid=$scopeid AND id=$id';
        // Lookup text ID.
        let params = {
            $scopeid:   scopeid,
            $id:        record.id
        };
        row = await conn.first( sql, params );
    }
    // If text ID found then update or delete existing record.
    if( row ) {
        let { id, textid } = row;
        let params = { $textid: textid };
        // Text record ID found, so updating an existing entry.
        if( record.deleted ) {
            // File has been deleted; delete the text and files records.
            await conn.run('DELETE FROM text WHERE rowid=$textid',   params );
            await conn.run('DELETE FROM files WHERE textid=$textid', params );
        }
        else {
            params.$text = record.content;
            // Update the text content for the file.
            await conn.run('UPDATE text SET text=$text WHERE rowid=$textid', params );
            // Update title and category on the files record.
            await conn.run('UPDATE files SET title=$title, category=$category WHERE id=$id', {
                $id:        id,
                $title:     record.title,
                $category:  record.category
            });
        }
        return id;
    }
    else if( !record.deleted ) {
        if( record.id ) {
            // No text record ID found, so insert new text record.
            let textid = await conn.run('INSERT INTO text VALUES ($text)', {
                $text: record.content
            });
            // Insert new files record.
            let sql = `INSERT INTO files
                          ( id,  scopeid,  path,  title,  category,  textid) 
                   VALUES ($id, $scopeid, $path, $title, $category, $textid)`;
            let id = await conn.run( sql, {
                $id:        record.id,
                $scopeid:   scopeid,
                $path:      record.path,
                $title:     record.title,
                $category:  record.category,
                $textid:    textid 
            });
            return id;
        }
        let { account, repo, branch } = this._scope;
        Log.warn('Unable to update content for %s/%s/%s/%s', account, repo, branch, record.path );
    }
    // Else record is deleted, nothing more to do.
    return false;
}

/**
 * Update the scope record.
 * @param commit    The hash of the current commit for the scope.
 */
Scope.prototype.updateScope = async function( commit ) {
    let id   = this._scope.id;
    let conn = this._conn;
    await conn.run('UPDATE scope SET index_date=$index_date, since=$since WHERE id=$id', {
        $id:            id,
        $index_date:    new Date().toISOString(),
        $since:         commit
    });
}

/// Connect to the search DB using the specified settings.
async function connect( dbPath, writeable ) {
    let conn = new Connection( dbPath, writeable );
    await conn.init( Schema );
    return conn;
}

module.exports = { connect };

