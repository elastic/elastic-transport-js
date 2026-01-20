/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseConnection from './BaseConnection.js'
import HttpConnection from './HttpConnection.js'
import UndiciConnection from './UndiciConnection.js'

export type Connection = BaseConnection | HttpConnection | UndiciConnection
export type {
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream
} from './BaseConnection.js'

export {
  BaseConnection,
  HttpConnection,
  UndiciConnection
}
