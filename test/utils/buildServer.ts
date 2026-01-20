/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import https from 'https'
import http from 'http'
import Debug from 'debug'
import stoppable, { StoppableServer } from 'stoppable'

const debug = Debug('elasticsearch-test')

// allow self signed certificates for testing purposes
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const key = readFileSync(join(__dirname, '..', 'fixtures', 'https.key'), 'utf8')
const cert = readFileSync(join(__dirname, '..', 'fixtures', 'https.pem'), 'utf8')
const caFingerprint = readFileSync(join(__dirname, '..', 'fixtures', 'ca-fingerprint'), 'utf8').trim()

const secureOpts = {
  key,
  cert,
  servername: 'localhost'
}

export type ServerHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void
interface Options { secure?: boolean }
type Server = [{ key: string, cert: string, port: number, caFingerprint: string }, StoppableServer]

let id = 0
export default function buildServer (handler: ServerHandler, opts: Options = {}): Promise<Server> {
  const serverId = id++
  debug(`Booting server '${serverId}'`)

  const server = opts.secure
    ? stoppable(https.createServer(secureOpts))
    : stoppable(http.createServer())

  server.on('request', (req, res) => {
    res.setHeader('x-elastic-product', 'Elasticsearch')
    handler(req, res)
  })

  server.on('error', err => {
    console.log('http server error', err)
    process.exit(1)
  })

  return new Promise((resolve) => {
    server.listen(0, () => {
      // @ts-expect-error
      const port = server.address().port
      debug(`Server '${serverId}' booted on port ${port}`)
      resolve([Object.assign({}, secureOpts, { port, caFingerprint }), server])
    })
  })
}
