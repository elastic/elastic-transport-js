/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseConnection, { prepareHeaders } from './BaseConnection'
import HttpConnection from './HttpConnection'
import UndiciConnection from './UndiciConnection'
import FetchConnection from './FetchConnection'

export type Connection = BaseConnection | HttpConnection | UndiciConnection | FetchConnection
export type {
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream,
} from './BaseConnection'

export {
  BaseConnection,
  FetchConnection,
  HttpConnection,
  UndiciConnection,
  prepareHeaders
}
