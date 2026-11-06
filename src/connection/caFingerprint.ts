/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { X509Certificate } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls, { ConnectionOptions as TlsConnectionOptions, DetailedPeerCertificate, TLSSocket } from 'node:tls'
import { ConnectionError, ConfigurationError } from '../errors'
import { ConnectionOptions } from './BaseConnection'

const CA_FINGERPRINT_MISMATCH = 'Server certificate CA fingerprint does not match the value configured in caFingerprint'

export interface PinSlot {
  task: Promise<void> | null
}

export async function pinOnce (slot: PinSlot, run: () => Promise<void>): Promise<void> {
  if (slot.task == null) {
    slot.task = run().catch((err: unknown) => {
      slot.task = null
      throw err
    })
  }
  await slot.task
}

export interface ProbeDial {
  proxy?: string | URL
  tls?: TlsConnectionOptions | null
}

export function assertCaFingerprintOptions (opts: ConnectionOptions): void {
  if (opts.caFingerprint == null) return
  if (typeof opts.agent === 'function') {
    throw new ConfigurationError('caFingerprint cannot be combined with a custom agent')
  }
}

function fingerprintMatches (expected: string, actual: string): boolean {
  return expected.toLowerCase().replace(/:/g, '') === actual.toLowerCase().replace(/:/g, '')
}

// probe only, no HTTP is written so credentials stay off this socket
export async function fetchPinnedCaPem (url: URL, fingerprint: string, timeout: number | null, dial?: ProbeDial): Promise<string> {
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const port = url.port !== '' ? Number(url.port) : 443
  let pems: string[]
  try {
    pems = await readPeerPems(host, port, timeout, dial)
  } catch (err: any) {
    if (err instanceof ConnectionError) throw err
    throw new ConnectionError(err?.message ?? String(err))
  }
  for (const pem of pems) {
    if (fingerprintMatches(fingerprint, new X509Certificate(pem).fingerprint256)) {
      return pem.endsWith('\n') ? pem : `${pem}\n`
    }
  }
  throw new ConnectionError(CA_FINGERPRINT_MISMATCH)
}

async function readPeerPems (host: string, port: number, timeout: number | null, dial?: ProbeDial): Promise<string[]> {
  const userTls = dial?.tls ?? undefined
  const socket = tls.connect({
    ...userTls,
    host,
    port,
    servername: userTls?.servername ?? (net.isIP(host) === 0 ? host : undefined),
    rejectUnauthorized: false,
    socket: dial?.proxy != null ? await connectProxy(dial.proxy, host, port, timeout) : undefined
  })
  return await new Promise((resolve, reject) => {
    let settled = false
    if (timeout != null && timeout > 0) socket.setTimeout(timeout)
    const finish = (err: Error | null, pems?: string[]): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (err != null) reject(err)
      else resolve(pems ?? [])
    }
    socket.once('secureConnect', () => {
      try {
        finish(null, peerPems(socket))
      } catch (err: any) {
        finish(err)
      }
    })
    socket.once('error', finish)
    socket.once('timeout', () => {
      finish(new Error('Timeout while reading the server certificate'))
    })
  })
}

async function connectProxy (proxy: string | URL, host: string, port: number, timeout: number | null): Promise<net.Socket> {
  const proxyUrl = typeof proxy === 'string' ? new URL(proxy) : proxy
  const target = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`
  const headers: http.OutgoingHttpHeaders = { host: target }
  if (proxyUrl.username !== '' || proxyUrl.password !== '') {
    const token = Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')
    headers['proxy-authorization'] = `Basic ${token}`
  }
  const proxyHost = proxyUrl.hostname.startsWith('[') ? proxyUrl.hostname.slice(1, -1) : proxyUrl.hostname
  const request = (proxyUrl.protocol === 'https:' ? https : http).request({
    method: 'CONNECT',
    host: proxyHost,
    port: proxyUrl.port !== '' ? Number(proxyUrl.port) : (proxyUrl.protocol === 'https:' ? 443 : 80),
    path: target,
    setHost: false,
    headers,
    agent: false,
    servername: proxyUrl.protocol === 'https:' ? proxyHost : undefined
  })
  if (timeout != null && timeout > 0) request.setTimeout(timeout)
  return await new Promise((resolve, reject) => {
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      request.destroy()
      reject(err)
    }
    request.once('connect', (response, socket) => {
      if (settled) return
      settled = true
      if (response.statusCode === 200) {
        resolve(socket)
        return
      }
      socket.destroy()
      reject(new Error(`Proxy CONNECT failed: ${response.statusCode ?? 'unknown'}`))
    })
    request.once('timeout', () => fail(new Error('Timeout while connecting through the proxy')))
    request.once('error', fail)
    request.end()
  })
}

function peerPems (socket: TLSSocket): string[] {
  const pems: string[] = []
  const seen = new Set<string>()
  let current: DetailedPeerCertificate | null = socket.getPeerCertificate(true)
  while (current?.raw != null && current.fingerprint256 != null && !seen.has(current.fingerprint256)) {
    seen.add(current.fingerprint256)
    pems.push(new X509Certificate(current.raw).toString())
    const issuer = current.issuerCertificate as DetailedPeerCertificate | undefined
    if (issuer?.raw == null || issuer.fingerprint256 === current.fingerprint256) break
    current = issuer
  }
  return pems
}
