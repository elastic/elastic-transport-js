/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseConnection from './BaseConnection'
import HttpConnection from './HttpConnection'
import UndiciConnection from './UndiciConnection'

export type Connection = BaseConnection | HttpConnection | UndiciConnection
export type {
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream
} from './BaseConnection'

export {
  BaseConnection,
  HttpConnection,
  UndiciConnection
}
