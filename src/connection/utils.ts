import { Readable as ReadableStream } from 'node:stream'

export function isStream (obj: any): obj is ReadableStream {
  return obj != null && typeof obj.pipe === 'function'
}
