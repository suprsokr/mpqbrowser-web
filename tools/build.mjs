#!/usr/bin/env node
// `npm run build`: rebuild the wasm reader when a `benilla` checkout sits beside this repo, and
// otherwise build the page with the bundle that is committed. That is what GitHub Pages has: the
// crates are not on a public branch, so the CI job cannot compile them.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');
const benilla = join(repo, '..', 'benilla', 'crates');
const hasCrates = existsSync(benilla);

if (hasCrates) {
  console.log(`building the wasm reader from ${benilla}`);
  execFileSync('npm', ['run', 'wasm'], { cwd: repo, stdio: 'inherit' });
} else {
  const bundle = join(repo, 'www', 'vendor', 'benilla-web', 'benilla_web_bg.wasm');
  if (!existsSync(bundle)) {
    console.error(
      'no benilla checkout beside this repo and no committed wasm bundle:\n' +
        `  expected ${benilla} or ${bundle}`
    );
    process.exit(1);
  }
  console.log('no benilla checkout beside this repo: using the committed wasm bundle');
}
execFileSync('npm', ['run', 'build:web'], { cwd: repo, stdio: 'inherit' });
