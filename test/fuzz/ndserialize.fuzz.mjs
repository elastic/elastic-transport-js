/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

// Fuzz target: Serializer.ndserialize (newline-delimited JSON)
// Treats the buffer as a newline-delimited list of JSON objects and
// exercises the ndserialize path used for bulk/msearch requests.

import { Serializer } from '../../index.js'

const serializer = new Serializer()

function fuzz (buf) {
  const input = buf.toString('utf8')
  const lines = input.split('\n')

  // Build an array of objects by parsing each non-empty line.
  // Lines that are not valid JSON are skipped so the fuzzer focuses
  // on the ndserialize logic itself rather than JSON.parse errors.
  const objects = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      objects.push(JSON.parse(trimmed))
    } catch {
      // Push raw string so ndserialize sees a non-object value too
      objects.push(trimmed)
    }
  }

  if (objects.length === 0) return

  try {
    serializer.ndserialize(objects)
  } catch (err) {
    // circular references and similar serialisation errors are acceptable
    if (
      err instanceof TypeError ||
      err.message?.includes('circular')
    ) {
      return
    }
    throw err
  }
}

export { fuzz }
