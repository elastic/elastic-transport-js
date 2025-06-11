/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Diagnostic, { events } from './lib/Diagnostic'
import Transport from './lib/Transport'
import {
  BaseConnection,
  FetchConnection,
  HttpConnection,
  UndiciConnection,
  prepareHeaders
} from './lib/connection'
import {
  WeightedConnectionPool,
  ClusterConnectionPool,
  CloudConnectionPool,
  BaseConnectionPool
} from './lib/pool'
import Serializer from './lib/Serializer'
import * as errors from './lib/errors'

export type {
  Connection,
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream,
} from './lib/connection'

export type {
  ConnectionPoolOptions,
  GetConnectionOptions
} from './lib/pool'

export type {
  TransportOptions,
  TransportRequestMetadata,
  TransportRequestParams,
  TransportRequestOptions,
  TransportRequestOptionsWithMeta,
  TransportRequestOptionsWithOutMeta,
  SniffOptions,
  RedactionOptions,
} from './lib/Transport'

export type {
  RequestBody,
  RequestNDBody,
  DiagnosticResult,
  TransportResult,
  HttpAgentOptions,
  UndiciAgentOptions,
  BasicAuth,
  ApiKeyAuth,
  BearerAuth,
  Context,
  agentFn,
  nodeFilterFn,
  nodeSelectorFn,
  generateRequestIdFn
} from './lib/types'

export {
  Diagnostic,
  Transport,
  WeightedConnectionPool,
  ClusterConnectionPool,
  BaseConnectionPool,
  CloudConnectionPool,
  BaseConnection,
  FetchConnection,
  HttpConnection,
  UndiciConnection,
  Serializer,
  errors,
  events,
  prepareHeaders
}
