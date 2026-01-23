/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import Debug from 'debug'

/**
 * Lazy-initialized debug logger for elasticsearch transport.
 *
 * This module provides a wrapper around the 'debug' package that defers
 * initialization until first use. This is necessary for ESM compatibility
 * on Windows, where calling Debug() at module-level can cause initialization
 * failures during import, preventing tests from being registered.
 *
 * Instead of:
 *   const debug = Debug('elasticsearch')
 *   debug('message')
 *
 * Use:
 *   import { debug } from './debug'
 *   debug('message')
 */

let debugInstance: debug.Debugger | undefined

export function debug (formatter: any, ...args: any[]): void {
  if (debugInstance === undefined) {
    debugInstance = Debug('elasticsearch')
  }
  debugInstance(formatter, ...args)
}
