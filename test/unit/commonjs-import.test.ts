/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'

test('CommonJS import works', async (t) => {
  // Use dynamic import to load CommonJS module
  const cjsModule = require('../../')
  
  t.ok(cjsModule, 'Module loaded successfully')
  t.ok(cjsModule.Transport, 'Transport exported')
  t.ok(cjsModule.Diagnostic, 'Diagnostic exported')
  t.ok(cjsModule.Serializer, 'Serializer exported')
  t.ok(cjsModule.BaseConnection, 'BaseConnection exported')
  t.ok(cjsModule.HttpConnection, 'HttpConnection exported')
  t.ok(cjsModule.UndiciConnection, 'UndiciConnection exported')
  t.ok(cjsModule.BaseConnectionPool, 'BaseConnectionPool exported')
  t.ok(cjsModule.ClusterConnectionPool, 'ClusterConnectionPool exported')
  t.ok(cjsModule.CloudConnectionPool, 'CloudConnectionPool exported')
  t.ok(cjsModule.WeightedConnectionPool, 'WeightedConnectionPool exported')
  t.ok(cjsModule.errors, 'errors exported')
  t.ok(cjsModule.events, 'events exported')
  
  // Verify exports are constructors/objects
  t.equal(typeof cjsModule.Transport, 'function', 'Transport is a function')
  t.equal(typeof cjsModule.Diagnostic, 'function', 'Diagnostic is a function')
  t.equal(typeof cjsModule.Serializer, 'function', 'Serializer is a function')
  t.equal(typeof cjsModule.errors, 'object', 'errors is an object')
})

test('CommonJS exports are usable', async (t) => {
  const { Serializer, errors } = require('../../')
  
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
