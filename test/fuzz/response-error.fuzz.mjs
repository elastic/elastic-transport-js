/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

// Fuzz target: ResponseError parser
// Feeds arbitrary JSON payloads as the `body` of an error response
// to ensure the error parsing logic doesn't crash on unexpected shapes.

import { errors } from '../../index.js'

function fuzz (buf) {
  let body
  try {
    body = JSON.parse(buf.toString('utf8'))
  } catch {
    // If it's not valid JSON, we also test how it handles strings/buffers
    body = buf.toString('utf8')
  }

  try {
    const meta = {
      body,
      statusCode: 500,
      headers: {},
      meta: {
        context: null,
        request: { params: { method: 'GET', path: '/' }, options: {}, id: 1 },
        name: 'elasticsearch-js',
        connection: { id: 'http://localhost:9200' },
        attempts: 0,
        aborted: false
      }
    }
    const err = new errors.ResponseError(meta)

    // Attempt to access properties to trigger any lazy getters if they exist
    // eslint-disable-next-line no-unused-expressions
    err.message
    // eslint-disable-next-line no-unused-expressions
    err.body
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError) {
      throw err // Unexpected failures
    }
    // We don't expect ResponseError constructor to throw
    throw err
  }
}

export { fuzz }
