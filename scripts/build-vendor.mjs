// Bundles the third-party libraries into vendor/ so index.html runs from file:// with no network.
import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';
import path from 'node:path';

// @dbml/core statically imports its SQL importers (ANTLR, ~34 MB). Only DBML is parsed here,
// so they are replaced by stubs that throw if ever called.
const stubSqlParsers = {
  name: 'stub-sql-parsers',
  setup(b) {
    b.onResolve({ filter: /(ANTLR\/ASTGeneration\/index|deprecated\/\w+Parser)\.mjs$/ }, (args) => ({
      path: path.basename(args.path, '.mjs'),
      namespace: 'stub',
    }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
      const fail = `() => { throw new Error('${args.path}: SQL import is not bundled'); }`;
      return {
        contents: args.path === 'index' ? `export const parse = ${fail};` : `export const require_${args.path} = () => ({ parse: ${fail}, parseWithPegError: ${fail} });`,
        loader: 'js',
      };
    });
  },
};

await build({
  stdin: { contents: "export { Parser } from '@dbml/core';", resolveDir: process.cwd() },
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'dbmlCore',
  platform: 'browser',
  target: 'es2020',
  outfile: 'vendor/dbml-core.js',
  plugins: [stubSqlParsers],
  logLevel: 'info',
});
copyFileSync('node_modules/elkjs/lib/elk.bundled.js', 'vendor/elk.bundled.js');
