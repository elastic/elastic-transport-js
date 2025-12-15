/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'tap'
import { stringify } from 'querystring'
import { Serializer, errors } from '../..'
const { SerializationError, DeserializationError } = errors

test('Basic', t => {
  t.plan(2)
  const s = new Serializer()
  const obj = { hello: 'world' }
  const json = JSON.stringify(obj)
  t.equal(s.serialize(obj), json)
  t.same(s.deserialize(json), obj)
})

test('ndserialize', t => {
  t.plan(1)
  const s = new Serializer()
  const obj = [
    { hello: 'world' },
    { winter: 'is coming' },
    { you_know: 'for search' }
  ]
  t.equal(
    s.ndserialize(obj),
    JSON.stringify(obj[0]) + '\n' +
    JSON.stringify(obj[1]) + '\n' +
    JSON.stringify(obj[2]) + '\n'
  )
})

test('ndserialize (strings)', t => {
  t.plan(1)
  const s = new Serializer()
  const obj = [
    JSON.stringify({ hello: 'world' }),
    JSON.stringify({ winter: 'is coming' }),
    JSON.stringify({ you_know: 'for search' })
  ]
  t.equal(
    s.ndserialize(obj),
    obj[0] + '\n' +
    obj[1] + '\n' +
    obj[2] + '\n'
  )
})

test('qserialize', t => {
  t.plan(1)
  const s = new Serializer()
  const obj = {
    hello: 'world',
    you_know: 'for search'
  }

  t.equal(
    s.qserialize(obj),
    stringify(obj)
  )
})

test('qserialize (array)', t => {
  t.plan(1)
  const s = new Serializer()
  const obj = {
    hello: 'world',
    arr: ['foo', 'bar']
  }

  t.equal(
    s.qserialize(obj),
    'hello=world&arr=foo%2Cbar'
  )
})

test('qserialize (string)', t => {
  t.plan(1)
  const s = new Serializer()
  const obj = {
    hello: 'world',
    you_know: 'for search'
  }

  t.equal(
    s.qserialize(stringify(obj)),
    stringify(obj)
  )
})

test('qserialize (undefined)', t => {
  t.plan(1)
  const s = new Serializer()

  t.equal(
    s.qserialize(undefined),
    ''
  )
})

test('qserialize (key with undefined value)', t => {
  t.plan(1)
  const s = new Serializer()
  const obj = {
    hello: 'world',
    key: undefined,
    foo: 'bar'
  }

  t.equal(
    s.qserialize(obj),
    'hello=world&foo=bar'
  )
})

test('SerializationError', t => {
  t.plan(1)
  const s = new Serializer()
  const obj = { hello: 'world' }
  // @ts-expect-error
  obj.o = obj
  try {
    s.serialize(obj)
    t.fail('Should fail')
  } catch (err: any) {
    t.ok(err instanceof SerializationError)
  }
})

test('SerializationError ndserialize', t => {
  t.plan(1)
  const s = new Serializer()
  try {
    // @ts-expect-error
    s.ndserialize({ hello: 'world' })
    t.fail('Should fail')
  } catch (err: any) {
    t.ok(err instanceof SerializationError)
  }
})

test('DeserializationError', t => {
  t.plan(1)
  const s = new Serializer()
  const json = '{"hello'
  try {
    s.deserialize(json)
    t.fail('Should fail')
  } catch (err: any) {
    t.ok(err instanceof DeserializationError)
  }
})

test('prototype poisoning protection enabled', t => {
   t.plan(2)
   const s = new Serializer({ enablePrototypePoisoningProtection: true })
   try {
     s.deserialize('{"__proto__":{"foo":"bar"}}')
     t.fail('Should fail')
   } catch (err: any) {
     t.ok(err instanceof DeserializationError)
   }

   try {
     s.deserialize('{"constructor":{"prototype":{"foo":"bar"}}}')
     t.fail('Should fail')
   } catch (err: any) {
     t.ok(err instanceof DeserializationError)
   }
 })

 test('disabled prototype poisoning protection by default', t => {
   t.plan(2)
   const s = new Serializer()
   try {
     s.deserialize('{"__proto__":{"foo":"bar"}}')
     t.pass('Should not fail')
   } catch (err: any) {
     t.fail(err)
   }

   try {
     s.deserialize('{"constructor":{"prototype":{"foo":"bar"}}}')
     t.pass('Should not fail')
   } catch (err: any) {
     t.fail(err)
   }
 })

 test('enable prototype poisoning protection only for proto', t => {
   t.plan(2)
   const s = new Serializer({ enablePrototypePoisoningProtection: 'proto' })
   try {
     s.deserialize('{"__proto__":{"foo":"bar"}}')
     t.fail('Should fail')
   } catch (err: any) {
     t.ok(err instanceof DeserializationError)
   }

   try {
     s.deserialize('{"constructor":{"prototype":{"foo":"bar"}}}')
     t.pass('Should not fail')
   } catch (err: any) {
     t.fail(err)
   }
 })

 test('disable prototype poisoning protection only for constructor', t => {
   t.plan(2)
   const s = new Serializer({ enablePrototypePoisoningProtection: 'constructor' })
   try {
     s.deserialize('{"__proto__":{"foo":"bar"}}')
     t.pass('Should not fail')
   } catch (err: any) {
     t.fail(err)
   }

   try {
     s.deserialize('{"constructor":{"prototype":{"foo":"bar"}}}')
     t.fail('Should fail')
   } catch (err: any) {
     t.ok(err instanceof DeserializationError)
   }
 })

test('encodeFloat32Vector', t => {
  t.plan(1)
  const s = new Serializer()
  const floats = [1.0, 2.0, 3.0]
  const encoded = s.encodeFloat32Vector(floats)
  const decoded = s.decodeFloat32Vector(encoded)
  t.same(decoded, floats)
})

test('encodeFloat32Vector (empty array)', t => {
  t.plan(1)
  const s = new Serializer()
  const floats: number[] = []
  const encoded = s.encodeFloat32Vector(floats)
  const decoded = s.decodeFloat32Vector(encoded)
  t.same(decoded, floats)
})

test('encodeFloat32Vector (negative values)', t => {
  t.plan(5)
  const s = new Serializer()
  const floats = [-1.5, 0.0, 0.25, 100.125, -999.999]
  const encoded = s.encodeFloat32Vector(floats)
  const decoded = s.decodeFloat32Vector(encoded)
  for (let i = 0; i < floats.length; i++) {
    t.ok(Math.abs(decoded[i] - floats[i]) < 0.001)
  }
})

test('encodeFloat32Vector (verify big-endian encoding)', t => {
  t.plan(1)
  const s = new Serializer()
  const encoded = s.encodeFloat32Vector([1.0, 2.0])
  t.equal(encoded, 'P4AAAEAAAAA=')
})

test('encodeFloat32Vector (not an array)', t => {
  t.plan(1)
  const s = new Serializer()
  try {
    // @ts-expect-error
    s.encodeFloat32Vector('not an array')
    t.fail('Should fail')
  } catch (err: any) {
    t.ok(err instanceof SerializationError)
  }
})

test('decodeFloat32Vector', t => {
  t.plan(1)
  const s = new Serializer()
  const original = [1.0, 2.0, 3.0, 4.0, 5.0]
  const encoded = s.encodeFloat32Vector(original)
  const decoded = s.decodeFloat32Vector(encoded)
  t.same(decoded, original)
})

test('decodeFloat32Vector (not a string)', t => {
  t.plan(1)
  const s = new Serializer()
  try {
    // @ts-expect-error
    s.decodeFloat32Vector(123)
    t.fail('Should fail')
  } catch (err: any) {
    t.ok(err instanceof DeserializationError)
  }
})

test('decodeFloat32Vector (invalid byte length)', t => {
  t.plan(1)
  const s = new Serializer()
  const invalidBase64 = Buffer.from([0x01, 0x02, 0x03]).toString('base64')
  try {
    s.decodeFloat32Vector(invalidBase64)
    t.fail('Should fail')
  } catch (err: any) {
    t.ok(err instanceof DeserializationError)
  }
})

test('encodeFloat32Vector (large vector)', t => {
  t.plan(1)
  const s = new Serializer()
  const floats = new Array(128).fill(0).map((_, i) => i * 0.1)
  const encoded = s.encodeFloat32Vector(floats)
  const decoded = s.decodeFloat32Vector(encoded)
  t.equal(decoded.length, 128)
})

test('encodeFloat32Vector (roundtrip with typical embedding values)', t => {
  t.plan(10)
  const s = new Serializer()
  const floats = [
    0.123, -0.456, 0.789, -0.012, 0.345,
    -0.678, 0.901, -0.234, 0.567, -0.890
  ]
  const encoded = s.encodeFloat32Vector(floats)
  const decoded = s.decodeFloat32Vector(encoded)
  for (let i = 0; i < floats.length; i++) {
    t.ok(Math.abs(decoded[i] - floats[i]) < 0.0001)
  }
})
