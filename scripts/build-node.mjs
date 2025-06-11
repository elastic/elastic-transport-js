import * as esbuild from 'esbuild'
import pkg from '../package.json' with { type: 'json' }
import { rimraf } from 'rimraf'

await rimraf('./lib-test')

await esbuild.build({
  entryPoints: ['src/**/*.ts'],
  sourcemap: true,
  treeShaking: true,
  platform: 'node',
  format: 'cjs',
  outdir: './lib-test',
  define: {
    'process.env.TRANSPORT_VERSION': JSON.stringify(pkg.version),
    'process.env.JS_PLATFORM': JSON.stringify("node")
  }
})
