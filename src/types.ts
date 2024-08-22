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
