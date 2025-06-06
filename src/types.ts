/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable as ReadableStream } from 'node:stream'
import { URL } from 'node:url'
import * as http from 'node:http'
import { Connection, ConnectionOptions, ConnectionRequestParams } from './connection'
import { TransportRequestParams, TransportRequestOptions } from './Transport'

export type Context = Record<string, unknown> | null

export type RequestBody<T = Record<string, any>> = T | string | Buffer | ReadableStream

export type RequestNDBody<T = Array<Record<string, any>>> = T | string | string[] | Buffer | ReadableStream

export interface DiagnosticResult<TResponse = unknown, TContext = unknown> {
  body?: TResponse
  statusCode?: number
  headers?: http.IncomingHttpHeaders
  warnings: string[] | null
  meta: {
    context: TContext
    name: string | symbol
    request: {
      params: ConnectionRequestParams
      options: TransportRequestOptions
      id: any
    }
    connection: Connection | null
    attempts: number
    aborted: boolean
    sniff?: {
      hosts: any[]
      reason: string
    }
  }
}

export type DiagnosticResultResponse<TResponse = unknown, TContext = unknown> = Required<DiagnosticResult<TResponse, TContext>>

export interface TransportResult<TResponse = unknown, TContext = unknown> extends DiagnosticResult<TResponse, TContext> {
  body: TResponse
  statusCode: number
  headers: http.IncomingHttpHeaders
}

export declare type agentFn = (opts: ConnectionOptions) => any

export interface HttpAgentOptions {
  keepAlive?: boolean
  keepAliveMsecs?: number
  maxSockets?: number
  maxFreeSockets?: number
  scheduling?: 'lifo' | 'fifo'
  proxy?: string | URL
}

export interface UndiciAgentOptions {
  keepAliveTimeout?: number
  keepAliveMaxTimeout?: number
  keepAliveTimeoutThreshold?: number
  pipelining?: number
  maxHeaderSize?: number
  connections?: number
}

export interface ApiKeyAuth {
  apiKey:
  | string
  | {
    id: string
    api_key: string
  }
}

export interface BasicAuth {
  username: string
  password: string
}

export interface BearerAuth {
  bearer: string
}

export type nodeSelectorFn = (connections: Connection[]) => Connection

export type nodeFilterFn = (connection: Connection) => boolean

export type generateRequestIdFn = (params: TransportRequestParams, options: TransportRequestOptions) => any
