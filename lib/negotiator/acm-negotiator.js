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

const {
    Representation,
    Representations,
    StandardNegotiator,
    keyPart
} = require('./std-negotiator');

/* This file provides an implementation of a content negotiator
 * where representation type is selected by matching ACM group
 * membership.
 * The negotiator is instantiated with a list of ACM groups to
 * apply to representations. The negotiator when choosing a
 * representation then selects the first group which is listed
 * in a representation's available options, *and* is listed in
 * the requesting user's ACM group membership.
 * For example, if the negotiator is instantiated with a list
 * of one group ['premium'], and a resource's representations 
 * are provided as 'index.html' and 'index.premium.html', then
 * the premium version will be selected when the requesting user
 * belongs to the 'premium' ACM group.
 */

/// A resource representation.
class ACMRepresentation extends Representation {

    /**
     * Construct a representation.
     * @param path      The path to the representation's file.
     * @param attrs     Attributes of the representation.
     * @param groups    The list of ACM groups a representation can
     *                  belong to.
     */
    constructor( path, attrs, groups ) {
        super( path, attrs );
        this.group = attrs.find( attr => groups.includes( attr ) );
    }

}

/// A set of resource representations.
class ACMRepresentations extends Representations {
    /**
     * Construct a new set of representations.
     * @param groups    The list of ACM groups a representation can
     *                  belong to.
     */
    constructor( groups ) {
        super();
        this.groups = groups;
    }
    /// Make a representation key.
    makeKey( rep ) {
        let key = super.makeKey( rep );
        key.push( keyPart( rep.group ) );
        return key;
    }
    /// Make a representation key resolver.
    makeResolver() {
        let resolver = super.makeResolver();
        resolver.push( ( ctx, opts, negot ) => {
            let userGroups = ctx.auth && ctx.auth.userInfo.groups;
            if( userGroups ) {
                // Iterate through the list of representation groups,
                // and find the first one which appears in the this
                // representation's options list, and in the user's
                // ACM group membership.
                for( let i = 0; i < this.groups.length; i++ ) {
                    let group = this.groups[i];
                    if( opts.includes( group )
                        && userGroups.includes( group ) ) {
                        return group;
                    }
                }
            }
            return undefined;
        });
        return resolver;
    }
    /// Make a resource representation.
    makeRep( path, attrs ) {
        return new ACMRepresentation( path, attrs, this.groups );
    }
}

/// A class for performing ACM based content negotiation.
class ACMNegotiator extends StandardNegotiator {
    /**
     * Return a negotiator decision context key.
     * Appends the ACM group identifier to the standard context key.
     */
    getContextKey( ctx, req ) {
        return super.getContextKey( ctx, req )+':'+ctx.auth.group;
    }
    /**
     * Construct a new negotiator.
     * @param groups    The list of ACM groups a representation can
     *                  belong to.
     */
    constructor( groups ) {
        super();
        this.groups = groups;
    }
    /// Make a representation set.
    makeRepresentations() {
        return new ACMRepresentations( this.groups );
    }
}

exports.ACMRepresentation = ACMRepresentation;
exports.ACMRepresentations = ACMRepresentations;
exports.ACMNegotiator = ACMNegotiator;
