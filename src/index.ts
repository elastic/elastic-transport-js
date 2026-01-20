/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Diagnostic, { events } from './Diagnostic'
import Transport from './Transport'
import {
  BaseConnection,
  HttpConnection,
  UndiciConnection
} from './connection'
import {
  WeightedConnectionPool,
  ClusterConnectionPool,
  CloudConnectionPool,
  BaseConnectionPool
} from './pool'
import Serializer from './Serializer'
import * as errors from './errors'

export type {
  Connection,
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream
} from './connection'

export type {
  ConnectionPoolOptions,
  GetConnectionOptions
} from './pool'

export type {
  TransportOptions,
  TransportRequestMetadata,
  TransportRequestParams,
  TransportRequestOptions,
  TransportRequestOptionsWithMeta,
  TransportRequestOptionsWithOutMeta,
  SniffOptions
} from './Transport'

export type {
  RequestBody,
  RequestNDBody,
  DiagnosticResult,
  TransportResult,
  HttpAgentOptions,
  UndiciAgentOptions,
  ApiKeyAuth,
  BearerAuth
} from './types'

export {
  Diagnostic,
  Transport,
  WeightedConnectionPool,
  ClusterConnectionPool,
  BaseConnectionPool,
  CloudConnectionPool,
  BaseConnection,
  HttpConnection,
  UndiciConnection,
  Serializer,
  errors,
  events
}
