/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Diagnostic, { events } from './Diagnostic.js'
import Transport from './Transport.js'
import {
  BaseConnection,
  HttpConnection,
  UndiciConnection
} from './connection/index.js'
import {
  WeightedConnectionPool,
  ClusterConnectionPool,
  CloudConnectionPool,
  BaseConnectionPool
} from './pool/index.js'
import Serializer from './Serializer.js'
import * as errors from './errors.js'

export type {
  Connection,
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream
} from './connection/index.js'

export type {
  ConnectionPoolOptions,
  GetConnectionOptions
} from './pool/index.js'

export type {
  TransportOptions,
  TransportRequestMetadata,
  TransportRequestParams,
  TransportRequestOptions,
  TransportRequestOptionsWithMeta,
  TransportRequestOptionsWithOutMeta,
  SniffOptions
} from './Transport.js'

export type {
  RequestBody,
  RequestNDBody,
  DiagnosticResult,
  TransportResult,
  HttpAgentOptions,
  UndiciAgentOptions,
  ApiKeyAuth,
  BearerAuth
} from './types.js'

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
