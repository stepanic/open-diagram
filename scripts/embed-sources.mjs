// The scripts dist/open-diagram-embed.js is built from, in page order, and a hash of them that the
// build writes into the bundle's banner, so the smoke test can tell a stale bundle.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export const EMBED_SOURCES = ['src/theme.js', 'src/model.js', 'src/geometry.js', 'src/layout.js', 'src/render.js', 'src/viewer.js', 'src/url.js', 'src/embed.js'];

export function sourcesHash() {
  const h = createHash('sha256');
  for (const f of [...EMBED_SOURCES, 'node_modules/@dbml/core/package.json']) h.update(readFileSync(path.join(root, f)));
  return h.digest('hex').slice(0, 16);
}
