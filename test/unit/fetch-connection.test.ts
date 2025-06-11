import http from 'node:http'
import { test } from 'tap'
import { buildServer } from '../utils'
import { FetchConnection } from '../../'

const options = {
  requestId: 42,
  name: 'test',
  context: null
}

test('Basic (http)', async t => {
  t.plan(3)

  function handler(req: http.IncomingMessage, res: http.ServerResponse) {
    t.match(req.headers, {
      'x-custom-test': /true/,
      connection: /keep-alive/
    })
    res.end('ok')
  }

  const [{ port }, server] = await buildServer(handler)
  const connection = new FetchConnection({
    url: new URL(`http://localhost:${port}`)
  })

  const res = await connection.request({
    path: '/hello',
    method: 'GET',
    headers: {
      'X-Custom-Test': 'true'
    }
  }, options)
  t.match(res.headers, { connection: /keep-alive/ })
  t.equal(res.body, 'ok')
  server.stop()
})
