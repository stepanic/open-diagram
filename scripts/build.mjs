// Builds the files that are committed, so the site needs no build step on GitHub Pages:
//   vendor/  the third-party libraries, so index.html runs from file:// with no network
//   dist/    open-diagram-embed.js, the <open-diagram> element in one script (dbml-core and the
//            renderer, no editor), and elk.js, which it loads only for the layered layouts
// Run after changing anything in src/ that the embed uses, or after upgrading a library.
import { build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EMBED_SOURCES, sourcesHash } from './embed-sources.mjs';

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

const common = { bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2020', plugins: [stubSqlParsers], metafile: true, logLevel: 'info' };

const vendor = await build({
  ...common,
  stdin: { contents: "export { Parser, ModelExporter } from '@dbml/core';", resolveDir: process.cwd() },
  globalName: 'dbmlCore',
  outfile: 'vendor/dbml-core.js',
});
copyFileSync('node_modules/elkjs/lib/elk.bundled.js', 'vendor/elk.bundled.js');

// The embed bundle: dbml-core as window.dbmlCore, then the renderer's scripts in page order.
// Imports run before the module body, so the global and the ELK URL are set in modules of their own.
const entry = {
  name: 'embed-entry',
  setup(b) {
    b.onResolve({ filter: /^od:/ }, (args) => ({ path: args.path, namespace: 'od' }));
    b.onLoad({ filter: /.*/, namespace: 'od' }, (args) => ({
      resolveDir: process.cwd(),
      loader: 'js',
      contents: {
        'od:dbml': "import { Parser, ModelExporter } from '@dbml/core';\nwindow.dbmlCore = window.dbmlCore || { Parser, ModelExporter };",
        // ELK comes from elk.js next to this bundle unless the page sets OD.elkUrl first.
        'od:elk': "const OD = (window.OD = window.OD || {});\nconst me = document.currentScript && document.currentScript.src;\nif (!OD.elkUrl && me) OD.elkUrl = new URL('elk.js', me).href;",
      }[args.path],
    }));
  },
};
const hash = sourcesHash();
mkdirSync('dist', { recursive: true });
const embed = await build({
  ...common,
  plugins: [stubSqlParsers, entry],
  stdin: { contents: ['od:dbml', 'od:elk', ...EMBED_SOURCES.map((f) => `./${f}`)].map((m) => `import '${m}';`).join('\n'), resolveDir: process.cwd() },
  outfile: 'dist/open-diagram-embed.js',
  legalComments: 'none',
  banner: {
    js: `/*! Open Diagram embed: <open-diagram> read-only DBML diagrams. MIT, https://github.com/stepanic/open-diagram
 * Bundles @dbml/core (Apache-2.0) and its dependencies; ELK (EPL-2.0) is loaded from elk.js on demand.
 * Licence texts: LICENSES.txt next to this file. Sources: ${hash} */`,
  },
});
copyFileSync('node_modules/elkjs/lib/elk.bundled.js', 'dist/elk.js');

// Licence texts of every package in the output (Apache-2.0 asks for them).
function packageRoot(file) {
  const parts = file.split('/');
  const i = parts.lastIndexOf('node_modules');
  return parts.slice(0, i + (parts[i + 1].startsWith('@') ? 3 : 2)).join('/');
}
function licences(metafile, elkFile, otherFile) {
  const roots = new Set(Object.keys(metafile.inputs).filter((f) => f.includes('node_modules/')).map(packageRoot));
  roots.add('node_modules/elkjs');
  return [...roots]
    .map((dir) => {
      let root = dir;
      // @dbml/core ships pre-bundled copies of some dependencies without a package.json;
      // their licence comes from the top-level package of the same name.
      const name = root.split('node_modules/').pop();
      const nested = !existsSync(path.join(root, 'package.json'));
      if (nested) root = path.join('node_modules', name);
      const pkg = existsSync(path.join(root, 'package.json')) ? JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) : { name };
      const file = existsSync(root) && readdirSync(root).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
      const text = file ? readFileSync(path.join(root, file), 'utf8').trim() : null;
      return { name: nested ? `${name} (inside @dbml/core)` : pkg.name, version: pkg.version || '?', license: pkg.license || '?', text, out: pkg.name === 'elkjs' ? elkFile : otherFile };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
function licenceText(sections, intro) {
  const seen = new Map();
  let md = intro;
  md += '| Package | Version | Licence | In |\n| --- | --- | --- | --- |\n';
  for (const s of sections) md += `| ${s.name} | ${s.version} | ${s.license} | \`${s.out}\` |\n`;
  for (const s of sections) {
    md += `\n## ${s.name} ${s.version}\n\n`;
    if (!s.text) md += `Licence: ${s.license} (no licence file in the package).\n`;
    else if (seen.has(s.text)) md += `Same licence text as ${seen.get(s.text)}.\n`;
    else {
      seen.set(s.text, s.name);
      md += '```text\n' + s.text + '\n```\n';
    }
  }
  return md;
}
writeFileSync(
  'vendor/THIRD_PARTY_LICENSES.md',
  licenceText(licences(vendor.metafile, 'elk.bundled.js', 'dbml-core.js'), '# Third-party licences\n\nThe files in `vendor/` bundle the packages below. This file is generated by\n`npm run build`.\n\n'),
);
writeFileSync(
  'dist/LICENSES.txt',
  licenceText(
    licences(embed.metafile, 'elk.js', 'open-diagram-embed.js'),
    `# Licences\n\n\`open-diagram-embed.js\` is Open Diagram (MIT, below) bundled with the packages listed after it.\n\`elk.js\` is elkjs, unmodified. Generated by \`npm run build\`.\n\n## Open Diagram\n\n\`\`\`text\n${readFileSync('LICENSE', 'utf8').trim()}\n\`\`\`\n\n# Third-party packages\n\n`,
  ),
);
