/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { inspect} from 'util'
import { redactObject, sanitizeJsonBody, sanitizeStringQuery, sanitizeNdjsonBody } from '../../src/security'

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
      t.not(value, 'secret1')
      t.not(value, 'secret2')
    })
    t.end()
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

  t.test('properly recurses into arrays', t => {
    t.plan(2)
    const result = redactObject({
      foo: [
        { authorization: 'foo' },
        { password: 'bar' },
      ]
    })

    t.notMatch(result.foo[0].authorization, 'foo')
    t.notMatch(result.foo[1].password, 'bar')
  })

  t.test('does not fail on undefined or null', t => {
    // @ts-expect-error
    t.doesNotThrow(() => redactObject(null))
    // @ts-expect-error
    t.doesNotThrow(() => redactObject(undefined))
    t.doesNotThrow(() => redactObject({ foo: undefined }))
    t.doesNotThrow(() => redactObject({ foo: null }))
    t.end()
  })

  t.end()
})


test('sanitizeJsonBody', t => {
  t.test('replaces string values with "?"', t => {
    t.equal(sanitizeJsonBody('{"key": "value"}'), '{"?": "?"}', 'string values replaced')
    t.end()
  })

  t.test('replaces object keys with "?"', t => {
    t.equal(sanitizeJsonBody('{"myKey": 1}'), '{"?": ?}', 'object keys replaced')
    t.end()
  })

  t.test('replaces numeric values with ?', t => {
    t.equal(sanitizeJsonBody('{"n": 42}'), '{"?": ?}', 'integer replaced')
    t.equal(sanitizeJsonBody('{"n": 1.5}'), '{"?": ?}', 'float replaced')
    t.equal(sanitizeJsonBody('{"n": -42}'), '{"?": ?}', 'negative replaced')
    t.equal(sanitizeJsonBody('{"n": 1.5e10}'), '{"?": ?}', 'scientific notation replaced')
    t.end()
  })

  t.test('replaces boolean values with ?', t => {
    t.equal(sanitizeJsonBody('{"a": true, "b": false}'), '{"?": ?, "?": ?}', 'booleans replaced')
    t.end()
  })

  t.test('replaces null literal values with ?', t => {
    t.equal(sanitizeJsonBody('{"a": null}'), '{"?": ?}', 'null replaced')
    t.end()
  })

  t.test('handles nested objects', t => {
    const input = '{"query": {"match": {"field": "value"}}, "size": 10}'
    t.equal(sanitizeJsonBody(input), '{"?": {"?": {"?": "?"}}, "?": ?}', 'nested structure sanitized')
    t.end()
  })

  t.test('handles arrays', t => {
    t.equal(sanitizeJsonBody('[1, "foo", true, null]'), '[?, "?", ?, ?]', 'array literals sanitized')
    t.end()
  })

  t.test('handles escaped characters in strings', t => {
    t.equal(sanitizeJsonBody('{"key": "hello \\"world\\""}'), '{"?": "?"}', 'escaped strings sanitized to single "?"')
    t.end()
  })

  t.test('handles a simple string JSON value', t => {
    t.equal(sanitizeJsonBody('"hello"'), '"?"', 'bare string sanitized')
    t.end()
  })

  t.test('handles complex DSL-style body', t => {
    const input = '{"query":{"bool":{"must":[{"match":{"title":"elasticsearch"}}]}},"size":5,"from":0}'
    const result = sanitizeJsonBody(input)
    t.ok(result != null, 'result is not null')
    t.notMatch(result as string, 'elasticsearch', 'no raw string values remain')
    t.notMatch(result as string, '5', 'no raw numeric values remain')
    t.end()
  })

  t.test('returns null for null input', t => {
    // @ts-expect-error
    t.equal(sanitizeJsonBody(null), null)
    t.end()
  })

  t.test('returns null for undefined input', t => {
    // @ts-expect-error
    t.equal(sanitizeJsonBody(undefined), null)
    t.end()
  })

  t.test('returns null for empty string input', t => {
    t.equal(sanitizeJsonBody(''), null)
    t.end()
  })

  t.test('does not throw on malformed JSON', t => {
    t.doesNotThrow(() => sanitizeJsonBody('{not valid json'))
    t.doesNotThrow(() => sanitizeJsonBody('{"key": '))
    t.doesNotThrow(() => sanitizeJsonBody('undefined'))
    t.end()
  })

  t.end()
})


test('sanitizeStringQuery', t => {
  t.test('returns query string for a parameterized query', t => {
    const body = JSON.stringify({ query: 'SELECT * FROM logs WHERE id = ?' })
    t.equal(sanitizeStringQuery(body), 'SELECT * FROM logs WHERE id = ?')
    t.end()
  })

  t.test('returns null for a non-parameterized query (no ?)', t => {
    const body = JSON.stringify({ query: 'SELECT * FROM logs WHERE id = 42' })
    t.equal(sanitizeStringQuery(body), null)
    t.end()
  })

  t.test('returns null when query field is missing', t => {
    t.equal(sanitizeStringQuery(JSON.stringify({ size: 10 })), null)
    t.end()
  })

  t.test('returns null when query field is not a string', t => {
    t.equal(sanitizeStringQuery(JSON.stringify({ query: { match_all: {} } })), null)
    t.equal(sanitizeStringQuery(JSON.stringify({ query: 42 })), null)
    t.equal(sanitizeStringQuery(JSON.stringify({ query: null })), null)
    t.end()
  })

  t.test('returns null for null input', t => {
    // @ts-expect-error
    t.equal(sanitizeStringQuery(null), null)
    t.end()
  })

  t.test('returns null for undefined input', t => {
    // @ts-expect-error
    t.equal(sanitizeStringQuery(undefined), null)
    t.end()
  })

  t.test('returns null for empty string input', t => {
    t.equal(sanitizeStringQuery(''), null)
    t.end()
  })

  t.test('returns null for JSON parse failure', t => {
    t.equal(sanitizeStringQuery('{not valid json'), null)
    t.equal(sanitizeStringQuery('not json at all'), null)
    t.end()
  })

  t.test('returns null for a JSON array at root (no query field)', t => {
    t.equal(sanitizeStringQuery('["SELECT * FROM logs WHERE id = ?"]'), null)
    t.end()
  })

  t.test('does not throw on any input', t => {
    t.doesNotThrow(() => sanitizeStringQuery(null as any))
    t.doesNotThrow(() => sanitizeStringQuery(undefined as any))
    t.doesNotThrow(() => sanitizeStringQuery(''))
    t.doesNotThrow(() => sanitizeStringQuery('{broken'))
    t.doesNotThrow(() => sanitizeStringQuery(JSON.stringify({ query: 'no question mark' })))
    t.end()
  })

  t.end()
})

test('sanitizeNdjsonBody', t => {
  t.test('sanitizes query lines (odd-indexed) and passes header lines verbatim', t => {
    const header = '{"index":{}}'
    const queryBody = '{"query":{"match":{"title":"elasticsearch"}},"size":5}'
    const input = header + '\n' + queryBody + '\n'
    const result = sanitizeNdjsonBody(input)
    t.ok(result != null, 'result is not null')
    const lines = (result as string).split('\n').filter(l => l.length > 0)
    t.equal(lines[0], header, 'header line passed verbatim')
    t.notMatch(lines[1], 'elasticsearch', 'query body sanitized')
    t.end()
  })

  t.test('handles multiple search bodies', t => {
    const h1 = '{"index":"logs"}'
    const b1 = '{"query":{"match_all":{}}}'
    const h2 = '{"index":"metrics"}'
    const b2 = '{"query":{"term":{"status":"active"}},"size":10}'
    const input = [h1, b1, h2, b2].join('\n') + '\n'
    const result = sanitizeNdjsonBody(input)
    t.ok(result != null, 'result is not null')
    const lines = (result as string).split('\n').filter(l => l.length > 0)
    t.equal(lines[0], h1, 'first header verbatim')
    t.equal(lines[2], h2, 'second header verbatim')
    t.notMatch(lines[1], 'match_all', 'first query sanitized')
    t.notMatch(lines[3], 'active', 'second query sanitized')
    t.end()
  })

  t.test('preserves trailing newline', t => {
    const input = '{"index":{}}\n{"query":{"match_all":{}}}\n'
    const result = sanitizeNdjsonBody(input)
    t.ok((result as string).endsWith('\n'), 'trailing newline preserved')
    t.end()
  })

  t.test('preserves CRLF line endings', t => {
    const input = '{"index":{}}\r\n{"query":{"match_all":{}}}\r\n'
    const result = sanitizeNdjsonBody(input)
    t.ok(result != null, 'result is not null')
    t.ok((result as string).includes('\r\n'), 'CRLF preserved')
    t.ok((result as string).endsWith('\r\n'), 'trailing CRLF preserved')
    t.end()
  })

  t.test('returns null for null input', t => {
    // @ts-expect-error
    t.equal(sanitizeNdjsonBody(null), null)
    t.end()
  })

  t.test('returns null for undefined input', t => {
    // @ts-expect-error
    t.equal(sanitizeNdjsonBody(undefined), null)
    t.end()
  })

  t.test('returns null for empty string input', t => {
    t.equal(sanitizeNdjsonBody(''), null)
    t.end()
  })

  t.test('does not throw on any input', t => {
    t.doesNotThrow(() => sanitizeNdjsonBody(null as any))
    t.doesNotThrow(() => sanitizeNdjsonBody(undefined as any))
    t.doesNotThrow(() => sanitizeNdjsonBody(''))
    t.doesNotThrow(() => sanitizeNdjsonBody('{"index":{}}\n{broken json\n'))
    t.end()
  })

  t.end()
})