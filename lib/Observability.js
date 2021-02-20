/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

'use strict'

const { EventEmitter } = require('events')
const { ConfigurationError } = require('./errors')

class Observability extends EventEmitter {
  on (event, callback) {
    assertSupportedEvent(event)
    super.on(event, callback)
    return this
  }

  once (event, callback) {
    assertSupportedEvent(event)
    super.once(event, callback)
    return this
  }

  off (event, callback) {
    assertSupportedEvent(event)
    super.off(event, callback)
    return this
  }
}

function assertSupportedEvent (event) {
  if (!supportedEvents.includes(event)) {
    throw new ConfigurationError(`The event '${event}' is not supported.`)
  }
}

Observability.events = {
  RESPONSE: 'response',
  REQUEST: 'request',
  SNIFF: 'sniff',
  RESURRECT: 'resurrect',
  SERIALIZATION: 'serialization',
  DESERIALIZATION: 'deserialization'
}

const supportedEvents = Object.keys(Observability.events).map(key => Observability.events[key])

module.exports = Observability