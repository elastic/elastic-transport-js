/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { inspect } from 'node:util'
import * as http from 'node:http'
import { URL } from 'node:url'
import { ConnectionOptions as TlsConnectionOptions, TLSSocket, DetailedPeerCertificate } from 'node:tls'
import { Readable as ReadableStream } from 'node:stream'
import Diagnostic from '../Diagnostic'
import {
  ApiKeyAuth,
  BasicAuth,
  BearerAuth,
  HttpAgentOptions,
  UndiciAgentOptions,
  agentFn
} from '../types'
import { ConfigurationError } from '../errors'
import { kStatus, kDiagnostic, kCaFingerprint } from '../symbols'

export interface ConnectionOptions {
  url: URL
  tls?: TlsConnectionOptions
  id?: string
  headers?: http.IncomingHttpHeaders
  status?: string
  auth?: BasicAuth | ApiKeyAuth | BearerAuth
  diagnostic?: Diagnostic
  timeout?: number
  agent?: HttpAgentOptions | UndiciAgentOptions | agentFn | boolean
  proxy?: string | URL
  caFingerprint?: string
  maxEventListeners?: number
}

export interface ConnectionRequestParams {
  method: string
  path: string
  headers?: http.IncomingHttpHeaders
  body?: string | Buffer | ReadableStream | null
  querystring?: string
}

export interface ConnectionRequestOptions {
  requestId: string | number
  name: string | symbol
  context: any
  maxResponseSize?: number
  maxCompressedResponseSize?: number
  signal?: AbortSignal
  timeout?: number
}

export interface ConnectionRequestOptionsAsStream extends ConnectionRequestOptions {
  asStream: true
}

export interface ConnectionRequestResponse {
  body: string | Buffer
  headers: http.IncomingHttpHeaders
  statusCode: number
}

export interface ConnectionRequestResponseAsStream {
  body: ReadableStream
  headers: http.IncomingHttpHeaders
  statusCode: number
}

/**
 * An HTTP connection to a single Elasticsearch node.
 */
export default class BaseConnection {
  url: URL
  tls: TlsConnectionOptions | null
  id: string
  timeout: number
  headers: http.IncomingHttpHeaders
  deadCount: number
  resurrectTimeout: number
  _openRequests: number
  weight: number
  maxEventListeners: number
  [kStatus]: string
  [kCaFingerprint]: string | null
  [kDiagnostic]: Diagnostic

  static statuses = {
    ALIVE: 'alive',
    DEAD: 'dead'
  }

  constructor (opts: ConnectionOptions) {
    this.url = opts.url
    this.tls = opts.tls ?? null
    this.id = opts.id ?? stripAuth(opts.url.href)
    this.headers = prepareHeaders(opts.headers, opts.auth)
    this.timeout = opts.timeout ?? 30000
    this.deadCount = 0
    this.resurrectTimeout = 0
    this.weight = 0
    this._openRequests = 0
    this.maxEventListeners = opts.maxEventListeners ?? 100
    this[kStatus] = opts.status ?? BaseConnection.statuses.ALIVE
    this[kDiagnostic] = opts.diagnostic ?? new Diagnostic()
    this[kCaFingerprint] = opts.caFingerprint ?? null
    if (!['http:', 'https:'].includes(this.url.protocol)) {
      throw new ConfigurationError(`Invalid protocol: '${this.url.protocol}'`)
    }
  }

  get status (): string {
    return this[kStatus]
  }

  set status (status: string) {
    if (!validStatuses.includes(status)) {
      throw new ConfigurationError(`Unsupported status: '${status}'`)
    }
    this[kStatus] = status
  }

  get diagnostic (): Diagnostic {
    return this[kDiagnostic]
  }

  /* istanbul ignore next */
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse>
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptionsAsStream): Promise<ConnectionRequestResponseAsStream>
  async request (params: ConnectionRequestParams, options: any): Promise<any> {
    throw new ConfigurationError('The request method should be implemented by extended classes')
  }

  /* istanbul ignore next */
  async close (): Promise<void> {
    throw new ConfigurationError('The close method should be implemented by extended classes')
  }

  // Handles console.log and utils.inspect invocations.
  // We want to hide `auth`, `agent` and `tls` since they made
  // the logs very hard to read. The user can still
  // access them with `instance.agent` and `instance.tls`.
  [inspect.custom] (depth: number, options: Record<string, any>): Record<string, any> {
    const {
      authorization,
      ...headers
    } = this.headers

    return {
      url: stripAuth(this.url.toString()),
      id: this.id,
      headers,
      status: this.status
    }
  }

  toJSON (): Record<string, any> {
    const {
      authorization,
      ...headers
    } = this.headers

    return {
      url: stripAuth(this.url.toString()),
      id: this.id,
      headers,
      status: this.status
    }
  }
}

const validStatuses = Object.keys(BaseConnection.statuses)
  // @ts-expect-error
  .map(k => BaseConnection.statuses[k])

function stripAuth (url: string): string {
  if (!url.includes('@')) return url
  return url.slice(0, url.indexOf('//') + 2) + url.slice(url.indexOf('@') + 1)
}

export function prepareHeaders (headers: http.IncomingHttpHeaders = {}, auth?: BasicAuth | ApiKeyAuth | BearerAuth): http.IncomingHttpHeaders {
  if (auth != null && headers.authorization == null) {
    /* istanbul ignore else */
    if (isApiKeyAuth(auth)) {
      if (typeof auth.apiKey === 'object') {
        headers.authorization = 'ApiKey ' + Buffer.from(`${auth.apiKey.id}:${auth.apiKey.api_key}`).toString('base64')
      } else {
        headers.authorization = `ApiKey ${auth.apiKey}`
      }
    } else if (isBearerAuth(auth)) {
      headers.authorization = `Bearer ${auth.bearer}`
    } else if (auth.username != null && auth.password != null) {
      headers.authorization = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
    }
  }
  return headers
}

function isApiKeyAuth (auth: Record<string, any>): auth is ApiKeyAuth {
  return auth.apiKey != null
}

function isBearerAuth (auth: Record<string, any>): auth is BearerAuth {
  return auth.bearer != null
}

export function getIssuerCertificate (socket: TLSSocket): DetailedPeerCertificate | null {
  let certificate = socket.getPeerCertificate(true)
  while (certificate !== null && Object.keys(certificate).length > 0) {
    // invalid certificate
    if (certificate.issuerCertificate == null) {
      return null
    }

    // We have reached the root certificate.
    // In case of self-signed certificates, `issuerCertificate` may be a circular reference.
    if (certificate.fingerprint256 === certificate.issuerCertificate.fingerprint256) {
      break
    }

    // continue the loop
    certificate = certificate.issuerCertificate
  }
  return certificate
}

export function isCaFingerprintMatch (cert1: string | null, cert2: string | null): boolean {
  if (typeof cert1 === 'string' && typeof cert2 === 'string') {
    const c1 = cert1.toLowerCase().replace(/:/g, '')
    const c2 = cert2.toLowerCase().replace(/:/g, '')
    return c1 === c2
  }
  return cert1 === cert2
}

export function isBinary (contentType: string | string[]): boolean {
  const binaryTypes = [
    'application/vnd.mapbox-vector-tile',
    'application/vnd.apache.arrow.stream',
    'application/vnd.elasticsearch+arrow+stream',
    'application/smile',
    'application/vnd.elasticsearch+smile',
    'application/cbor',
    'application/vnd.elasticsearch+cbor'
  ]

  return binaryTypes
    .map(type => contentType.includes(type))
    .includes(true)
}
