// Tiny static server for the app: http://localhost:5173
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('../www', import.meta.url));
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };
createServer(async (req, res) => {
  const rawPath = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[\/\\])+/, '');
  const isRoot = !rawPath || rawPath === '/' || rawPath === '\\' || rawPath === '.';
  const file = join(root, isRoot ? 'index.html' : rawPath);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(body);
  }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`MediLink app on http://localhost:${port}  (API expected at http://localhost:4000/api)`));
