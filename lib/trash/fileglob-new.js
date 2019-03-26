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
 * Base class for all set classes.
 */
class Set {

    constructor() {}

    /**
     * Test whether a file path belongs to this set.
     */
    matches( path ) {
        return false;
    }

    /**
     * Filter a list of paths and return only those paths belonging to this set.
     */
    filter( list ) {
        return list.filter( path => this.matches( path ) );
    }

}

const EmptySet = new Set();

/**
 * Match file glob patterns against file path strings.
 */
class FileGlob extends Set {

    constructor( glob ) {
        super();
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
        this._re = new RegExp( pattern );
    }

    /**
     * Test whether this file glob matches a file path.
     */
    matches( path ) {
        return this._re.test( path );
    }

    toString() {
        return this._re.toString();
    }

}

/**
 * Match a set of file glob patterns against file path strings.
 */
class FileGlobSet extends Set {

    constructor( globs ) {
        super();
        // Convert the list of glob patterns to a list of file globs.
        this._fglobs = globs.map( glob => new FileGlob( glob ) );
    }

    /**
     * Test whether a file path matches any of the file globs in the set.
     */
    matches( path ) {
        return this._fglobs.some( fglob => fglob.matches( path ) );
    }

}

/**
 * A set compliment. Matches items in includes which aren't in excludes.
 */
class Compliment extends Set {

    constructor( includes, excludes ) {
        super();
        this._includes = includes;
        this._excludes = excludes;
    }

    /**
     * Test whether a path is matched by includes, but not matched by excludes.
     */
    matches( path ) {
        return this._includes.matches( path ) && !this._excludes.matches( path );
    }

}

/**
 * A union of sets. Matches items in any of its component sets.
 */
class Union extends Set {

    constructor( sets ) {
        this._sets = sets;
    }

    /**
     * Test whether a path belongs to some set in this union.
     */
    matches( path ) {
        return this._sets.some( set => set.matches( path ) );
    }

}

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
    const sets = [];
    for( const arg of arguments ) {
        sets.push( makeSet( arg ) );
    }
    return new Union( sets );
}

module.exports = {
    make,
    makeSet,
    makeCompliment,
    makeUnion
};

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
