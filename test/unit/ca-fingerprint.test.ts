/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createPublicKey, createSign, generateKeyPairSync, randomBytes, X509Certificate, KeyObject } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { URL } from 'node:url'
import { test } from 'tap'
import { HttpConnection, UndiciConnection, errors } from '../../'

const { ConfigurationError, ConnectionError, RequestAbortedError } = errors

const certs = makeCerts()
const ca = certs.ca
const fingerprint = new X509Certificate(ca).fingerprint256

const requestOptions = {
  requestId: 1,
  name: 'ca-fingerprint',
  context: null
}

interface Started {
  port: number
  hits: () => number
  auths: () => string[]
  names: () => string[]
  close: () => Promise<void>
}

async function startProxy (targetPort: number, user: string, password: string): Promise<{ port: number, connects: () => number, close: () => Promise<void> }> {
  let connects = 0
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
  const proxy = http.createServer()
  proxy.on('connect', (req, clientSocket, head) => {
    if (req.headers['proxy-authorization'] !== expected) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
      clientSocket.destroy()
      return
    }
    connects++
    const upstream = net.connect(targetPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => clientSocket.destroy())
    clientSocket.on('error', () => upstream.destroy())
  })
  return await new Promise((resolve, reject) => {
    proxy.listen(0, '127.0.0.1', () => {
      const addr = proxy.address()
      if (addr == null || typeof addr === 'string') {
        reject(new Error('proxy has no port'))
        return
      }
      resolve({
        port: addr.port,
        connects: () => connects,
        close: async () => await new Promise(done => { proxy.close(() => done()) })
      })
    })
  })
}

function start (leaf: Buffer, key: Buffer, extra?: https.ServerOptions): Promise<Started> {
  let hits = 0
  const auths: string[] = []
  const names: string[] = []
  const server = https.createServer({
    cert: Buffer.concat([leaf, Buffer.from('\n'), ca]),
    key,
    ...extra
  }, (req, res) => {
    hits++
    if (req.headers.authorization != null) auths.push(String(req.headers.authorization))
    res.end('ok')
  })
  server.on('secureConnection', (socket) => {
    names.push(socket.servername ?? '')
  })
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr == null || typeof addr === 'string') {
        reject(new Error('test server has no port'))
        return
      }
      resolve({
        port: addr.port,
        hits: () => hits,
        auths: () => auths,
        names: () => names,
        close: async () => await new Promise(done => { server.close(() => done()) })
      })
    })
  })
}

const connections = [
  { name: 'HttpConnection', Connection: HttpConnection },
  { name: 'UndiciConnection', Connection: UndiciConnection }
]

for (const { name, Connection } of connections) {
  test(`${name} pins the CA and sends the request`, async t => {
    const server = await start(certs.good, certs.goodKey)
    const tls = { minVersion: 'TLSv1.2' as const }
    const connection = new Connection({
      url: new URL(`https://localhost:${server.port}`),
      caFingerprint: fingerprint.toLowerCase().replace(/:/g, ''),
      headers: { authorization: 'ApiKey secret' },
      tls
    })
    const res = await connection.request({ method: 'GET', path: '/' }, requestOptions)
    t.equal(res.body, 'ok')
    t.equal(server.hits(), 1)
    t.same(server.auths(), ['ApiKey secret'])
    t.equal('ca' in tls, false)
    if (connection instanceof HttpConnection) {
      const agent = connection.agent as https.Agent
      t.equal(agent.options.rejectUnauthorized, true)
      t.match(String(agent.options.ca), /BEGIN CERTIFICATE/)
    }
    await connection.close()
    await server.close()
  })

  test(`${name} abort during pin sends no request`, async t => {
    const server = await start(certs.good, certs.goodKey)
    const connection = new Connection({
      url: new URL(`https://localhost:${server.port}`),
      caFingerprint: fingerprint,
      headers: { authorization: 'ApiKey secret' }
    })
    const controller = new AbortController()
    const pending = connection.request(
      { method: 'GET', path: '/' },
      { ...requestOptions, signal: controller.signal }
    )
    controller.abort()
    try {
      await pending
      t.fail('request should abort')
    } catch (err: any) {
      t.ok(err instanceof RequestAbortedError, `Not a RequestAbortedError: ${err}`)
    }
    t.equal(server.hits(), 0)
    t.same(server.auths(), [])
    await connection.close()
    await server.close()
  })

  test(`${name} rejects a forged leaf before sending the request`, async t => {
    const server = await start(certs.forged, certs.forgedKey)
    const connection = new Connection({
      url: new URL(`https://localhost:${server.port}`),
      caFingerprint: fingerprint,
      headers: { authorization: 'ApiKey secret' }
    })
    try {
      await connection.request({ method: 'GET', path: '/' }, requestOptions)
      t.fail('request should fail')
    } catch (err: any) {
      t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
      t.not(err.message, 'Server certificate CA fingerprint does not match the value configured in caFingerprint')
      t.match(err.message, /signature|certificate/)
    }
    t.equal(server.hits(), 0)
    t.same(server.auths(), [])
    await connection.close()
    await server.close()
  })

  test(`${name} rejects an expired certificate`, async t => {
    const server = await start(certs.expired, certs.expiredKey)
    const connection = new Connection({
      url: new URL(`https://localhost:${server.port}`),
      caFingerprint: fingerprint
    })
    try {
      await connection.request({ method: 'GET', path: '/' }, requestOptions)
      t.fail('request should fail')
    } catch (err: any) {
      t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
      t.match(err.message, /expired/)
    }
    t.equal(server.hits(), 0)
    await connection.close()
    await server.close()
  })

  test(`${name} rejects a hostname mismatch`, async t => {
    const server = await start(certs.other, certs.otherKey)
    const connection = new Connection({
      url: new URL(`https://localhost:${server.port}`),
      caFingerprint: fingerprint
    })
    try {
      await connection.request({ method: 'GET', path: '/' }, requestOptions)
      t.fail('request should fail')
    } catch (err: any) {
      t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
      t.match(err.message, /hostname|altnames/i)
      t.not(err.message, 'Server certificate CA fingerprint does not match the value configured in caFingerprint')
    }
    t.equal(server.hits(), 0)
    await connection.close()
    await server.close()
  })

  test(`${name} allows checkServerIdentity to skip the hostname`, async t => {
    const server = await start(certs.other, certs.otherKey)
    const connection = new Connection({
      url: new URL(`https://localhost:${server.port}`),
      caFingerprint: fingerprint,
      tls: { checkServerIdentity: () => undefined }
    })
    const res = await connection.request({ method: 'GET', path: '/' }, requestOptions)
    t.equal(res.body, 'ok')
    t.equal(server.hits(), 1)
    await connection.close()
    await server.close()
  })

  test(`${name} does not send HTTP for a bad fingerprint`, async t => {
    const server = await start(certs.good, certs.goodKey)
    for (const caFingerprint of ['', '../', '?#', '/etc/passwd', 'FO:OB:AR']) {
      const connection = new Connection({
        url: new URL(`https://localhost:${server.port}`),
        caFingerprint
      })
      try {
        await connection.request({ method: 'GET', path: '/' }, requestOptions)
        t.fail(`request should fail for ${JSON.stringify(caFingerprint)}`)
      } catch (err: any) {
        t.ok(err instanceof ConnectionError, `${JSON.stringify(caFingerprint)} -> ${err}`)
      }
      await connection.close()
    }
    t.equal(server.hits(), 0)
    await server.close()
  })

  test(`${name} keeps verification on when the caller disabled it`, async t => {
    const server = await start(certs.good, certs.goodKey)
    const tls = { rejectUnauthorized: false, ca }
    const connection = new Connection({
      url: new URL(`https://localhost:${server.port}`),
      caFingerprint: fingerprint,
      tls
    })
    const res = await connection.request({ method: 'GET', path: '/' }, requestOptions)
    t.equal(res.body, 'ok')
    t.equal(server.hits(), 1)
    t.equal(tls.rejectUnauthorized, false)
    t.equal(tls.ca, ca)
    if (connection instanceof HttpConnection) {
      const agent = connection.agent as https.Agent
      t.equal(agent.options.rejectUnauthorized, true)
      t.match(String(agent.options.ca), /BEGIN CERTIFICATE/)
    }
    await connection.close()
    await server.close()
  })

  test(`${name} probe uses the caller tls options`, async t => {
    const server = await start(certs.good, certs.goodKey, {
      requestCert: true,
      rejectUnauthorized: true,
      ca
    })
    const connection = new Connection({
      url: new URL(`https://127.0.0.1:${server.port}`),
      caFingerprint: fingerprint,
      tls: { cert: certs.good, key: certs.goodKey, servername: 'localhost' }
    })
    const res = await connection.request({ method: 'GET', path: '/' }, requestOptions)
    t.equal(res.body, 'ok')
    t.equal(server.hits(), 1)
    t.equal(server.names()[0], 'localhost')
    await connection.close()
    await server.close()
  })

  test(`${name} rejects a custom agent`, async t => {
    const url = new URL('https://localhost:1')
    try {
      new Connection({
        url,
        caFingerprint: fingerprint,
        agent: () => { throw new Error('agent should not be called') }
      })
      t.fail('constructor should throw')
    } catch (err: any) {
      t.ok(err instanceof ConfigurationError, `Not a ConfigurationError: ${err}`)
      t.match(err.message, /custom agent/)
    }
  })
}

test('HttpConnection probe connects through the proxy', async t => {
  const server = await start(certs.good, certs.goodKey)
  const proxy = await startProxy(server.port, 'a', 'p@ss')
  const connection = new HttpConnection({
    url: new URL('https://127.0.0.1:1'),
    caFingerprint: fingerprint,
    proxy: `http://a:p%40ss@127.0.0.1:${proxy.port}`,
    tls: { servername: 'localhost' }
  })
  const res = await connection.request({ method: 'GET', path: '/' }, requestOptions)
  t.equal(res.body, 'ok')
  t.equal(server.hits(), 1)
  t.ok(proxy.connects() >= 2)
  await connection.close()
  await proxy.close()
  await server.close()
})

test('HttpConnection agent: false still pins the data connection', async t => {
  const server = await start(certs.forged, certs.forgedKey)
  const connection = new HttpConnection({
    url: new URL(`https://localhost:${server.port}`),
    caFingerprint: fingerprint,
    agent: false,
    headers: { authorization: 'ApiKey secret' }
  })
  const seen: https.RequestOptions[] = []
  const orig = connection.makeRequest
  connection.makeRequest = ((options: https.RequestOptions) => {
    seen.push(options)
    return orig.call(connection, options)
  }) as typeof connection.makeRequest
  try {
    await connection.request({ method: 'GET', path: '/' }, requestOptions)
    t.fail('request should fail')
  } catch (err: any) {
    t.ok(err instanceof ConnectionError, `Not a ConnectionError: ${err}`)
  }
  t.equal(seen.length, 1)
  t.equal(seen[0].rejectUnauthorized, true)
  t.equal(seen[0].agent, false)
  t.match(String(seen[0].ca), /BEGIN CERTIFICATE/)
  t.equal(server.hits(), 0)
  await connection.close()
  await server.close()
})

interface Certs {
  ca: Buffer
  good: Buffer
  goodKey: Buffer
  forged: Buffer
  forgedKey: Buffer
  expired: Buffer
  expiredKey: Buffer
  other: Buffer
  otherKey: Buffer
}

function makeCerts (): Certs {
  const now = Date.now()
  const caKey = rsa()
  const ca = signCert({
    subject: 'Test Dev CA',
    issuer: 'Test Dev CA',
    key: caKey,
    signer: caKey,
    ca: true,
    notBefore: new Date(now - 86400000),
    notAfter: new Date(now + 2 * 86400000)
  })
  const goodKey = rsa()
  const forgedKey = rsa()
  const expiredKey = rsa()
  const otherKey = rsa()
  return {
    ca,
    goodKey: pemKey(goodKey),
    forgedKey: pemKey(forgedKey),
    expiredKey: pemKey(expiredKey),
    otherKey: pemKey(otherKey),
    good: signCert({
      subject: 'localhost',
      issuer: 'Test Dev CA',
      key: goodKey,
      signer: caKey,
      san: 'localhost',
      notBefore: new Date(now - 86400000),
      notAfter: new Date(now + 2 * 86400000)
    }),
    forged: signCert({
      subject: 'localhost',
      issuer: 'Test Dev CA',
      key: forgedKey,
      signer: forgedKey,
      san: 'localhost',
      notBefore: new Date(now - 86400000),
      notAfter: new Date(now + 2 * 86400000)
    }),
    expired: signCert({
      subject: 'localhost',
      issuer: 'Test Dev CA',
      key: expiredKey,
      signer: caKey,
      san: 'localhost',
      notBefore: new Date(now - 10 * 86400000),
      notAfter: new Date(now - 86400000)
    }),
    other: signCert({
      subject: 'other.example',
      issuer: 'Test Dev CA',
      key: otherKey,
      signer: caKey,
      san: 'other.example',
      notBefore: new Date(now - 86400000),
      notAfter: new Date(now + 2 * 86400000)
    })
  }
}

function rsa (): KeyObject {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
}

function pemKey (key: KeyObject): Buffer {
  return Buffer.from(key.export({ type: 'pkcs1', format: 'pem' }))
}

function signCert (opts: {
  subject: string
  issuer: string
  key: KeyObject
  signer: KeyObject
  ca?: boolean
  san?: string
  notBefore: Date
  notAfter: Date
}): Buffer {
  const extensions: Buffer[] = []
  if (opts.ca === true) {
    extensions.push(ext('2.5.29.19', true, seq(Buffer.from([0x01, 0x01, 0xff]))))
  }
  if (opts.san != null) {
    extensions.push(ext('2.5.29.17', false, seq(tlv(0x82, Buffer.from(opts.san)))))
  }
  // nonzero, positive leading byte keeps the DER INTEGER minimal; OpenSSL 3 rejects padded ones
  const serial = randomBytes(8)
  serial[0] = (serial[0] & 0x7f) | 0x01
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    sha256Rsa(),
    dn(opts.issuer),
    seq(utc(opts.notBefore), utc(opts.notAfter)),
    dn(opts.subject),
    createPublicKey(opts.key).export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(...extensions))
  )
  const signature = createSign('RSA-SHA256').update(tbs).sign(opts.signer)
  const der = seq(tbs, sha256Rsa(), bitString(signature))
  const b64 = der.toString('base64').match(/.{1,64}/g)?.join('\n')
  return Buffer.from(`-----BEGIN CERTIFICATE-----\n${b64 ?? ''}\n-----END CERTIFICATE-----\n`)
}

function sha256Rsa (): Buffer {
  return seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]))
}

function dn (cn: string): Buffer {
  return seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))))
}

function ext (id: string, critical: boolean, value: Buffer): Buffer {
  const parts = [oid(id)]
  if (critical) parts.push(Buffer.from([0x01, 0x01, 0xff]))
  parts.push(tlv(0x04, value))
  return seq(...parts)
}

function oid (dotted: string): Buffer {
  const parts = dotted.split('.').map(Number)
  const body = [40 * parts[0] + parts[1]]
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f]
    let value = Math.floor(part / 128)
    while (value > 0) {
      chunk.unshift((value & 0x7f) | 0x80)
      value = Math.floor(value / 128)
    }
    body.push(...chunk)
  }
  return tlv(0x06, Buffer.from(body))
}

function integer (body: Buffer): Buffer {
  const normalized = (body[0] & 0x80) !== 0 ? Buffer.concat([Buffer.from([0]), body]) : body
  return tlv(0x02, normalized)
}

function utc (date: Date): Buffer {
  const p = (n: number): string => String(n).padStart(2, '0')
  const text = p(date.getUTCFullYear() % 100) + p(date.getUTCMonth() + 1) + p(date.getUTCDate()) +
    p(date.getUTCHours()) + p(date.getUTCMinutes()) + p(date.getUTCSeconds()) + 'Z'
  return tlv(0x17, Buffer.from(text))
}

function bitString (body: Buffer): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([0]), body]))
}

function seq (...parts: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(parts))
}

function set (...parts: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(parts))
}

function tlv (tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body])
}

function derLen (length: number): Buffer {
  if (length < 128) return Buffer.from([length])
  const bytes: number[] = []
  let left = length
  while (left > 0) {
    bytes.unshift(left & 0xff)
    left = Math.floor(left / 256)
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
