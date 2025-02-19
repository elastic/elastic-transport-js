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

/* eslint-disable @typescript-eslint/restrict-template-expressions */

import hpagent from 'hpagent'
import assert from 'node:assert'
import http from 'node:http'
import https from 'node:https'
import Debug from 'debug'
import buffer from 'node:buffer'
import { TLSSocket } from 'node:tls'
import BaseConnection, {
  ConnectionOptions,
  ConnectionRequestParams,
  ConnectionRequestOptions,
  ConnectionRequestOptionsAsStream,
  ConnectionRequestResponse,
  ConnectionRequestResponseAsStream,
  getIssuerCertificate,
  isCaFingerprintMatch,
  isBinary
} from './BaseConnection'
import { kCaFingerprint } from '../symbols'
import { Readable as ReadableStream, pipeline } from 'node:stream'
import {
  ConfigurationError,
  ConnectionError,
  RequestAbortedError,
  TimeoutError
} from '../errors'
import { setTimeout } from 'node:timers/promises'
import { HttpAgentOptions } from '../types'

const debug = Debug('elasticsearch')
const debugSM = Debug('elasticsearch:http-state-machine')
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/
const MAX_BUFFER_LENGTH = buffer.constants.MAX_LENGTH
const MAX_STRING_LENGTH = buffer.constants.MAX_STRING_LENGTH
const noop = (): void => {}

enum states {
  PREFLIGHT = 'preflight',
  INVALID = 'invalid',
  REQUEST_START = 'request_start',
  REQUEST_CLOSE = 'request_close',
  ERROR = 'error',
  TIMEOUT = 'timeout',
  RESPONSE_START = 'response_start',
  RESPONSE_BODY = 'response_body',
  RESPONSE_CLOSE = 'response_close',
  SUCCESS = 'success'
}

type StateTransitions = Record<states, states[] | null>

interface StateActionOptions {
  error?: string | Error
  request?: http.ClientRequest
  response?: http.ServerResponse | http.IncomingMessage
  connectionRequestResponse?: ConnectionRequestResponse | ConnectionRequestResponseAsStream
}

interface ActionTransition {
  state: states
  options?: StateActionOptions
}
type StateActionFull = (options: StateActionOptions) => ActionTransition
type StateActionNoReturn = (options: StateActionOptions) => void
type StateActionEmpty = () => void
type StateActionNoOptions = () => ActionTransition
type StateAction = StateActionFull | StateActionNoReturn | StateActionEmpty | StateActionNoOptions
type StateActions = Record<states, StateAction>

class StateMachineError extends Error {
  history?: states[]
}

class StateMachine {
  _current: states
  transitions: StateTransitions
  actions: StateActions | undefined
  history: states[]
  request: http.ClientRequest | undefined
  response: http.ServerResponse | http.IncomingMessage | undefined

  constructor (initialState: states, transitions: StateTransitions, actions?: StateActions) {
    this._current = initialState
    this.transitions = transitions
    this.actions = actions
    this.history = [this.currentState]

    const action = this.actions != null ? this.actions[this.currentState] : null
    if (action != null) action({})
  }

  get currentState (): states {
    return this._current
  }

  private set currentState (val: states) {
    this._current = val
  }

  /**
   * Returns true if the current state is an end state
   */
  get isTerminated (): boolean {
    const { currentState, transitions } = this
    const stateTransitions = transitions[currentState]
    return (stateTransitions == null)
  }

  transition (state: states, options?: StateActionOptions): void {
    const { currentState, transitions } = this

    const stateTransitions = transitions[currentState]
    if (stateTransitions?.includes(state) === true) {
      const action = this.actions != null ? this.actions[state] : null
      let nextTransition: ActionTransition | null = null
      if (action != null && action !== noop) {
        // action runs before the transition in case it throws an assertion error
        debugSM(`Running state machine action for ${state}`, options ?? {})
        nextTransition = action(options ?? {}) ?? null
      }

      // do state transition
      debugSM(`Transitioning state machine from ${this.currentState} to ${state}`)
      this.history.push(state)
      this.currentState = state

      // if action returned a transition, run that
      if (nextTransition !== null) {
        const { state, options } = nextTransition
        this.transition(state, options)
      }
    } else {
      const err = new StateMachineError(`ERROR: Invalid transition event ${state} from ${currentState}`)
      err.history = this.history
      throw err
    }
  }
}

/**
 * A connection to an Elasticsearch node, managed by the `http` client in the standard library
 */
export default class HttpConnection extends BaseConnection {
  agent?: http.Agent | https.Agent | hpagent.HttpProxyAgent | hpagent.HttpsProxyAgent
  makeRequest: typeof http.request | typeof https.request

  constructor (opts: ConnectionOptions) {
    super(opts)

    if (typeof opts.agent === 'function') {
      this.agent = opts.agent(opts)
    } else if (typeof opts.agent === 'boolean') {
      this.agent = undefined
    } else {
      if (opts.agent != null && !isHttpAgentOptions(opts.agent)) {
        throw new ConfigurationError('Bad agent configuration for Http agent')
      }
      const agentOptions = Object.assign({}, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 256,
        maxFreeSockets: 256,
        scheduling: 'lifo'
      }, opts.agent)
      if (opts.proxy != null) {
        const proxyAgentOptions = {
          ...agentOptions,
          proxy: opts.proxy
        }
        this.agent = this.url.protocol === 'http:'
          ? new hpagent.HttpProxyAgent(proxyAgentOptions)
          : new hpagent.HttpsProxyAgent(Object.assign({}, proxyAgentOptions, this.tls))
      } else {
        this.agent = this.url.protocol === 'http:'
          ? new http.Agent(agentOptions)
          : new https.Agent(Object.assign({}, agentOptions, this.tls))
      }
    }

    this.makeRequest = this.url.protocol === 'http:'
      ? http.request
      : https.request
  }

  async request (params: ConnectionRequestParams, options: ConnectionRequestOptions): Promise<ConnectionRequestResponse>
  async request (params: ConnectionRequestParams, options: ConnectionRequestOptionsAsStream): Promise<ConnectionRequestResponseAsStream>
  async request (params: ConnectionRequestParams, options: any): Promise<any> {
    let cleanResponseListeners: (all?: boolean) => void = noop

    return await new Promise((resolve, reject) => {
      // the order of events codified here is primarily informed by the order HTTP request/response objects' events are triggered,
      // according to the Node.js docs at https://nodejs.org/api/http.html#http_http_request_url_options_callback
      const requestStates: StateTransitions = {
        // PREFLIGHT: validation checks before request is sent
        [states.PREFLIGHT]: [states.INVALID, states.REQUEST_START],
        // INVALID: end state for requests that fail during preflight validation
        [states.INVALID]: null,
        // ERROR: end state for requests that fail after being sent
        [states.ERROR]: null,
        // TIMEOUT: end state for requests that timed out
        [states.TIMEOUT]: null,
        // REQUEST_START: request has been sent
        [states.REQUEST_START]: [states.REQUEST_CLOSE, states.RESPONSE_START, states.ERROR, states.TIMEOUT],
        // REQUEST_CLOSE: 'close' event on request object has fired
        [states.REQUEST_CLOSE]: [states.ERROR, states.RESPONSE_CLOSE, states.RESPONSE_BODY],
        // RESPONSE_START: 'response' event on request object has fired
        [states.RESPONSE_START]: [states.REQUEST_CLOSE, states.RESPONSE_CLOSE, states.ERROR, states.TIMEOUT, states.RESPONSE_BODY],
        // RESPONSE_CLOSE: 'close' event on response object has fired
        [states.RESPONSE_CLOSE]: [states.SUCCESS, states.ERROR],
        // RESPONSE_BODY means a response has been received but does NOT necessarily indicate a success
        // in some cases (e.g. 413 Content Too Large), a response will be sent, and then the server will close the connection, which is an error state
        [states.RESPONSE_BODY]: [states.REQUEST_CLOSE, states.RESPONSE_CLOSE, states.SUCCESS, states.ERROR],
        // SUCCESS: end state for a request that did not error and did receive a response
        [states.SUCCESS]: null
      }

      const requestActions: StateActions = {
        [states.PREFLIGHT]: noop,
        [states.REQUEST_START]: ({ request }) => {
          assert(request != null, 'No request provided during REQUEST_START transition')
          machine.request = request
          this._openRequests++
        },
        [states.REQUEST_CLOSE]: () => {
          if (!machine.history.includes(states.RESPONSE_START)) {
            cleanRequestListeners()
            this._openRequests--
          }
          machine.request?.removeListener('close', onRequestClose)
        },
        [states.RESPONSE_START]: ({ response }) => {
          assert(response != null, 'No response provided during RESPONSE_START transition')
          machine.response = response
          cleanRequestListeners()
          this._openRequests--
        },
        [states.RESPONSE_CLOSE]: noop,
        [states.INVALID]: ({ error }) => {
          assert(error != null, 'No error provided during INVALID transition')
          reject(error)
        },
        [states.TIMEOUT]: ({ error }) => {
          if (!machine.history.includes(states.RESPONSE_START)) {
            cleanRequestListeners()
            this._openRequests--
          }
          machine.request?.removeListener('close', onRequestClose)
          machine.request?.once('error', noop)
          cleanResponseListeners(true)
          machine.response?.once('error', noop)

          machine.request?.destroy()
          machine.response?.destroy()

          reject(error ?? new TimeoutError('Request timed out'))
        },
        [states.ERROR]: ({ error }) => {
          assert(error != null, 'No error received during ERROR transition')

          if (!machine.history.includes(states.RESPONSE_START)) {
            cleanRequestListeners()
            this._openRequests--
          }
          machine.request?.removeListener('close', onRequestClose)
          machine.request?.once('error', noop)
          cleanResponseListeners(true)
          machine.response?.once('error', noop)

          machine.request?.destroy()
          machine.response?.destroy()

          reject(error)
        },
        [states.RESPONSE_BODY]: ({ connectionRequestResponse }) => {
          assert(connectionRequestResponse != null, 'No connectionRequestResponse received during RESPONSE_BODY transition')

          resolve(connectionRequestResponse)
        },
        [states.SUCCESS]: noop
      }

      const machine = new StateMachine(states.PREFLIGHT, requestStates, requestActions)

      const maxResponseSize = options.maxResponseSize ?? MAX_STRING_LENGTH
      const maxCompressedResponseSize = options.maxCompressedResponseSize ?? MAX_BUFFER_LENGTH
      const requestParams = this.buildRequestObject(params, options)
      // https://github.com/nodejs/node/commit/b961d9fd83
      if (INVALID_PATH_REGEX.test(requestParams.path as string)) {
        return machine.transition(states.INVALID, { error: new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path as string}`) })
      }

      debug('Starting a new request', params)
      let request: http.ClientRequest
      try {
        request = this.makeRequest(requestParams)
      } catch (err: any) {
        return machine.transition(states.INVALID, err)
      }

      const abortListener = (): void => {
        machine.transition(states.ERROR, { error: new RequestAbortedError('Request aborted') })
      }

      machine.transition(states.REQUEST_START, { request })
      if (options.signal != null) {
        options.signal.addEventListener(
          'abort',
          abortListener,
          { once: true }
        )
      }

      const onResponse = (response: http.IncomingMessage): void => {
        machine.transition(states.RESPONSE_START, { response })

        if (options.asStream === true) {
          const connectionRequestResponse = {
            body: response,
            statusCode: response.statusCode as number,
            headers: response.headers
          }
          return machine.transition(states.RESPONSE_BODY, { connectionRequestResponse })
        }

        const contentEncoding = (response.headers['content-encoding'] ?? '').toLowerCase()
        const isCompressed = contentEncoding.includes('gzip') || contentEncoding.includes('deflate')
        const bodyIsBinary = isBinary(response.headers['content-type'] ?? '')

        /* istanbul ignore else */
        if (response.headers['content-length'] !== undefined) {
          // TODO: switch to response.strictContentLength https://nodejs.org/api/http.html#responsestrictcontentlength
          const contentLength = Number(response.headers['content-length'])
          if (isCompressed && contentLength > maxCompressedResponseSize) {
            return machine.transition(states.ERROR, { error: new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed buffer (${maxCompressedResponseSize})`) })
          } else if (contentLength > maxResponseSize) {
            return machine.transition(states.ERROR, { error: new RequestAbortedError(`The content length (${contentLength}) is bigger than the maximum allowed string (${maxResponseSize})`) })
          }
        }

        // if the response is compressed, we must handle it
        // as buffer for allowing decompression later
        let payload = isCompressed || bodyIsBinary ? new Array<Buffer>() : ''
        const onData = isCompressed || bodyIsBinary ? onDataAsBuffer : onDataAsString

        let currentLength = 0
        function onDataAsBuffer (chunk: Buffer): void {
          currentLength += Buffer.byteLength(chunk)
          // TODO: switch to response.strictContentLength https://nodejs.org/api/http.html#responsestrictcontentlength
          if (currentLength > maxCompressedResponseSize) {
            return machine.transition(states.ERROR, { error: new RequestAbortedError(`The content length (${currentLength}) is bigger than the maximum allowed buffer (${maxCompressedResponseSize})`) })
          } else {
            (payload as Buffer[]).push(chunk)
          }
        }

        function onDataAsString (chunk: string): void {
          currentLength += Buffer.byteLength(chunk)
          // TODO: switch to response.strictContentLength https://nodejs.org/api/http.html#responsestrictcontentlength
          if (currentLength > maxResponseSize) {
            return machine.transition(states.ERROR, { error: new RequestAbortedError(`The content length (${currentLength}) is bigger than the maximum allowed string (${maxResponseSize})`) })
          } else {
            payload = `${payload as string}${chunk}`
          }
        }

        const onResponseClose = (): void => {
          cleanResponseListeners(true)
          if (!machine.isTerminated) machine.transition(states.RESPONSE_CLOSE)
        }

        const onResponseError = (err: Error): void => {
          cleanResponseListeners()

          // @ts-expect-error
          if (err.message === 'aborted' && err.code === 'ECONNRESET') {
            return machine.transition(states.ERROR, { error: new ConnectionError('Response aborted while reading the body') })
          }

          if (err.name === 'RequestAbortedError') {
            return machine.transition(states.ERROR, { error: err })
          }

          return machine.transition(states.ERROR, { error: new ConnectionError(err.message) })
        }

        const onResponseEnd = (): void => {
          cleanResponseListeners()

          const connectionRequestResponse = {
            body: isCompressed || bodyIsBinary ? Buffer.concat(payload as Buffer[]) : payload as string,
            statusCode: response.statusCode as number,
            headers: response.headers
          }
          return machine.transition(states.RESPONSE_BODY, { connectionRequestResponse })
        }

        if (!isCompressed && !bodyIsBinary) {
          response.setEncoding('utf8')
        }

        cleanResponseListeners = (all?: boolean): void => {
          response.removeListener('data', onData)
          response.removeListener('error', onResponseError)
          response.removeListener('end', onResponseEnd)
          request.removeListener('error', noop)
          if (all === true) response.removeListener('close', onResponseClose)
        }

        this.diagnostic.emit('deserialization', null, options)
        response.on('data', onData)
        response.on('error', onResponseError)
        response.on('end', onResponseEnd)
        response.on('close', onResponseClose)
      }

      const onTimeout = (): void => {
        machine.transition(states.TIMEOUT, { request })
      }

      const onRequestError = (err: Error): void => {
        let message = err.message
        if (err.name === 'RequestAbortedError') {
          return machine.transition(states.ERROR, { error: err })
        }

        // @ts-expect-error
        if (err.code === 'ECONNRESET') {
          // @ts-expect-error
          if (err.errno === -104) {
            message = 'Request aborted while sending the body'
          } else {
            message += ` - Local: ${request.socket?.localAddress ?? 'undefined'}:${request.socket?.localPort ?? 'undefined'}, Remote: ${request.socket?.remoteAddress ?? 'undefined'}:${request.socket?.remotePort ?? 'undefined'}`
          }
        }

        return machine.transition(states.ERROR, { error: new ConnectionError(message) })
      }

      const onSocket = (socket: TLSSocket): void => {
        /* istanbul ignore else */
        if (!socket.isSessionReused()) {
          socket.once('secureConnect', () => {
            const issuerCertificate = getIssuerCertificate(socket)
            /* istanbul ignore next */
            if (issuerCertificate == null) {
              return machine.transition(states.ERROR, { error: new Error('Invalid or malformed certificate') })
            }

            // Check if fingerprint matches
            /* istanbul ignore else */
            if (!isCaFingerprintMatch(this[kCaFingerprint], issuerCertificate.fingerprint256)) {
              return machine.transition(states.ERROR, { error: new Error('Server certificate CA fingerprint does not match the value configured in caFingerprint') })
            }
          })
        }
      }

      // the only request listener not handled by cleanRequestListeners
      const onRequestClose = (): void => {
        machine.transition(states.REQUEST_CLOSE)
      }

      request.on('response', onResponse)
      request.on('timeout', onTimeout)
      request.on('error', onRequestError)
      request.on('close', onRequestClose)
      if (this[kCaFingerprint] != null && requestParams.protocol === 'https:') {
        request.on('socket', onSocket)
      }

      // Disables the Nagle algorithm
      request.setNoDelay(true)

      // starts the request
      if (isStream(params.body)) {
        params.body.once('error', (err: Error): void => {
          if (!machine.isTerminated) onRequestError(err)
        })

        pipeline(params.body, request, err => {
          if (err != null) {
            if (!machine.isTerminated) onRequestError(err)
          }
        })
      } else {
        request.end(params.body)
      }

      function cleanRequestListeners (): void {
        request.removeListener('response', onResponse)
        request.removeListener('timeout', onTimeout)
        request.removeListener('error', onRequestError)
        request.on('error', noop)
        request.removeListener('socket', onSocket)

        if (isStream(params.body)) {
          params.body.removeListener('error', onRequestError)
        }

        if (options.signal != null) {
          if ('removeEventListener' in options.signal) {
            options.signal.removeEventListener('abort', abortListener)
          } else {
            options.signal.removeListener('abort', abortListener)
          }
        }
      }
    })
  }

  async close (): Promise<void> {
    debug('Closing connection', this.id)
    while (this._openRequests > 0) {
      await setTimeout(1000)
    }
    /* istanbul ignore else */
    if (this.agent !== undefined) {
      this.agent.destroy()
    }
  }

  buildRequestObject (params: ConnectionRequestParams, options: ConnectionRequestOptions): http.ClientRequestArgs {
    const url = this.url
    let search = url.search
    let pathname = url.pathname
    const request: http.ClientRequestArgs = {
      protocol: url.protocol,
      hostname: url.hostname[0] === '['
        ? url.hostname.slice(1, -1)
        : url.hostname,
      path: '',
      // https://github.com/elastic/elasticsearch-js/issues/843
      port: url.port !== '' ? url.port : undefined,
      headers: this.headers,
      agent: this.agent,
      // only set a timeout if it has a value; default to no timeout
      // see https://www.elastic.co/guide/en/elasticsearch/reference/current/modules-network.html#_http_client_configuration
      timeout: options.timeout ?? this.timeout ?? undefined
    }

    const paramsKeys = Object.keys(params)
    for (let i = 0, len = paramsKeys.length; i < len; i++) {
      const key = paramsKeys[i]
      if (key === 'path') {
        pathname = resolve(pathname, params[key])
      } else if (key === 'querystring' && Boolean(params[key])) {
        if (search === '') {
          search = `?${params[key] as string}`
        } else {
          search += `&${params[key] as string}`
        }
      } else if (key === 'headers') {
        request.headers = Object.assign({}, request.headers, params.headers)
      } else {
        // @ts-expect-error
        request[key] = params[key]
      }
    }

    request.path = pathname + search

    return request
  }
}

function isStream (obj: any): obj is ReadableStream {
  return obj != null && typeof obj.pipe === 'function'
}

function resolve (host: string, path: string): string {
  const hostEndWithSlash = host[host.length - 1] === '/'
  const pathStartsWithSlash = path[0] === '/'

  if (hostEndWithSlash && pathStartsWithSlash) {
    return host + path.slice(1)
  } else if (hostEndWithSlash !== pathStartsWithSlash) {
    return host + path
  } else {
    return host + '/' + path
  }
}

/* istanbul ignore next */
function isHttpAgentOptions (opts: Record<string, any>): opts is HttpAgentOptions {
  if (opts.keepAliveTimeout != null) return false
  if (opts.keepAliveMaxTimeout != null) return false
  if (opts.keepAliveTimeoutThreshold != null) return false
  if (opts.pipelining != null) return false
  if (opts.maxHeaderSize != null) return false
  if (opts.connections != null) return false
  return true
}
