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
import { inspect } from 'node:util'
// structuredClone is available in the Node.js stdlib starting in v18
// drop this dev dependency when this lib (explicitly) stops supporting v14 and v16
import structuredClone from '@ungap/structured-clone'
import { errors, DiagnosticResult } from '../../'
import { HttpConnection, UndiciConnection } from '../../'

const theSecret = '**foo-bar-baz-bat**'
const theOtherSecret = '///tab-zab-rab-oof///'

function makeDiagnostics(): DiagnosticResult[] {
  const diagnosticBase: DiagnosticResult = {
    headers: {
      'content-type': 'text/plain',
      'authorization': theSecret,
      'x-another-header': theOtherSecret,
    },
    warnings: null,
    meta: {
      context: '',
      name: 'foo',
      request: {
        params: {
          method: 'get',
          path: '/',
          headers: {
            authorization: theSecret,
            'x-another-header': theOtherSecret,
          }
        },
        options: {
          headers: {
            authorization: theSecret,
            'x-another-header': theOtherSecret,
          }
        },
        id: 'foo',
      },
      connection: null,
      attempts: 1,
      aborted: false
    }
  }

  const diagnostics: DiagnosticResult[] = []
  diagnostics.push(diagnosticBase)

  const classes = [HttpConnection, UndiciConnection]
  const auths = [
    { username: 'elastic', password: theSecret },
    { apiKey: theSecret },
    { apiKey: { id: theSecret, api_key: theSecret }},
    { bearer: theSecret },
  ]

  classes.forEach(Conn => {
    auths.forEach(auth => {
      const diag = structuredClone(diagnosticBase)
      diag.meta.connection = new Conn({
        url: new URL(`http://user:${theSecret}@www.foo.com`),
        auth,
      })
      diagnostics.push(diag)
    })
  })

  return diagnostics
}

function errFactory (message: string, meta: DiagnosticResult, options: errors.ErrorOptions) {
  return [
    new errors.TimeoutError(message, meta, options),
    new errors.ConnectionError(message, meta, options),
    new errors.NoLivingConnectionsError(message, meta, options),
    new errors.ResponseError(meta, options),
    new errors.RequestAbortedError(message, meta, options),
    new errors.ProductNotSupportedError(message, meta, options),
  ]
}

test('redact sensitive data when logging errors', t => {
  const diags = makeDiagnostics()

  const errorOptions = {
    redactConnection: false,
    redactDiagnostics: true,
    additionalRedactionKeys: []
  }

  diags.forEach(diag => {
    errFactory('err', diag, errorOptions).forEach(err => {
      t.notMatch(inspect(err), theSecret, `${err.name} should redact sensitive data`)
      t.notMatch(inspect(err.meta), theSecret, `${err.name} should redact sensitive data`)
      t.notMatch(JSON.stringify(err.meta ?? ''), theSecret)
      t.notMatch(err.meta?.toString(), theSecret)
    })
  })

  t.end()
})

test('do not redact data if redactDiagnostics is false', t => {
  const diags = makeDiagnostics()

  const errorOptions = {
    redactConnection: false,
    redactDiagnostics: false,
    additionalRedactionKeys: []
  }

  diags.forEach(diag => {
    errFactory('err', diag, errorOptions).forEach(err => {
      t.match(inspect(err), theSecret, `${err.name} should not redact sensitive data`)
      t.match(inspect(err.meta), theSecret, `${err.name} should not redact sensitive data`)
      t.match(JSON.stringify(err.meta ?? ''), theSecret)
    })
  })

  t.end()
})

test('redact entire connection if redactConnection is true', t => {
  const diags = makeDiagnostics()

  const errorOptions = {
    redactConnection: true,
    redactDiagnostics: true,
    additionalRedactionKeys: []
  }

  diags.forEach(diag => {
    errFactory('err', diag, errorOptions).forEach(err => {
      if (err.meta !== undefined) {
        t.equal(err.meta.meta.connection, null, `${err.name} should redact the connection object`)
      } else {
        t.fail('should not be called')
      }
    })
  })

  t.end()
})

test('redact extra keys when passed', t => {
  const diags = makeDiagnostics()

  const errorOptions = {
    redactConnection: false,
    redactDiagnostics: true,
    additionalRedactionKeys: ['X-Another-Header']
  }

  diags.forEach(diag => {
    errFactory('err', diag, errorOptions).forEach(err => {
      const paramHeaders = err.meta?.meta.request.params.headers ?? {}
      t.equal(paramHeaders['x-another-header'], '[redacted]', `${err.name} should redact extra key`)

      const optHeaders = err.meta?.meta.request.options.headers ?? {}
      t.equal(optHeaders['x-another-header'], '[redacted]', `${err.name} should redact extra key`)
    })
  })

  t.end()
})

test('ConfigurationError should be thrown if meta is set but no error options are provided', t => {
  const diag = makeDiagnostics()[0]

  t.throws(() => {
    new errors.TimeoutError('err', diag)
  }, errors.ConfigurationError)

  t.throws(() => {
    new errors.ConnectionError('err', diag)
  }, errors.ConfigurationError)

  t.throws(() => {
    // @ts-expect-error Testing argument interdependence for the vanilla JS users that won't get TypeScript errors
    new errors.NoLivingConnectionsError('err', diag)
  }, errors.ConfigurationError)

  t.throws(() => {
    // @ts-expect-error Testing argument interdependence for the vanilla JS users that won't get TypeScript errors
    new errors.ResponseError(diag)
  }, errors.ConfigurationError)

  t.throws(() => {
    new errors.RequestAbortedError('err', diag)
  }, errors.ConfigurationError)

  t.throws(() => {
    new errors.ProductNotSupportedError('err', diag)
  }, errors.ConfigurationError)

  t.end()
})
