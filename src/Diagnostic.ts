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

import { EventEmitter } from 'events'
import { ElasticsearchClientError, ConfigurationError } from './errors'
import { ConnectionRequestOptions } from './connection'
import { Result } from './types'

export type DiagnosticListener = (err: ElasticsearchClientError | null, meta: any | null) => void
export type DiagnosticListenerFull = (err: ElasticsearchClientError | null, meta: Result | null) => void
export type DiagnosticListenerLight = (err: ElasticsearchClientError | null, meta: ConnectionRequestOptions | null) => void

export enum events {
  RESPONSE = 'response',
  REQUEST = 'request',
  SNIFF = 'sniff',
  RESURRECT = 'resurrect',
  SERIALIZATION = 'serialization',
  DESERIALIZATION = 'deserialization'
}

export default class Diagnostic extends EventEmitter {
  on (event: events.REQUEST, listener: DiagnosticListenerFull): this
  on (event: events.RESPONSE, listener: DiagnosticListenerFull): this
  on (event: events.SERIALIZATION, listener: DiagnosticListenerFull): this
  on (event: events.SNIFF, listener: DiagnosticListenerFull): this
  on (event: events.DESERIALIZATION, listener: DiagnosticListenerLight): this
  on (event: events.RESURRECT, listener: DiagnosticListenerLight): this
  on (event: string, listener: DiagnosticListener): this {
    assertSupportedEvent(event)
    super.on(event, listener)
    return this
  }

  once (event: events.REQUEST, listener: DiagnosticListenerFull): this
  once (event: events.RESPONSE, listener: DiagnosticListenerFull): this
  once (event: events.SERIALIZATION, listener: DiagnosticListenerFull): this
  once (event: events.SNIFF, listener: DiagnosticListenerFull): this
  once (event: events.DESERIALIZATION, listener: DiagnosticListenerLight): this
  once (event: events.RESURRECT, listener: DiagnosticListenerLight): this
  once (event: string, listener: DiagnosticListener): this {
    assertSupportedEvent(event)
    super.once(event, listener)
    return this
  }

  off (event: string, listener: DiagnosticListener): this {
    assertSupportedEvent(event)
    super.off(event, listener)
    return this
  }
}

function assertSupportedEvent (event: string): void {
  if (!supportedEvents.includes(event)) {
    throw new ConfigurationError(`The event '${event}' is not supported.`)
  }
}

// @ts-expect-error
const supportedEvents: string[] = Object.keys(events).map(key => events[key])
