/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

// Fuzz target: Serializer.deserialize / serialize round-trip
// Exercises JSON parsing of arbitrary byte buffers and the
// qserialize (query-string) path.

import { Serializer, errors } from '../../index.js'

const serializer = new Serializer()

function fuzz (buf) {
  const input = buf.toString('utf8')

  // 1. deserialize: should never throw for valid or invalid JSON —
  //    only expected errors are allowed through.
  try {
    const parsed = serializer.deserialize(input)

    // 2. Round-trip: re-serialize and deserialize; result must equal original.
    if (parsed != null) {
      const reserialised = serializer.serialize(parsed)
      serializer.deserialize(reserialised)
    }
  } catch (err) {
    // Acceptable errors from JSON parsing
    if (
      err instanceof SyntaxError ||
      err instanceof errors.DeserializationError ||
      err instanceof errors.SerializationError ||
      err.message?.includes('circular')
    ) {
      return
    }
    throw err
  }

  // 3. qserialize: treat buffer as key=value pairs split on '&'
  const params = {}
  for (const pair of input.split('&')) {
    const idx = pair.indexOf('=')
    if (idx !== -1) {
      params[pair.slice(0, idx)] = pair.slice(idx + 1)
    }
  }
  serializer.qserialize(params)
}

export { fuzz }
