import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = Number(process.env.PORT) || 3000;
const ROOT = process.cwd();
const SAVE_DIR = path.join(ROOT, 'save');
const SAVE_FILE = path.join(SAVE_DIR, 'profile.json');

fs.mkdirSync(SAVE_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // Local disk save persistence endpoint
  if (pathname === '/api/local-save') {
    if (req.method === 'GET') {
      if (fs.existsSync(SAVE_FILE)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(SAVE_FILE, 'utf8'));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'No save file yet' }));
      }
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          JSON.parse(body); // validate JSON
          fs.writeFileSync(SAVE_FILE, body, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // Resolve static file
  let relPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.normalize(path.join(ROOT, relPath));

  // Prevent path traversal outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Fallback for 1x1 transparent PNG if an optional shiny portrait or front sprite is requested
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext) {
      filePath = path.join(ROOT, 'index.html');
    } else {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': ext === '.html' || filePath.endsWith('offline-api.js') ? 'no-cache' : 'public, max-age=86400'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`  PokéBonk Offline Server running at:`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Save file: ${SAVE_FILE}`);
  console.log(`  Press F9 in-game to open the Offline Toolbox!`);
  console.log(`==================================================\n`);
});
