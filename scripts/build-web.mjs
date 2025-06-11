import buffer from 'node:buffer'
import * as esbuild from 'esbuild'
import pkg from '../package.json' with { type: 'json' }
import { rimraf } from 'rimraf'

await rimraf('./web')

await esbuild.build({
  entryPoints: ['src/Transport.ts'],
  bundle: true,
  sourcemap: true,
  treeShaking: true,
  platform: 'neutral',
  outfile: 'web/index.js',
  supported: {
    destructuring: true
  },
  target: [
    'chrome58',
    'firefox57',
    'safari11',
    'edge16'
  ],
  mainFields: ['module', 'main'],
  external: [
    '@opentelemetry/api',
    './src/connection/HttpConnection.ts',
    './src/connection/UndiciConnection.ts',
    'tty',
    'os',
    'util',
  ],
  define: {
    'process.env.TRANSPORT_VERSION': JSON.stringify(pkg.version),
    'process.env.JS_PLATFORM': JSON.stringify("browser"),
    'buffer.constants.MAX_STRING_LENGTH': JSON.stringify(buffer.constants.MAX_STRING_LENGTH),
    'buffer.constants.MAX_LENGTH': JSON.stringify(buffer.constants.MAX_LENGTH)
  },
  alias: {
    'node:buffer': './scripts/web-shims/buffer',
    'node:events': './scripts/web-shims/events',
    'node:os': './scripts/web-shims/os',
    'node:querystring': './scripts/web-shims/querystring',
    'node:timers/promises': './scripts/web-shims/timers',
    'node:util': './scripts/web-shims/util',
    'node:zlib': './scripts/web-shims/zlib',
  },
})
