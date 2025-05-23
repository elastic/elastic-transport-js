/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Debug from 'debug'
import * as http from 'http'
import buildServer, { ServerHandler } from './buildServer'
import { StoppableServer } from 'stoppable'

interface BuildClusterOptions {
  numberOfNodes?: number
  handler?: ServerHandler
  hostPublishAddress?: boolean
}

interface Node {
  url: string
  server: StoppableServer
}

interface Cluster {
  nodes: Record<string, Node>,
  shutdown(): Promise<void>,
  kill(id: string): Promise<void>,
  spawn(id: string): Promise<void>
}

interface SniffNode {
  http: {
    publish_address: string
  },
  roles: string[]
}

type SniffResult = Record<string, SniffNode>

const debug = Debug('elasticsearch-test')
let id = 0
export default async function buildCluster (options: BuildClusterOptions): Promise<Cluster> {
  const clusterId = id++
  debug(`Booting cluster '${clusterId}'`)

  const cluster: Cluster = {
    nodes: {},
    shutdown,
    kill,
    spawn
  }

  options.numberOfNodes = options.numberOfNodes || 4
  for (let i = 0; i < options.numberOfNodes; i++) {
    await bootNode(`node${i}`)
  }

  async function bootNode (id: string): Promise<void> {
    const [{ port }, server] = await buildServer(options.handler ?? handler)
    cluster.nodes[id] = {
      url: `http://127.0.0.1:${port}`,
      server
    }
  }

  function handler (req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/_nodes/_all/http') {
      const sniffResult: SniffResult = Object.keys(cluster.nodes).reduce((acc: SniffResult, val: string) => {
        const node = cluster.nodes[val]
        acc[val] = {
          http: {
            publish_address: options.hostPublishAddress
              ? `localhost/${node.url}`
              : node.url
          },
          roles: ['master', 'data', 'ingest']
        }
        return acc
      }, {})
      res.end(JSON.stringify(sniffResult))
    } else {
      res.end(JSON.stringify({ hello: 'world' }))
    }
  }

  async function shutdown (): Promise<void> {
    debug(`Shutting down cluster '${clusterId}'`)
    for (const id in cluster.nodes) {
      await kill(id)
    }
  }

  async function kill (id: string): Promise<void> {
    debug(`Shutting down cluster node '${id}' (cluster id: '${clusterId}')`)
    const node = cluster.nodes[id]
    delete cluster.nodes[id]
    node.server.stop()
  }

  async function spawn (id: string): Promise<void> {
    debug(`Spawning cluster node '${id}' (cluster id: '${clusterId}')`)
    await bootNode(id)
  }

  return cluster
}
