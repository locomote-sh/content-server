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

/// A variety of asynchronous function call utilities.

// A map of pending async queues. See queue().
const Queues = {};

/**
 * A function for executing operations on named, asynchronous queues.
 * Multiple ansynchronous operations may be added to a queue, and will be executed
 * in the order they are added. Each operation will be completed before the next
 * operation on the queue is started. This can be useful for managing concurrent
 * access to a contestable resource, e.g. a file.
 * The function returns a deferred promise that will be resolved or rejected with
 * the result of the operation passed to the function, once that operation is
 * executed by the queue.
 * @param queueName A queue name; any string value may be passed.
 * @param fn        A function describing the operation to be executed on the queue.
 *                  The function should return a deferred promise, resolving to the
 *                  operation's result.
 */
function queue( queueName, fn ) {
    return new Promise( ( resolve, reject ) => {
        // Check if a queue already exists under the specified name.
        let queue = Queues[queueName];
        if( !queue ) {
            Queues[queueName] = queue = [];
        }
        // Push the function and the promise callbacks onto the queue.
        queue.push({ resolve, reject, fn });
        // If this is the first item on the queue then setup a function
        // to process it.
        if( queue.length == 1 ) {
            // A function to process the next item on the current queue.
            async function next() {
                // Read the queue.
                let queue = Queues[queueName];
                // If the queue is now empty then delete the queue and exit.
                if( queue.length == 0 ) {
                    delete Queues[queueName];
                    return;
                }
                // Remove the first item from the queue.
                let { resolve, reject, fn } = queue.shift();
                // Call the queue function and forward the result.
                fn().then( resolve ).catch( reject );
                // Continue processing the queue.
                next();
            }
            // Start processing - this will continue until the queue is empty.
            next();
        }
    });
}

/**
 * A function for performing the same asynchronous operation on a named queue.
 * The function is given a queue name and an operation function, and returns
 * a function which is used to add a new operation iteration to the named queue.
 * The function result is invoked with an arguments object, which is passed to
 * the operation function when it is invoked on the asynchronous queue.
 */
function opqueue( queueName, op ) {
    return function( args ) {
        return queue( queueName, () => op( args ) );
    }
}

/// A map of pending singleton callers, keyed by operation ID (see below).
const SingletonCallers = {};

/**
 * A singleton op is an asynchronous operation which can only have one
 * running instance at any one time. Any other calls to the operation
 * whilst it is running are queued and receive the same operation result
 * when it completes. Operations are identified using an operation ID,
 * and all invocations of an operation function with a particular ID
 * are expected to be equivalent and to produce the same result.
 * This function is useful as a wrapper for potentially expensive
 * async ops which are can receive multiple equivalent invocations
 * within a very short time period (i.e. within the time taken to
 * perform the operation), and provides a way to avoid unnecessary
 * multiple executions of an operation.
 *
 * @param id    A unique ID for the operation.
 * @param op    A function to perform the operation; should return
 *              a deferred promise.
 */
function singleton( id, op ) {
    return new Promise( ( resolve, reject ) => {
        // See if an operation with the same ID is pending...
        let callers = SingletonCallers[id];
        if( callers ) {
            // ...wait for the pending operation to complete.
            callers.push({ resolve, reject });
            return;
        }
        // No pending operation, so create a new caller list...
        callers = SingletonCallers[id] = [ { resolve, reject } ];
        // ...then invoke the operation...
        op()
        .then( result => {
            // ...and distribute the result to all waiting callers,
            // (after deleting the call queue).
            delete SingletonCallers[id];
            callers.forEach( caller => caller.resolve( result ) );
        })
        .catch( e => {
            // ...or distribute error to all waiting callers.
            delete SingletonCallers[id];
            callers.forEach( caller => caller.reject( e ) );
        });
    });
}

const LRU = require('lru-cache');

/**
 * Make a caching singleton async op function.
 * The caching singleton will store results in an LRU cache, whose
 * settings can be specified using the cacheOptions argument.
 */
function cachingSingleton( cacheOptions ) {

    // The results cache.
    const cache = LRU( cacheOptions );

    // Return the singleton function.
    return async function( id, op ) {

        // Check for cached results.
        let result = cache.get( id );
        if( result !== undefined ) {
            return result;
        }
        // Cache miss; execute the operation, cache and return the result.
        result = await singleton( id, op );
        cache.set( id, result );
        return result;
    }
}

/**
 * Create an asynchronous queue which is processed by a fixed number of workers.
 * @param count The maximum number of concurrently active queue workers.
 * @param fn    The function being queued.
 */
function workerQueue( count, fn ) {

    // A queue of items to be processed.
    const queue = [];
    // The current number of active workers.
    let active = 0;

    // A queue worker.
    async function worker() {
        // Increment active worker count.
        active++;
        // Process the queue whilst items to process.
        while( queue.length > 0 ) {
            // Read function arguments and pending promise from the queue.
            let [ args, resolve, reject ] = queue.shift();
            try {
                // Wait for the queue function result.
                // NOTE: Current 'this' is used.
                let result = await fn.apply( this, args );
                // Resolve the pending promise;
                resolve( result );
            }
            catch( e ) {
                reject( e );
            }
        }
        // Decrement the active worker count.
        active--;
    }

    // Add an item to the queue.
    function add( args ) {
        // Create a pending promise for the queue function result.
        return new Promise( ( resolve, reject ) => {
            // Add the request to the queue.
            queue.push([ args, resolve, reject ]);
            // Start a new worker if under the active worker count.
            if( active < count ) {
                worker();
            }
        });
    }

    // Return a function to access the queue.
    return function() {
        return add( arguments );
    }
}


exports.queue = queue;
exports.opqueue = opqueue;
exports.singleton = singleton;
exports.workerQueue = workerQueue;
exports.cachingSingleton = cachingSingleton;

