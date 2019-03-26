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

// This file implements a functional interface wrapper for the
// object based API of the https://github.com/jshttp/negotiator
// module.

const negotiator = require('negotiator').Negotiator({});

exports.charset = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.charset( available );
}

exports.charsets = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.charsets( available );
}

exports.encoding = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.encoding( available );
}

exports.encodings = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.encodings( available );
}

exports.language = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.language( available );
}

exports.languages = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.languages( available );
}

exports.mediaType = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.mediaType( available );
}

exports.mediaTypes = function( available, headers ) {
    negotiator.request.headers = headers;
    return negotiator.mediaTypes( available );
}
