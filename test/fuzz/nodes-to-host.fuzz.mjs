/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

// Fuzz target: ConnectionPool.nodesToHost
// Feeds arbitrary payloads as the `nodes` object from a `_nodes/http` sniff call.

import { BaseConnectionPool } from '../../index.js'

const pool = new BaseConnectionPool({
  Connection: function () {} // dummy
})

function fuzz (buf) {
  let body
  try {
    body = JSON.parse(buf.toString('utf8'))
  } catch {
    body = buf.toString('utf8')
  }

  // we only care about object bodies, just like the sniffer asserts
  if (typeof body !== 'object' || body === null) return

  try {
    pool.nodesToHost(body, 'http:')
  } catch (err) {
    if (
      err instanceof TypeError || // thrown by new URL() internally if publish_address is bad
      err.message?.includes('Invalid URL') ||
      err.message?.includes('URL')
    ) {
      return
    }
    throw err
  }
}

export { fuzz }
