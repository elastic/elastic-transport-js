/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http'
import { DiagnosticResult } from './types'
import { RedactionOptions } from './Transport'
import { redactDiagnostic } from './security'

export interface ErrorOptions {
  redaction: RedactionOptions
}

export interface NativeErrorOptions {
  cause?: unknown
}

export class ElasticsearchClientError extends Error {
  options: ErrorOptions
  constructor (message: string, options?: ErrorOptions) {
    super(message)
    this.name = 'ElasticsearchClientError'

    this.options = {
      redaction: {
        type: 'replace',
        additionalKeys: []
      }
    }

    if (isObject(options)) {
      this.options.redaction = { ...this.options.redaction, ...options.redaction }
    }
  }
}

export class TimeoutError extends ElasticsearchClientError {
  meta?: DiagnosticResult
  constructor (message: string, meta?: DiagnosticResult, options?: ErrorOptions) {
    super(message, options)
    Error.captureStackTrace(this, TimeoutError)
    this.name = 'TimeoutError'
    this.message = message ?? 'Timeout Error'

    if (isObject(meta)) meta = redactDiagnostic(meta, this.options.redaction)
    this.meta = meta
  }
}

export class ConnectionError extends ElasticsearchClientError {
  meta?: DiagnosticResult
  constructor (message: string, meta?: DiagnosticResult, options?: ErrorOptions) {
    super(message, options)
    Error.captureStackTrace(this, ConnectionError)
    this.name = 'ConnectionError'
    this.message = message ?? 'Connection Error'

    if (isObject(meta)) meta = redactDiagnostic(meta, this.options.redaction)
    this.meta = meta
  }
}

export class NoLivingConnectionsError extends ElasticsearchClientError {
  meta: DiagnosticResult
  constructor (message: string, meta: DiagnosticResult, options?: ErrorOptions) {
    super(message, options)
    Error.captureStackTrace(this, NoLivingConnectionsError)
    this.name = 'NoLivingConnectionsError'
    this.message = message ?? 'Given the configuration, the ConnectionPool was not able to find a usable Connection for this request.'

    this.meta = redactDiagnostic(meta, this.options.redaction)
  }
}

export class SerializationError extends ElasticsearchClientError {
  data: Record<string, any>
  constructor (message: string, data: Record<string, any>) {
    super(message)
    Error.captureStackTrace(this, SerializationError)
    this.name = 'SerializationError'
    this.message = message ?? 'Serialization Error'
    this.data = data
  }
}

export class DeserializationError extends ElasticsearchClientError {
  data: string
  constructor (message: string, data: string) {
    super(message)
    Error.captureStackTrace(this, DeserializationError)
    this.name = 'DeserializationError'
    this.message = message ?? 'Deserialization Error'
    this.data = data
  }
}

export class ConfigurationError extends ElasticsearchClientError {
  constructor (message: string) {
    super(message)
    Error.captureStackTrace(this, ConfigurationError)
    this.name = 'ConfigurationError'
    this.message = message ?? 'Configuration Error'
  }
}

export class ResponseError extends ElasticsearchClientError {
  meta: DiagnosticResult
  constructor (meta: DiagnosticResult, options?: ErrorOptions) {
    super('Response Error', options)
    Error.captureStackTrace(this, ResponseError)
    this.name = 'ResponseError'

    if (isObject(meta.body) && meta.body.error != null && meta.body.error.type != null) {
      this.message = meta.body.error.type

      if (isObject(meta.body.error.caused_by)) {
        const { type, reason } = meta.body.error.caused_by
        const causedBy = [
          '\tCaused by:',
          `\t\t${type as string}: ${reason as string}`
        ].join('\n')
        this.message += `\n${causedBy}`
      }

      if (Array.isArray(meta.body.error.root_cause) && meta.body.error.root_cause.length !== 0) {
        const formatRootCause = (entry: Record<string, string>): string =>
          `\t\t${entry.type}: ${entry.reason}`

        const rootCauses = [
          '\tRoot causes:',
          ...meta.body.error.root_cause.map(formatRootCause)
        ].join('\n')

        this.message += `\n${rootCauses}`
      }
    } else if (typeof meta.body === 'object' && meta.body != null) {
      this.message = JSON.stringify(meta.body)
    } else {
      this.message = meta.body as string ?? 'Response Error'
    }

    this.meta = redactDiagnostic(meta, this.options.redaction)
  }

  get body (): any | undefined {
    return this.meta.body
  }

  get statusCode (): number | undefined {
    if (isObject(this.meta.body) && typeof this.meta.body.status === 'number') {
      return this.meta.body.status
    }
    return this.meta.statusCode
  }

  get headers (): http.IncomingHttpHeaders | undefined {
    return this.meta.headers
  }
}

export class RequestAbortedError extends ElasticsearchClientError {
  meta?: DiagnosticResult
  constructor (message: string, meta?: DiagnosticResult, options?: ErrorOptions) {
    super(message, options)
    Error.captureStackTrace(this, RequestAbortedError)
    this.name = 'RequestAbortedError'
    this.message = message ?? 'Request aborted'

    if (isObject(meta)) meta = redactDiagnostic(meta, this.options.redaction)
    this.meta = meta
  }
}

export class ProductNotSupportedError extends ElasticsearchClientError {
  meta?: DiagnosticResult
  constructor (product: string, meta?: DiagnosticResult, options?: ErrorOptions) {
    super('Product Not Supported Error', options)
    Error.captureStackTrace(this, ProductNotSupportedError)
    this.name = 'ProductNotSupportedError'
    this.message = `The client noticed that the server is not ${product} and we do not support this unknown product.`

    if (isObject(meta)) meta = redactDiagnostic(meta, this.options.redaction)
    this.meta = meta
  }
}

function isObject (obj: any): obj is Record<string, any> {
  return typeof obj === 'object' && obj !== null
}
