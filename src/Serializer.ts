/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { stringify } from 'node:querystring'
import Debug from 'debug'
import sjson from 'secure-json-parse'
import { SerializationError, DeserializationError } from './errors.js'
import { kJsonOptions } from './symbols.js'

const debug = Debug('elasticsearch')

/** Number of bytes per IEEE-754 float32 value */
const FLOAT32_BYTES = 4

export interface SerializerOptions {
  enablePrototypePoisoningProtection?: boolean | 'proto' | 'constructor'
}

export default class Serializer {
  [kJsonOptions]: {
    protoAction: 'error' | 'ignore'
    constructorAction: 'error' | 'ignore'
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
    try {
      return JSON.stringify(object)
    } catch (err: any) {
      throw new SerializationError(err.message, object)
    }
  }

  /**
   * Given a string, attempts to parse it from raw JSON into an object
   */
  deserialize<T = unknown> (json: string): T {
    debug('Deserializing', json)
    try {
      return sjson.parse(json, this[kJsonOptions])
    } catch (err: any) {
      throw new DeserializationError(err.message, json)
    }
  }

  /**
   * Serializes an array of records into a ndjson string
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
      // elasticsearch will complain about keys without a value
      if (object[key] === undefined) {
        delete object[key] // eslint-disable-line
      } else if (Array.isArray(object[key])) {
        object[key] = object[key].join(',')
      }
    }
    return stringify(object)
  }

  /**
   * Encodes an array of float32 values to a base64 string
   */
  encodeFloat32Vector (floats: number[]): string {
    debug('encodeFloat32Vector', floats)
    if (!Array.isArray(floats)) {
      throw new SerializationError('The argument provided is not an array', floats)
    }
    const buffer = Buffer.allocUnsafe(floats.length * FLOAT32_BYTES)
    for (let i = 0; i < floats.length; i++) {
      buffer.writeFloatBE(floats[i], i * FLOAT32_BYTES)
    }
    return buffer.toString('base64')
  }

  /**
   * Decodes a base64 string back to an array of float32
   */
  decodeFloat32Vector (base64: string): number[] {
    debug('decodeFloat32Vector', base64)
    if (typeof base64 !== 'string') {
      throw new DeserializationError('The argument provided is not a string', base64)
    }
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length % FLOAT32_BYTES !== 0) {
      throw new DeserializationError(
        `Invalid base64 vector: byte length ${buffer.length} is not a multiple of ${FLOAT32_BYTES}`,
        base64
      )
    }
    const floats: number[] = new Array(buffer.length / FLOAT32_BYTES)
    for (let i = 0; i < floats.length; i++) {
      floats[i] = buffer.readFloatBE(i * FLOAT32_BYTES)
    }
    return floats
  }
}
