let Q = require('q');
let an = require('../acm-negotiator');

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
    'resource1/index.premium.html',
    'resource1/index.html',
    'resource1/index.es.premium.html',
    'resource1/index.en.premium.html',
    'resource1/index.en.html',
    'resource1/index.fr.html',
    'resource1/index.premium.fr.html',
    'resource1/index.ascii.txt',
    'resource1/index.es.ascii.txt',
    'resource2/index.html',
    'resource2/index.free.html'
]

class TestNegotiator extends an.ACMNegotiator {

    constructor( groups ) {
        super( groups );
    }

    listResourceFiles( ctx ) {
        return Q( files );
    }

}

let testNeg = new TestNegotiator(['free','premium']);

files.forEach( f => console.log( f, testNeg.getParentResourcePath( f ) ) );

let accepts = [
    { 'accept': 'text/*', 'accept-encoding': '', 'accept-language': 'en' },
    { 'accept': 'text/html', 'accept-encoding': 'utf-8, ascii;q=0.8', 'accept-language': 'en' },
    { 'accept': 'text/*', 'accept-encoding': '', 'accept-language': 'es' },
    { 'accept': 'text/*', 'accept-encoding': 'utf-8, iso8859-1;q=0.8', 'accept-language': 'fr' }
];

let rscs = false;
function cache( ctx, gen ) {
    if( rscs ) return rscs;
    rscs = gen();
    return rscs.then( ( rscs ) => {
        console.log( JSON.stringify( rscs['resource1/'].reps, null, 4 ) );
        return rscs;
    });
}

console.log('--');

function qs( ctx, requestPath ) {
    return accepts.map( headers => {
        return testNeg.getRepresentationPath( ctx, { headers: headers }, requestPath, cache )
        .then( path => [ headers, path ] );
    });
}

let groups = [];
let ctx = { auth: { userInfo: { groups } } }

async function test() {
    try {
        console.log('-- no group user --');
        let result = await Promise.all( qs( ctx, 'resource1' ) );
        console.log( result );

        console.log('-- premium user --');
        groups.push('premium');
        result = await Promise.all( qs( ctx, 'resource1') );
        console.log( result );

        groups.push('free');
        console.log('-- free user --');
        result = await Promise.all( qs( ctx, 'resource2') );
        console.log( result );
    }
    catch( e ) {
        console.log( e );
    }
}

test();
