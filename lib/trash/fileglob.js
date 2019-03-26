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

/**
 * Prototype for all set classes.
 */
function Set() {}
Set.prototype.matches = function() { return false; }
Set.prototype.filter = function() { return []; }

const EmptySet = new Set();

/**
 * Match file glob patterns against file path strings.
 */
function FileGlob( glob ) {
    // Convert the glob pattern to a regex.
    let pattern = '';
    for( let i = 0; i < glob.length; i++ ) {
        let ch = glob[i];
        if( ch == '*' ) {
            if( glob[i + 1] == '*' && glob[i + 2] == '/' ) {
                // The glob '**/' matches zero one or more path sections.
                pattern += '([^/]*/)*';
                i += 2;
            }
            else {
                // The glob '*' matches zero one or more filename characters.
                pattern += '[^/]*';
            }
        }
        else if( ch == '?' ) {
            // The glob '?' matches a single filename character.
            pattern += '[^/]';
        }
        else if( ch == '.' ) {
            pattern += '\\.';
        }
        else {
            pattern += ch;
        }
    }

    pattern = '^'+pattern+'$';
    let re = new RegExp( pattern );
    /**
     * Test whether this file glob matches a file path.
     */
    function matches( path ) {
        return re.test( path );
    }
    /**
     * Filter a list of paths and return only those paths matching this file glob.
     */
    function filter( list ) {
        return list.filter( ( path ) => {
            return matches( path );
        });
    }
    this.matches = matches;
    this.filter = filter;
    this.toString = () => { return re.toString(); }
}

/**
 * Match a set of file glob patterns against file path strings.
 */
function FileGlobSet( globs ) {
    // Convert the list of glob patterns to a list of file globs.
    let fglobs = globs.map( ( glob ) => {
        return new FileGlob( glob );
    });
    /**
     * Test whether a file path matches any of the file globs in the set.
     */
    function matches( path ) {
        return fglobs.some( ( fglob ) => {
            return fglob.matches( path );
        });
    }
    /**
     * Filter a list of paths and return only those paths matching one of the file
     * globs in this set.
     */
    function filter( list ) {
        return list.filter( ( path ) => {
            return matches( path );
        });
    }
    this.matches = matches;
    this.filter = filter;
}
FileGlobSet.prototype = EmptySet;

/**
 * A set compliment. Matches items in includes which aren't in excludes.
 */
function Compliment( includes, excludes ) {
    /**
     * Test whether a path is matched by includes, but not matched by excludes.
     */
    function matches( path ) {
        return includes.matches( path ) && !excludes.matches( path );
    }
    /**
     * Filter a list of paths and return only those paths belonging to this
     * compliment.
     */
    function filter( list ) {
        return list.filter( ( path ) => {
            return matches( path );
        });
    }
    this.matches = matches;
    this.filter = filter;
}
Compliment.prototype = EmptySet;

/**
 * A union of sets. Matches items in any of its component sets.
 */
function Union( sets ) {
    /**
     * Test whether a path belongs to some set in this union.
     */
    function matches( path ) {
        return sets.some( ( set ) => {
            return set.matches( path );
        });
    }
    /**
     * Filter a list of paths and return only those paths belonging to
     * this union.
     */
    function filter( list ) {
        return list.filter( ( path ) => {
            return matches( path );
        });
    }
    this.matches = matches;
    this.filter = filter;
}
Union.prototype = new Set();

function isaSet( x ) {
    return x instanceof Set;
}

/**
 * Make a new file glob.
 */
function make( glob ) {
    return new FileGlob( glob );
}

/**
 * Make a new file glob set.
 */
function makeSet( globs ) {
    if( globs === undefined ) {
        return EmptySet;
    }
    if( isaSet( globs ) ) {
        return globs;
    }
    if( !Array.isArray( globs ) ) {
        globs = [ globs ];
    }
    return new FileGlobSet( globs );
}

/**
 * Make the compliment of two file glob sets.
 */
function makeCompliment( includes, excludes ) {
    return new Compliment( makeSet( includes ), makeSet( excludes ) );
}

/**
 * Return the union of multiple sets.
 */
function makeUnion() {
    let sets = [];
    for( let i = 0; i < arguments.length; i++ ) {
        sets.push( makeSet( arguments[i] ) );
    }
    return new Union( sets );
}

exports.make = make;
exports.makeSet = makeSet;
exports.makeCompliment = makeCompliment;
exports.makeUnion = makeUnion;

/*
let files = [
    'package.json',
    'node-terminal/docs.txt',
    'node-terminal/examples',
    'node-terminal/examples/clear.js',
    'node-terminal/examples/colors.js',
    'node-terminal/examples/info.js',
    'node-terminal/examples/moving.js',
    'node-terminal/index.js',
    'node-terminal/LICENSE',
    'node-terminal/package.json',
    'node-terminal/README.md',
    'node-terminal/terminal.js',
    'node-terminal/tests',
    'node-terminal/tests/basic.js',
    'node-terminal/tty_test.js'
];

let globs = [
    'package.json',
    'node-terminal/*',
    'node-terminal/*.js',
    'node-terminal/**'+'/*',
    'node-terminal/ex*'+'/*',
    'node-terminal/test?/*'
];

globs.forEach(function( glob ) {
    console.log('%s\n\t%s', glob, new FileGlob( glob ).filter( files ).join('\n\t'));
});
*/
