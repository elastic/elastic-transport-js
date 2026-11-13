/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { Readable as ReadableStream } from 'node:stream'

export function shouldSerialize (obj: any): obj is Record<string, any> | Array<Record<string, any>> {
  return typeof obj !== 'string' &&
         typeof obj.pipe !== 'function' &&
         !Buffer.isBuffer(obj)
}

export function isStream (obj: any): obj is ReadableStream {
  return obj != null && typeof obj.pipe === 'function'
}

export function lowerCaseHeaders (oldHeaders?: http.IncomingHttpHeaders): http.IncomingHttpHeaders | null {
  if (oldHeaders == null) return null
  const newHeaders: Record<string, string> = {}
  for (const header in oldHeaders) {
    // @ts-expect-error
    newHeaders[header.toLowerCase()] = oldHeaders[header]
  }
  return newHeaders
}
