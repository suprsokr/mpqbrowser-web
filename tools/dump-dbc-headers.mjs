#!/usr/bin/env node
// Dump every `.dbc` header in a client data folder, plus the table names benilla already has a
// schema for, as the input `tools/dbd-names.py` needs to decide which VanillaDBDefs column lists
// fit the files.
//
// Usage: node tools/dump-dbc-headers.mjs /path/to/WoW/Data /tmp/headers.json
import { openSync, readdirSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dataDir, outPath] = process.argv.slice(2);
if (!dataDir || !outPath) {
  console.error('usage: node tools/dump-dbc-headers.mjs <data dir> <out.json>');
  process.exit(1);
}

const archives = readdirSync(dataDir)
  .filter((name) => name.toLowerCase().endsWith('.mpq'))
  .sort();
const sizes = archives.map((name) => statSync(join(dataDir, name)).size);
const handles = archives.map((name) => openSync(join(dataDir, name), 'r'));
const read = (id, offset, length) => {
  const buffer = Buffer.alloc(length);
  readSync(handles[id], buffer, 0, length, offset);
  return new Uint8Array(buffer);
};

const { default: init, Client } = await import('../www/vendor/benilla-web/benilla_web.js');
await init({
  module_or_path: new Uint8Array(
    readSyncBytes(join(import.meta.dirname, '../www/vendor/benilla-web/benilla_web_bg.wasm'))
  ),
});

function readSyncBytes(path) {
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(statSync(path).size);
  readSync(fd, buffer, 0, buffer.length, 0);
  return buffer;
}

const client = new Client(archives, new Float64Array(sizes), read);
const listing = client.list();
const headers = {};
for (let i = 0; i < listing.names.length; i += 1) {
  const path = listing.names[i];
  if (!path.toLowerCase().endsWith('.dbc')) {
    continue;
  }
  const base = path.split(/[\\/]/).pop().replace(/\.dbc$/i, '');
  const bytes = client.readFile(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  headers[base] = [view.getUint32(8, true), view.getUint32(12, true)];
}
const benilla = client.schemas().map((entry) => entry.split('/')[0].toLowerCase());
writeFileSync(outPath, JSON.stringify({ benilla, headers }, null, 1));
console.log(`${Object.keys(headers).length} table(s) and ${benilla.length} benilla schema(s) written to ${outPath}`);
