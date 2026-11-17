//! A local server for the MPQ browser: the built page, plus the client's archives read by range.
//
// The page never sees a whole archive. Its worker asks for one byte range at a time through a
// synchronous request, and the server streams just that range off disk. Two endpoints do the work:
// `/api/archives` names what is mounted, `/api/archive/<name>` answers a range request.
//
//   DATA_DIR=/path/to/WoW/Data PORT=8088 node server.mjs
//
// The page can run somewhere else entirely (GitHub Pages, another machine): it mounts these
// archives from whatever URL it is given, so every answer carries CORS headers. A page served over
// HTTPS cannot read an HTTP server, which is what `tailscale serve` fixes by putting a real
// certificate in front of this one.
//
// `DATA_DIR` has no default: the archives are the listener's own client data, and a guessed path
// would only ever be right on one machine.

import { createReadStream, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const ROOT = resolve(import.meta.dirname, 'www', 'dist');
const dataArg = process.env.DATA_DIR;
if (!dataArg) {
  console.error(
    'Set DATA_DIR to the client data folder holding the .mpq archives, e.g.\n' +
      '  DATA_DIR=/path/to/WoW/Data PORT=8088 node server.mjs'
  );
  process.exit(1);
}
const DATA_DIR = resolve(dataArg.replace(/^~/, homedir()));
const PORT = Number(process.env.PORT || 8088);
const HOST = process.env.HOST || '0.0.0.0';
/// The path this app is published under, for a reverse proxy that keeps the prefix (`/mpq/`).
/// Requests under it are served as if they came from the root, so a page at `/mpq/` calls
/// `/mpq/api/archives` and the same build still works at `/`.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
/// Which origins may read the archives: `*` by default, so a page on GitHub Pages can point here.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

/** The CORS headers every answer carries, including the preflight a `Range` request needs. */
const CORS = {
  'access-control-allow-origin': ALLOW_ORIGIN,
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Range, Content-Type',
  'access-control-expose-headers': 'Content-Range, Content-Length, Accept-Ranges',
  'access-control-max-age': '86400',
  // Chrome's Private Network Access gate: a page on a public origin (GitHub Pages) reading a
  // tailnet or LAN address asks this in the preflight, and refuses to send the request without it.
  'access-control-allow-private-network': 'true',
  vary: 'Origin',
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/** The archives in the data folder, by case-insensitive name. */
let archives = new Map();

async function scanArchives() {
  const names = (await readdir(DATA_DIR)).filter((n) => n.toLowerCase().endsWith('.mpq')).sort();
  const found = new Map();
  for (const name of names) {
    const info = await stat(join(DATA_DIR, name));
    if (!info.isFile()) continue;
    found.set(name.toLowerCase(), { name, size: info.size });
  }
  archives = found;
  return [...found.values()];
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** The requested byte range: `?offset=&length=` or a `Range:` header. */
function askedRange(req, url, size) {
  const range = req.headers.range;
  if (typeof range === 'string') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const start = m[1] === '' ? 0 : Number(m[1]);
      const end = m[2] === '' ? size - 1 : Number(m[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
        return { start, end: Math.min(end, size - 1) };
      }
    }
  }
  const start = Number(url.searchParams.get('offset') ?? 0);
  const length = Number(url.searchParams.get('length') ?? size - start);
  if (!Number.isFinite(start) || !Number.isFinite(length) || start < 0 || length < 0) {
    return null;
  }
  return { start, end: Math.min(start + length, size) - 1 };
}

function serveArchive(req, res, url) {
  // `/api/archive/model.MPQ`: a bare name, never a path.
  const name = decodeURIComponent(url.pathname.slice('/api/archive/'.length));
  const hit = archives.get(name.toLowerCase());
  if (!hit || name.includes('/') || name.includes('\\')) {
    json(res, 404, { error: `no archive ${name}` });
    return;
  }
  const range = askedRange(req, url, hit.size);
  if (!range || range.end < range.start) {
    json(res, 416, { error: `bad range for ${hit.name}` });
    return;
  }
  const length = range.end - range.start + 1;
  res.writeHead(206, {
    ...CORS,
    'content-type': 'application/octet-stream',
    'content-length': length,
    'content-range': `bytes ${range.start}-${range.end}/${hit.size}`,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  });
  createReadStream(join(DATA_DIR, hit.name), { start: range.start, end: range.end }).pipe(res);
}

function serveStatic(res, pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = resolve(join(ROOT, relative || 'index.html'));
  if (!file.startsWith(ROOT + sep) && file !== ROOT) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let type = CONTENT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
  } catch {
    // A page route falls back to index.html so the app owns the URL.
    file = join(ROOT, 'index.html');
  }
  try {
    const info = statSync(file);
    res.writeHead(200, {
      ...CORS,
      'content-type': type,
      'content-length': info.size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { ...CORS, 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (BASE_PATH && (url.pathname === BASE_PATH || url.pathname.startsWith(`${BASE_PATH}/`))) {
    url.pathname = url.pathname.slice(BASE_PATH.length) || '/';
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { error: 'GET only' });
    return;
  }
  if (url.pathname === '/api/archives') {
    scanArchives()
      .then((list) => json(res, 200, { dataDir: DATA_DIR, archives: list }))
      .catch((e) => json(res, 500, { error: String(e) }));
    return;
  }
  if (url.pathname.startsWith('/api/archive/')) {
    serveArchive(req, res, url);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    json(res, 404, { error: 'no such endpoint' });
    return;
  }
  serveStatic(res, url.pathname);
});

await scanArchives();
server.listen(PORT, HOST, () => {
  console.log(`MPQ browser on http://${HOST}:${PORT}/`);
  console.log(`Data: ${DATA_DIR} (${archives.size} archives)`);
  console.log(`Archive API for another page: http://<this machine>:${PORT}/api/archives`);
  console.log(
    'Over HTTPS (needed by an HTTPS page), publish it with a real certificate:\n' +
      `  tailscale serve --bg ${PORT}`
  );
});
