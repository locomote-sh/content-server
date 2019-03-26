let Q = require('q');
let sn = require('../std-negotiator');

if( !Array.prototype.first ) {
    Array.prototype.first = function( test ) {
        for( let i = 0; i < this.length; i++ ) {
            if( test( this[i] ) ) {
                return this[i];
            }
        }
        return undefined;
    }
}

let files = [
    'resource1/index.utf-8.html',
    'resource1/index.es.utf-8.html',
    'resource1/index.en.utf-8.html',
    'resource1/index.fr.iso8859-1.html',
    'resource1/index.ascii.txt',
    'resource1/index.es.ascii.txt'
]

class TestNegotiator extends sn.StandardNegotiator {

    listResourceFiles( ctx ) {
        return Q( files );
    }

}

let testNeg = new TestNegotiator();

files.forEach( f => console.log( f, testNeg.getParentResourcePath( f ) ) );

let accepts = [
    { 'accept': 'text/*', 'accept-encoding': '', 'accept-language': 'en' },
    { 'accept': 'text/html', 'accept-encoding': 'utf-8, ascii;q=0.8', 'accept-language': 'en' },
    { 'accept': 'text/*', 'accept-encoding': '', 'accept-language': 'es' },
    { 'accept': 'text/plain', 'accept-encoding': '', 'accept-language': 'es' },
    { 'accept': 'text/*', 'accept-encoding': 'utf-8, iso8859-1;q=0.8', 'accept-language': 'fr' }
];

function cache( ctx, gen ) { return gen(); }

let ctx = {};

console.log('--');

let qs = accepts.map( headers => {
    return testNeg.getRepresentationPath( ctx, { headers: headers }, 'resource1', cache )
    .then( path => [ headers, path ] );
});

Q.all( qs )
.then( console.log )
.fail( console.log );
