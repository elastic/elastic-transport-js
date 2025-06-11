import BaseConnection, {
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream
} from './BaseConnection'

/**
 * A connection to an Elasticsearch node, managed by the `http` client in the standard library
 */
export default class FetchConnection extends BaseConnection {
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse>
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptionsAsStream): Promise<ConnectionRequestResponseAsStream>
  async request (params: ConnectionRequestParams, options: any): Promise<any> {
    const req = this.buildRequest(params)

    const reqOptions: RequestInit = Object.assign({}, {
      keepalive: true
    }, options.agent)

    const res = await fetch(req, reqOptions)
    const headers = {}
    // @ts-expect-error
    for (const [key, value] of res.headers.entries()) {
      // @ts-expect-error
      headers[key] = value
    }
    let body
    if (res.headers.get('content-type') === 'application/json') {
      body = await res.json()
    } else {
      body = await res.text()
    }
    return {
      headers,
      statusCode: parseInt(res.statusText, 10),
      body
    }
  }

  async close (): Promise<void> {
  }

  buildRequest (params: ConnectionRequestParams): Request {
    const { path, method, body, querystring, headers } = params

    const requestParams: RequestInit = {
      method,
      headers: new Headers(Object.assign({}, this.headers as Record<string, string>, headers as Record<string, string>))
    }

    // if (typeof body === 'string' || isStream(body)) {
    if (typeof body === 'string') {
      requestParams.body = body
    } else if (body instanceof Buffer) {
      requestParams.body = body.buffer as ArrayBuffer
    }

    const url = new URL(this.url)
    url.pathname = path

    if (querystring != null) {
      if (url.search !== '') {
        url.search = `${url.search}&${querystring}`
      } else {
        url.search = querystring
      }
    }

    return new Request(url, requestParams)
  }
}
