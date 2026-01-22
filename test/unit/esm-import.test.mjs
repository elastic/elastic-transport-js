/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import {
  Transport,
  Diagnostic,
  Serializer,
  BaseConnection,
  HttpConnection,
  UndiciConnection,
  BaseConnectionPool,
  ClusterConnectionPool,
  CloudConnectionPool,
  WeightedConnectionPool,
  errors,
  events
} from '../../lib/esm/index.js'

test('ESM import works', async (t) => {
  t.ok(Transport, 'Transport exported')
  t.ok(Diagnostic, 'Diagnostic exported')
  t.ok(Serializer, 'Serializer exported')
  t.ok(BaseConnection, 'BaseConnection exported')
  t.ok(HttpConnection, 'HttpConnection exported')
  t.ok(UndiciConnection, 'UndiciConnection exported')
  t.ok(BaseConnectionPool, 'BaseConnectionPool exported')
  t.ok(ClusterConnectionPool, 'ClusterConnectionPool exported')
  t.ok(CloudConnectionPool, 'CloudConnectionPool exported')
  t.ok(WeightedConnectionPool, 'WeightedConnectionPool exported')
  t.ok(errors, 'errors exported')
  t.ok(events, 'events exported')
  
  // Verify exports are constructors/objects
  t.equal(typeof Transport, 'function', 'Transport is a function')
  t.equal(typeof Diagnostic, 'function', 'Diagnostic is a function')
  t.equal(typeof Serializer, 'function', 'Serializer is a function')
  t.equal(typeof errors, 'object', 'errors is an object')
})

test('ESM exports are usable', async (t) => {
  // Test that we can instantiate Serializer
  const serializer = new Serializer()
  t.ok(serializer, 'Serializer instance created')
  t.equal(typeof serializer.serialize, 'function', 'Serializer has serialize method')
  t.equal(typeof serializer.deserialize, 'function', 'Serializer has deserialize method')
  
  // Test that errors object has expected error classes
  t.ok(errors.ResponseError, 'ResponseError exists in errors')
  t.ok(errors.ConnectionError, 'ConnectionError exists in errors')
  t.ok(errors.TimeoutError, 'TimeoutError exists in errors')
})
