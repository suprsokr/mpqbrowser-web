#!/usr/bin/env node
// Share the archives with a page running anywhere: start `server.mjs`, then publish it over HTTPS
// on the tailnet with a certificate browsers accept, and print the addresses to use.
//
//   DATA_DIR=/path/to/WoW/Data npm run share
//
// The published URL serves the page and its archive API from one origin, so nothing asks for a
// local-network permission. The GitHub Pages build can point at the same URL from its server field,
// which Chrome gates behind "allow access to devices on your local network".
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const DATA_DIR = process.env.DATA_DIR;
const PORT = Number(process.env.PORT || 8088);
/// The HTTPS port the app is published on: its own port keeps the app at the root, where the
/// build's absolute asset URLs resolve. 443 is often already serving something else.
const SHARE_PORT = Number(process.env.SHARE_PORT || 8444);

if (!DATA_DIR) {
  console.error('Set DATA_DIR to the client data folder holding the .mpq archives, e.g.\n  DATA_DIR=/path/to/WoW/Data npm run share');
  process.exit(1);
}
if (!existsSync(DATA_DIR)) {
  console.error(`DATA_DIR does not exist: ${DATA_DIR}`);
  process.exit(1);
}

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
  env: { ...process.env, DATA_DIR, PORT: String(PORT) },
});

process.on('SIGINT', () => {
  server.kill('SIGINT');
  process.exit(0);
});

/** Whether `tailscale` is here and up, and this node's DNS name if so. */
function tailscaleName() {
  try {
    const self = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8' }));
    if (self?.BackendState !== 'Running') {
      return null;
    }
    return (self.Self?.DNSName ?? '').replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

// The server scans its archives on the way up; wait for it to answer before publishing.
async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/archives`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

const ready = await waitForServer();
if (!ready) {
  console.error(`server.mjs did not answer on port ${PORT}`);
  server.kill('SIGINT');
  process.exit(1);
}

const name = tailscaleName();
if (!name) {
  console.log(`\nNo tailnet to publish on. On this network, connect the page to:\n  http://<this machine>:${PORT}/\n`);
  process.exit(0);
}

try {
  execFileSync(
    'tailscale',
    ['serve', '--bg', '--yes', `--https=${SHARE_PORT}`, String(PORT)],
    { stdio: 'inherit' }
  );
} catch (e) {
  console.error(`tailscale serve failed: ${String(e)}`);
  console.log(`\nThe archives are still on http://<this machine>:${PORT}/ for an http:// page.\n`);
  process.exit(0);
}

const shared = `https://${name}:${SHARE_PORT}/`;
console.log(
  `\nOpen this, which serves the page and its archives from one origin:\n  ${shared}\n\n` +
    `Or paste it into the GitHub Pages build's server field (Chrome asks to allow local network\n` +
    `access the first time):\n  ${shared}\n\n` +
    `On this machine: http://localhost:${PORT}/\n` +
    `To stop publishing: tailscale serve --https=${SHARE_PORT} off\n`
);
