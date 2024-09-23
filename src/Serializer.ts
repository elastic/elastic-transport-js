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

import { stringify } from 'node:querystring'
import Debug from 'debug'
import sjson from 'secure-json-parse'
import { SerializationError, DeserializationError } from './errors'

const debug = Debug('elasticsearch')

export interface SerializerOptions {
  enablePrototypePoisoningProtection?: boolean
}

export default class Serializer {
  safeParseEnabled: boolean

  constructor (opts: SerializerOptions = {}) {
    this.safeParseEnabled = opts.enablePrototypePoisoningProtection || false
  }

  /**
   * Serializes a record into a JSON string
   */
  serialize (object: Record<string, any>): string {
    debug('Serializing', object)
    let json
    try {
      json = JSON.stringify(object)
    } catch (err: any) {
      throw new SerializationError(err.message, object)
    }
    return json
  }

  /**
   * Given a string, attempts to parse it from raw JSON into an object
   */
  deserialize<T = unknown> (json: string): T {
    debug('Deserializing', json)
    let object
    try {
      if(this.safeParseEnabled) {
        object = sjson.parse(json, {
          protoAction: 'error',
          constructorAction: 'error'
        })
      } else {
        object = JSON.parse(json)
      }

    } catch (err: any) {
      throw new DeserializationError(err.message, json)
    }
    return object
  }

  /**
   * Serializes an array of records into an ndjson string
   */
  ndserialize (array: Array<Record<string, any> | string>): string {
    debug('ndserialize', array)
    if (!Array.isArray(array)) {
      throw new SerializationError('The argument provided is not an array', array)
    }
    let ndjson = ''
    for (let i = 0, len = array.length; i < len; i++) {
      if (typeof array[i] === 'string') {
        ndjson += array[i] + '\n' // eslint-disable-line
      } else {
        // @ts-expect-error
        ndjson += this.serialize(array[i]) + '\n' // eslint-disable-line
      }
    }
    return ndjson
  }

  qserialize (object?: Record<string, any> | string): string {
    debug('qserialize', object)
    if (object == null) return ''
    if (typeof object === 'string') return object
    // arrays should be serialized as comma separated list
    const keys = Object.keys(object)
    for (let i = 0, len = keys.length; i < len; i++) {
      const key = keys[i]
      // elasticsearch will complain for keys without a value
      if (object[key] === undefined) {
        delete object[key] // eslint-disable-line
      } else if (Array.isArray(object[key])) {
        object[key] = object[key].join(',')
      }
    }
    return stringify(object)
  }
}
