#!/usr/bin/env node
// `npm run build`: rebuild the wasm reader when a `benilla` checkout sits beside this repo, and
// otherwise build the page with the bundle that is committed. That is what GitHub Pages has: the
// crates are not on a public branch, so the CI job cannot compile them.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = join(import.meta.dirname, '..');

/** Whether the Rust toolchain and `wasm-pack` are here to compile the reader. */
function canBuildWasm() {
  for (const tool of ['cargo', 'wasm-pack']) {
    try {
      execFileSync(tool, ['--version'], { stdio: 'ignore' });
    } catch {
      return false;
    }
  }
  return true;
}

if (canBuildWasm() && process.env.SKIP_WASM !== '1') {
  console.log('building the wasm reader from the pinned benilla fork');
  execFileSync('npm', ['run', 'wasm'], { cwd: repo, stdio: 'inherit' });
} else {
  const bundle = join(repo, 'www', 'vendor', 'benilla-web', 'benilla_web_bg.wasm');
  if (!existsSync(bundle)) {
    console.error(
      'no Rust toolchain with wasm-pack and no committed wasm bundle:\n' +
        `  install wasm-pack, or keep ${bundle}`
    );
    process.exit(1);
  }
  console.log('no Rust toolchain with wasm-pack: using the committed wasm bundle');
}
execFileSync('npm', ['run', 'build:web'], { cwd: repo, stdio: 'inherit' });
