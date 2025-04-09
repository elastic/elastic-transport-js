/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { stringify } from 'node:querystring'
import Debug from 'debug'
import sjson from 'secure-json-parse'
import { SerializationError, DeserializationError } from './errors'
import { kJsonOptions } from './symbols'

const debug = Debug('elasticsearch')

export interface SerializerOptions {
  enablePrototypePoisoningProtection?: boolean | 'proto' | 'constructor'
}

export default class Serializer {
  [kJsonOptions]: {
    protoAction: string
    constructorAction: string
  }

  constructor (opts: SerializerOptions = {}) {
    const enabled = opts.enablePrototypePoisoningProtection ?? false
    this[kJsonOptions] = {
      protoAction: enabled === true || enabled === 'proto' ? 'error' : 'ignore',
      constructorAction: enabled === true || enabled === 'constructor' ? 'error' : 'ignore'
    }
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
      // @ts-expect-error
      object = sjson.parse(json, this[kJsonOptions])
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
