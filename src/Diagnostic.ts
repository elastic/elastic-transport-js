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
import { ResurrectEvent } from './pool'
import { DiagnosticResult } from './types'

export type DiagnosticListener = (err: ElasticsearchClientError | null, meta: any | null) => void
export type DiagnosticListenerFull = (err: ElasticsearchClientError | null, meta: DiagnosticResult | null) => void
export type DiagnosticListenerLight = (err: ElasticsearchClientError | null, meta: ConnectionRequestOptions | null) => void
export type DiagnosticListenerResurrect = (err: ElasticsearchClientError | null, meta: ResurrectEvent | null) => void

export enum events {
  RESPONSE = 'response',
  REQUEST = 'request',
  SNIFF = 'sniff',
  RESURRECT = 'resurrect',
  SERIALIZATION = 'serialization',
  DESERIALIZATION = 'deserialization'
}

export default class Diagnostic extends EventEmitter {
  on (event: 'request', listener: DiagnosticListenerFull): this
  on (event: 'response', listener: DiagnosticListenerFull): this
  on (event: 'serialization', listener: DiagnosticListenerFull): this
  on (event: 'sniff', listener: DiagnosticListenerFull): this
  on (event: 'deserialization', listener: DiagnosticListenerLight): this
  on (event: 'resurrect', listener: DiagnosticListenerResurrect): this
  on (event: string, listener: DiagnosticListener): this {
    assertSupportedEvent(event)
    super.on(event, listener)
    return this
  }

  once (event: 'request', listener: DiagnosticListenerFull): this
  once (event: 'response', listener: DiagnosticListenerFull): this
  once (event: 'serialization', listener: DiagnosticListenerFull): this
  once (event: 'sniff', listener: DiagnosticListenerFull): this
  once (event: 'deserialization', listener: DiagnosticListenerLight): this
  once (event: 'resurrect', listener: DiagnosticListenerResurrect): this
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
