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
import { errors, DiagnosticResult } from '../../'
import { HttpConnection, UndiciConnection } from '../../'

const theSecret = '**foo-bar-baz-bat**'

function makeDiagnostics(): DiagnosticResult[] {
  const diagnosticBase: DiagnosticResult = {
    headers: {
      'accept': 'text/plain',
      'authorization': theSecret,
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
          }
        },
        options: {
          headers: {
            authorization: theSecret,
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

  // TODO: figure out which of these could also contain secrets
  //   auth?: BasicAuth | ApiKeyAuth | BearerAuth;
  //   diagnostic?: Diagnostic;
  //   timeout?: number;
  //   agent?: HttpAgentOptions | UndiciAgentOptions | agentFn | boolean;
  //   proxy?: string | URL;
  //   caFingerprint?: string;
}

test('redact sensitive data when logging a TimeoutError', t => {
  const diags = makeDiagnostics()

  diags.forEach(diag => {
    const err = new errors.TimeoutError('err', diag)
    t.notMatch(inspect(err), theSecret, 'TimeoutError should redact sensitive data')
    t.notMatch(inspect(err.meta), theSecret, 'TimeoutError should redact sensitive data')
    t.notMatch(JSON.stringify(err.meta ?? ''), theSecret)
    t.notMatch(err.meta?.toString(), theSecret)
  })

  t.end()
})

test('redact sensitive data when logging a ConnectionError', t => {
  const diags = makeDiagnostics()

  diags.forEach(diag => {
    const err = new errors.ConnectionError('err', diag)
    t.notMatch(inspect(err), theSecret, 'ConnectionError should redact sensitive data')
    t.notMatch(inspect(err.meta), theSecret, 'ConnectionError should redact sensitive data')
    t.notMatch(JSON.stringify(err.meta ?? ''), theSecret)
    t.notMatch(err.meta?.toString(), theSecret)
  })

  t.end()
})

test('redact sensitive data when logging a NoLivingConnectionsError', t => {
  const diags = makeDiagnostics()

  diags.forEach(diag => {
    const err = new errors.NoLivingConnectionsError('err', diag)
    t.notMatch(inspect(err), theSecret, 'NoLivingConnectionsError should redact sensitive data')
    t.notMatch(inspect(err.meta), theSecret, 'NoLivingConnectionsError should redact sensitive data')
    t.notMatch(JSON.stringify(err.meta ?? ''), theSecret)
    t.notMatch(err.meta?.toString(), theSecret)
  })

  t.end()
})

test('redact sensitive data when logging a ResponseError', t => {
  const diags = makeDiagnostics()

  diags.forEach(diag => {
    const err = new errors.ResponseError(diag)
    t.notMatch(inspect(err), theSecret, 'ResponseError should redact sensitive data')
    t.notMatch(inspect(err.meta), theSecret, 'ResponseError should redact sensitive data')
    t.notMatch(JSON.stringify(err.meta ?? ''), theSecret)
    t.notMatch(err.meta?.toString(), theSecret)
  })

  t.end()
})

test('redact sensitive data when logging a RequestAbortedError', t => {
  const diags = makeDiagnostics()

  diags.forEach(diag => {
    const err = new errors.RequestAbortedError('err', diag)
    t.notMatch(inspect(err), theSecret, 'RequestAbortedError should redact sensitive data')
    t.notMatch(inspect(err.meta), theSecret, 'RequestAbortedError should redact sensitive data')
    t.notMatch(JSON.stringify(err.meta ?? ''), theSecret)
    t.notMatch(err.meta?.toString(), theSecret)
  })

  t.end()
})

test('redact sensitive data when logging a ProductNotSupportedError', t => {
  const diags = makeDiagnostics()

  diags.forEach(diag => {
    const err = new errors.ProductNotSupportedError('err', diag)
    t.notMatch(inspect(err), theSecret, 'ProductNotSupportedError should redact sensitive data')
    t.notMatch(inspect(err.meta), theSecret, 'ProductNotSupportedError should redact sensitive data')
    t.notMatch(JSON.stringify(err.meta ?? ''), theSecret)
    t.notMatch(err.meta?.toString(), theSecret)
  })

  t.end()
})
