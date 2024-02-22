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

test('replace sensitive data for redaction type "replace"', t => {
  const diags = makeDiagnostics()

  const errorOptions: errors.ErrorOptions = {
    redaction: { type: 'replace' }
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

test('strip most optional properties when redaction type is "remove"', t => {
  const diags = makeDiagnostics()

  const errorOptions: errors.ErrorOptions = {
    redaction: { type: 'remove' }
  }

  diags.forEach(diag => {
    errFactory('err', diag, errorOptions).forEach(err => {
      if (err.meta !== undefined) {
        t.equal(typeof err.meta.headers, 'undefined', `${err.name} should remove meta.headers`)
        t.equal(typeof err.meta.meta.sniff, 'undefined', `${err.name} should remove meta.meta.sniff`)
        t.equal(typeof err.meta.meta.request.params.headers, 'undefined', `${err.name} should remove meta.meta.request.params.headers`)
        t.same(err.meta.meta.request.options, {}, `${err.name} should remove meta.meta.request.options`)
        t.equal(err.meta.meta.connection, null, `${err.name} should remove the connection object`)
      } else {
        t.fail('should not be called')
      }
    })
  })

  t.end()
})

test('redact extra keys when passed', t => {
  const diags = makeDiagnostics()

  const errorOptions: errors.ErrorOptions = {
    redaction: {
      type: 'replace',
      additionalKeys: ['X-Another-Header']
    }
  }

  diags.forEach(diag => {
    errFactory('err', diag, errorOptions).forEach(err => {
      const paramHeaders = err.meta?.meta.request.params.headers ?? {}
      t.notMatch(JSON.stringify(paramHeaders), `"x-another-header":"${theOtherSecret}"`, `${err.name} should redact extra key`)
      t.notMatch(JSON.stringify(paramHeaders), theOtherSecret, `${err.name} should redact extra key`)

      const optHeaders = err.meta?.meta.request.options.headers ?? {}
      t.notMatch(JSON.stringify(optHeaders), `"x-another-header":"${theOtherSecret}"`, `${err.name} should redact extra key`)
      t.notMatch(JSON.stringify(optHeaders), theOtherSecret, `${err.name} should redact extra key`)
    })
  })

  t.end()
})

test('redaction does not transform array properties into objects', t => {
  const errResponse = new errors.ResponseError({
    body: {
      error: {
        root_cause: [
          {
            type: 'index_not_found_exception',
            reason: 'no such index [poop]',
          },
        ],
      },
      status: 404,
    },
    statusCode: 404,
    headers: {},
    warnings: [],
    meta: {} as any,
  });

  t.equal(Array.isArray(errResponse.body.error.root_cause), true)
  t.end()
})