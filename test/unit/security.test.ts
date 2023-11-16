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
import { redactObject } from '../../src/security'

test('redactObject', t => {
  t.test('redacts values for matching keys at 8+ levels of nesting', t => {
    t.plan(4)
    const result = redactObject({
      foo: {
        bar: {
          baz: {
            bat: {
              bit: {
                but: {
                  biz: {
                    fiz: {
                      authorization: 'a secret',
                      password: 'another secret',
                      apiKey: { id: 'foo', api_key: 'bar' },
                      'x-elastic-app-auth': 'abcd1234',
                    }
                  }
                }
              }
            }
          }
        }
      }
    })
    t.equal(result.foo.bar.baz.bat.bit.but.biz.fiz.authorization, '[redacted]')
    t.equal(result.foo.bar.baz.bat.bit.but.biz.fiz.password, '[redacted]')
    t.equal(result.foo.bar.baz.bat.bit.but.biz.fiz.apiKey, '[redacted]')
    t.equal(result.foo.bar.baz.bat.bit.but.biz.fiz['x-elastic-app-auth'], '[redacted]')
  })

  t.test('does not redact keys that do not match', t => {
    t.plan(2)
    const result = redactObject({
      foo: 'bar',
      baz: 'bat',
    })
    t.equal(result.foo, 'bar')
    t.equal(result.baz, 'bat')
  })

  t.test('key-matching is case-insensitive', t => {
    t.plan(4)
    const result = redactObject({
      AuthorIzaTiON: 'something',
      pAsSwOrD: 'another thing',
      apiKEY: 'some key',
      'X-ELASTIC-app-auth': 'another key'
    })
    t.equal(result.AuthorIzaTiON, '[redacted]')
    t.equal(result.pAsSwOrD, '[redacted]')
    t.equal(result.apiKEY, '[redacted]')
    t.equal(result['X-ELASTIC-app-auth'], '[redacted]')
  })

  t.test('avoids infinite loops on circular references', t => {
    t.plan(1)
    const obj: Record<string, any> = { foo: 'bar' }
    obj.baz = obj
    try {
      const result = redactObject(obj)
      t.equal(result.baz, undefined)
    } catch (err) {
      if (err instanceof RangeError) {
        t.fail("Should not exceed max stack depth")
      } else {
        throw err
      }
    }
  })

  t.test('deeply clones object', t => {
    t.plan(4)

    const obj = {
      foo: {
        bar: {
          baz: 'bizz'
        }
      }
    }

    const result = redactObject(obj)

    t.not(obj, result)
    t.not(obj.foo, result.foo)
    t.not(obj.foo.bar, result.foo.bar)
    t.same(obj, result)
  })

  t.test('supports redacting a custom list of keys', t => {
    t.plan(3)
    const customKeys = ['foo', 'bar']
    const result = redactObject({
      foo: 'abc',
      bar: 123,
      baz: 'asdf',
    }, customKeys)

    t.equal(result.foo, '[redacted]')
    t.equal(result.bar, '[redacted]')
    t.equal(result.baz, 'asdf')
  })

  t.test('providing custom keys works in addition to default keys, not in replacement', t => {
    t.plan(1)
    const customKeys = ['foo', 'bar']
    const result = redactObject({
      foo: 'abc',
      bar: 123,
      baz: 'asdf',
      authorization: 'secret',
    }, customKeys)
    t.equal(result.authorization, '[redacted]')
  })

  t.test('redacts username and password from a URL object', t => {
    t.plan(1)
    const result = redactObject({
      url: new URL('http://user:pass@foo.com/path/to/endpoint?query=true')
    })
    t.equal(result.url, 'http://foo.com/path/to/endpoint?query=true')
  })

  t.end()
})
