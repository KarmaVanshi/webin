/** Minimal static server for the fixture pages. No dependencies. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const port = Number(process.env.PORT ?? 8123);
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  // SPA routes have no file of their own; serve the fixture that owns them.
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.startsWith('/spa/')) path = '/spa.html';
  // The component fixture navigates with pushState; a reload must still find it.
  if (path === '/a' || path === '/b') path = '/components.html';
  if (path === '/') path = '/index.html';

  const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => console.log(`Fixtures on http://localhost:${port}`));
