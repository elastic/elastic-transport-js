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
import { inspect} from 'util'
import { redactObject } from '../../src/security'

test('redactObject', t => {
  t.test('redacts values for matching keys at 8+ levels of nesting', t => {
    t.plan(8)
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
    t.notMatch(JSON.stringify(result.foo.bar.baz.bat.bit.but.biz.fiz), '"authorization":"a secret"')
    t.notMatch(inspect(result.foo.bar.baz.bat.bit.but.biz.fiz), "authorization: 'a secret'")
    t.notMatch(JSON.stringify(result.foo.bar.baz.bat.bit.but.biz.fiz), '"password":"another secret"')
    t.notMatch(inspect(result.foo.bar.baz.bat.bit.but.biz.fiz), "password: 'another secret'")
    t.notMatch(JSON.stringify(result.foo.bar.baz.bat.bit.but.biz.fiz), '"api_key":"bar"')
    t.notMatch(inspect(result.foo.bar.baz.bat.bit.but.biz.fiz), "api_key: 'bar'")
    t.notMatch(JSON.stringify(result.foo.bar.baz.bat.bit.but.biz.fiz), '"x-elastic-app-auth":"abcd1234"')
    t.notMatch(inspect(result.foo.bar.baz.bat.bit.but.biz.fiz), "'x-elastic-app-auth': 'abcd1234'")
  })


  t.test('Object.keys does not expose secret', t => {
    const result = redactObject({
      authorization: 'secret1',
      password: 'secret2'
    })

    t.notOk(Object.keys(result).includes('authorization'))
    t.notOk(Object.keys(result).includes('password'))
    t.end()
  })

  t.test('Object.values does not expose secret', t => {
    const result = redactObject({
      authorization: 'secret1',
      password: 'secret2'
    })

    t.notOk(Object.values(result).includes('secret1'))
    t.notOk(Object.values(result).includes('secret2'))
    t.end()
  })

  t.test('Object.entries does not expose secret', t => {
    const result = redactObject({
      apiKey: 'secret1',
      'x-elastic-app-auth': 'secret2',
    })

    Object.entries(result).forEach(([key, value]) => {
      t.not(key, 'apiKey')
      t.not(key, 'x-elastic-app-auth')
      t.not(value, 'secret1')
      t.not(value, 'secret2')
    })
    t.end()
  })

  t.test('for..in loop does not expose secret', t => {
    const result = redactObject({
      authorization: 'secret-a',
      password: 'secret-b',
    })

    for (const key in result) {
      t.not(key, 'authorization')
      t.not(key, 'password')
    }
    t.end()
  })

  t.test('keeps actual values accessible', t => {
    t.plan(2)
    const result = redactObject({ password: 'secret' })
    t.equal(JSON.stringify(result), '{}')
    t.equal(result.password, 'secret')
  })

  t.test('does not redact keys that do not match', t => {
    t.plan(4)
    const result = redactObject({
      foo: 'bar',
      baz: 'bat',
    })
    t.match(JSON.stringify(result), '"foo":"bar"')
    t.match(JSON.stringify(result), '"baz":"bat"')
    t.equal(result.foo, 'bar')
    t.equal(result.baz, 'bat')
  })

  t.test('key-matching is case-insensitive', t => {
    t.plan(8)
    const result = redactObject({
      AuthorIzaTiON: 'something',
      pAsSwOrD: 'another thing',
      apiKEY: 'some key',
      'X-ELASTIC-app-auth': 'another key'
    })
    t.notMatch(JSON.stringify(result), '"AuthorIzaTiON":"something"')
    t.notMatch(JSON.stringify(result), 'something')
    t.notMatch(JSON.stringify(result), '"pAsSwOrD":"another thing"')
    t.notMatch(JSON.stringify(result), 'another thing')
    t.notMatch(JSON.stringify(result), '"apiKEY":"some key"')
    t.notMatch(JSON.stringify(result), 'some key')
    t.notMatch(JSON.stringify(result), '"X-ELASTIC-app-auth":"another key"')
    t.notMatch(JSON.stringify(result), 'another key')
  })

  t.test('avoids infinite loops on circular references', t => {
    t.plan(1)
    // simple circular reference
    const obj1: Record<string, any> = { foo: 'bar' }
    obj1.baz = { foo: obj1 }

    // ugly circular reference
    const obj2: Record<string, any> = { baz: 'bat' }
    obj2.biz = { foo: { bar: obj2 }}
    obj2.biz.foo.bar.bit = obj2.foo
    obj2.biz.foo.buz = obj1
    obj1.baz.zab = obj2.biz.foo

    try {
      redactObject(obj1)
      redactObject(obj2)
      t.pass('Got here')
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
    t.plan(5)
    const customKeys = ['foo', 'bar']
    const result = redactObject({
      foo: 'abc',
      bar: 123,
      baz: 'asdf',
    }, customKeys)

    t.notMatch(JSON.stringify(result), '"foo":"abc"')
    t.notMatch(JSON.stringify(result), 'abc')
    t.notMatch(JSON.stringify(result), '"bar":123')
    t.notMatch(JSON.stringify(result), '123')
    t.match(JSON.stringify(result), '"baz":"asdf"')
  })

  t.test('providing custom keys works in addition to default keys, not in replacement', t => {
    t.plan(2)
    const customKeys = ['foo', 'bar']
    const result = redactObject({
      foo: 'abc',
      bar: 123,
      baz: 'asdf',
      authorization: 'secret',
    }, customKeys)
    t.notMatch(JSON.stringify(result), '"authorization":"secret"')
    t.notMatch(JSON.stringify(result), 'secret')
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
