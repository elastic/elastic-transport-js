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

import traverse from 'traverse'

const secretKeys = [
  'authorization',
  'password',
  'apikey',
  'x-elastic-app-auth'
]

/**
 * Clones an object and recursively loops through all keys, redacting their values if the key matches any of a list of strings.
 * @param obj: Object to clone and redact
 * @param additionalKeys: Extra keys that can be matched for redaction. Does not overwrite the default set.
 */
export function redactObject (obj: Record<string, any>, additionalKeys: string[] = []): Record<string, any> {
  const toRedact = [...secretKeys, ...additionalKeys].map(key => key.toLowerCase())
  return traverse(obj)
    // ts-standard thinks this is Array.prototype.map but it isn't
    .map(function (node) { // eslint-disable-line array-callback-return
      // represent URLs as strings with no username/password
      // @ts-expect-error current typedef for `pre` is inaccurate
      this.pre(function (childNode, key) {
        if (childNode instanceof URL) {
          node[key] = `${childNode.origin}${childNode.pathname}${childNode.search}`
        }
      })

      if (this.circular !== null && this.circular !== undefined) {
        this.remove()
      } else if (this.key !== undefined && toRedact.includes(this.key.toLowerCase())) {
        this.update('[redacted]')
      }
    })
}
