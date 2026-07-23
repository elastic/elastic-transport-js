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

import { test } from 'tap'
import type http from 'http'
import { enrichSocketErrorMessage } from '../../src/connection/enrichSocketErrorMessage'

function fakeRequest (socket?: {
  localAddress?: string
  localPort?: number
  remoteAddress?: string
  remotePort?: number
}): http.ClientRequest {
  return {
    method: 'GET',
    socket
  } as unknown as http.ClientRequest
}

test('ECONNRESET includes local/remote socket addresses', t => {
  const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
  const message = enrichSocketErrorMessage(
    err,
    fakeRequest({
      localAddress: '127.0.0.1',
      localPort: 54321,
      remoteAddress: '127.0.0.1',
      remotePort: 9200
    }),
    { method: 'GET', path: '/_search' }
  )
  t.match(message, /Local:\s127\.0\.0\.1:54321,\sRemote:\s127\.0\.0\.1:9200/)
  t.notMatch(message, /pathBytes=/)
  t.end()
})

test('EPIPE includes socket addresses, method, pathBytes and path', t => {
  const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
  const path = '/_resolve/index/' + 'a'.repeat(100)
  const message = enrichSocketErrorMessage(
    err,
    fakeRequest({
      localAddress: '10.0.0.1',
      localPort: 40000,
      remoteAddress: '10.0.0.2',
      remotePort: 9243
    }),
    { method: 'GET', path }
  )
  t.match(message, /Local:\s10\.0\.0\.1:40000,\sRemote:\s10\.0\.0\.2:9243/)
  t.match(message, new RegExp(`GET pathBytes=${Buffer.byteLength(path)}`))
  t.match(message, /path=\/_resolve\/index\//)
  t.end()
})

test('EPIPE truncates very long paths in the error message', t => {
  const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
  const path = '/_resolve/index/' + 'x'.repeat(1000)
  const message = enrichSocketErrorMessage(err, fakeRequest(), { method: 'GET', path })
  t.match(message, /pathBytes=/)
  t.match(message, /…$/)
  t.ok(message.length < path.length + 200)
  t.end()
})

test('other errors are left unchanged', t => {
  const err = Object.assign(new Error('boom'), { code: 'ETIMEDOUT' })
  const message = enrichSocketErrorMessage(err, fakeRequest(), { method: 'GET', path: '/x' })
  t.equal(message, 'boom')
  t.end()
})
