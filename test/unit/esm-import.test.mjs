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
} from '../../esm/index.js'

test('ESM import works', (t) => {
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
  t.equal(typeof Transport, 'function', 'Transport is a function')
  t.equal(typeof Diagnostic, 'function', 'Diagnostic is a function')
  t.equal(typeof Serializer, 'function', 'Serializer is a function')
  t.equal(typeof errors, 'object', 'errors is an object')
  t.end()
})

test('ESM exports are usable', (t) => {
  const serializer = new Serializer()
  t.ok(serializer, 'Serializer instance created')
  t.equal(typeof serializer.serialize, 'function', 'Serializer has serialize method')
  t.equal(typeof serializer.deserialize, 'function', 'Serializer has deserialize method')
  t.ok(errors.ResponseError, 'ResponseError exists in errors')
  t.ok(errors.ConnectionError, 'ConnectionError exists in errors')
  t.ok(errors.TimeoutError, 'TimeoutError exists in errors')
  t.end()
})
