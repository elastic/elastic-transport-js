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

export const kSniffEnabled = Symbol('sniff enabled')
export const kNextSniff = Symbol('next sniff')
export const kIsSniffing = Symbol('is sniffing')
export const kSniffInterval = Symbol('sniff interval')
export const kSniffOnConnectionFault = Symbol('sniff on connection fault')
export const kSniffEndpoint = Symbol('sniff endpoint')
export const kRequestTimeout = Symbol('request timeout')
export const kCompression = Symbol('compression')
export const kMaxRetries = Symbol('max retries')
export const kName = Symbol('name')
export const kOpaqueIdPrefix = Symbol('opaque id prefix')
export const kGenerateRequestId = Symbol('generate request id')
export const kContext = Symbol('context')
export const kConnectionPool = Symbol('connection pool')
export const kSerializer = Symbol('serializer')
export const kDiagnostic = Symbol('diagnostics')
export const kHeaders = Symbol('headers')
export const kNodeFilter = Symbol('node filter')
export const kNodeSelector = Symbol('node selector')
export const kJsonOptions = Symbol('secure json parse options')
export const kStatus = Symbol('status')
export const kEmitter = Symbol('event emitter')
export const kProductCheck = Symbol('product check')
