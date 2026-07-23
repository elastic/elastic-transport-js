/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type http from 'node:http'

const MAX_PATH_CHARS_IN_ERROR = 256

/**
 * Enrich socket-level failures (ECONNRESET / EPIPE) so callers can tell which
 * request was in flight. Bare `WriteWrap` EPIPE stacks otherwise carry no path.
 */
export function enrichSocketErrorMessage (
  err: Error,
  request: http.ClientRequest,
  requestParams: http.ClientRequestArgs
): string {
  let message = err.message
  const code = (err as NodeJS.ErrnoException).code

  if (code === 'ECONNRESET' || code === 'EPIPE') {
    message += ` - Local: ${request.socket?.localAddress ?? 'unknown'}:${request.socket?.localPort ?? 'unknown'}, Remote: ${request.socket?.remoteAddress ?? 'unknown'}:${request.socket?.remotePort ?? 'unknown'}`
  }

  if (code === 'EPIPE') {
    const method = String(requestParams.method ?? request.method ?? '?')
    const path = String(requestParams.path ?? '')
    const pathBytes = Buffer.byteLength(path)
    const pathPreview =
      path.length > MAX_PATH_CHARS_IN_ERROR
        ? `${path.slice(0, MAX_PATH_CHARS_IN_ERROR)}…`
        : path
    message += ` - ${method} pathBytes=${pathBytes}`
    if (pathPreview.length > 0) {
      message += ` path=${pathPreview}`
    }
  }

  return message
}
