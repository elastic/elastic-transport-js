/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events'
import { ElasticsearchClientError, ConfigurationError } from './errors.js'
import { ConnectionRequestOptions } from './connection/index.js'
import { ResurrectEvent } from './pool/index.js'
import { DiagnosticResult, DiagnosticResultResponse } from './types.js'

export type DiagnosticListener = (err: ElasticsearchClientError | null, meta: any | null) => void
export type DiagnosticListenerFull = (err: ElasticsearchClientError | null, meta: DiagnosticResult | null) => void
export type DiagnosticListenerFullResponse = (err: ElasticsearchClientError | null, meta: DiagnosticResultResponse | null) => void
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
  on (event: 'response', listener: DiagnosticListenerFullResponse): this
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
  once (event: 'response', listener: DiagnosticListenerFullResponse): this
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
