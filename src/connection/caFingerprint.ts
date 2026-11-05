/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { X509Certificate } from 'node:crypto'
import net from 'node:net'
import tls, { DetailedPeerCertificate, TLSSocket } from 'node:tls'
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

export function assertCaFingerprintOptions (opts: ConnectionOptions): void {
  if (opts.caFingerprint == null) return
  if (typeof opts.agent === 'function') {
    throw new ConfigurationError('caFingerprint cannot be combined with a custom agent')
  }
  if (opts.tls?.rejectUnauthorized === false) {
    throw new ConfigurationError('caFingerprint cannot be combined with rejectUnauthorized: false')
  }
  if (opts.tls?.ca != null) {
    throw new ConfigurationError('caFingerprint cannot be combined with tls.ca')
  }
}

function fingerprintMatches (expected: string, actual: string): boolean {
  return expected.toLowerCase().replace(/:/g, '') === actual.toLowerCase().replace(/:/g, '')
}

// probe only, no HTTP is written so credentials stay off this socket
export async function fetchPinnedCaPem (url: URL, fingerprint: string, timeout: number | null): Promise<string> {
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const port = url.port !== '' ? Number(url.port) : 443
  let pems: string[]
  try {
    pems = await readPeerPems(host, port, timeout)
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

async function readPeerPems (host: string, port: number, timeout: number | null): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    let settled = false
    const socket = tls.connect({
      host,
      port,
      servername: net.isIP(host) === 0 ? host : undefined,
      rejectUnauthorized: false
    })
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
