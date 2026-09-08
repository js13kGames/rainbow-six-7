// preview.js — serve the built single-file artifact from dist/.
//
// Verifies the production build opens over http exactly as it would from the
// file system (it is fully self-contained, so any path returns the one file).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 4173;
const FILE = join(ROOT, 'dist/index.html');

const server = createServer(async (_req, res) => {
  try {
    const body = await readFile(FILE);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('dist/index.html not found — run `npm run build` first.');
  }
});

server.listen(PORT, () => {
  console.log(`RAINBOX SIX 7 preview: http://localhost:${PORT}`);
});
