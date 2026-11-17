// A headless smoke test with no dependencies: drive the installed Chrome over CDP, list the
// archives, then open a texture, a model, a terrain tile, a DBC table and a sound, and save what
// the page drew.
//
//   node tools/smoke.mjs [http://localhost:8088/]
//
// Screenshots land in /tmp/mpqbrowser-*.png. Console errors and exceptions are printed at the end.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_UNDER_TEST = process.argv[2] || 'http://localhost:8088/';
/** `MOBILE=1` lays the page out at a phone's size, to check the stacked table. */
const MOBILE = process.env.MOBILE === '1';
const SHOT = (name) => (MOBILE ? `/tmp/mpqbrowser-${name}-mobile.png` : `/tmp/mpqbrowser-${name}.png`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browserEndpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const body = await res.json();
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('Chrome never opened its debugging port');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.next++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(new Cdp(ws)));
    ws.addEventListener('error', (e) => reject(new Error(`websocket: ${e.message ?? 'error'}`)));
  });
}

async function evaluate(cdp, session, expression, awaitPromise = false) {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise },
    session
  );
  if (res.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`
    );
  }
  return res.result.value;
}

async function waitFor(cdp, session, expression, what, timeoutMs = 240_000) {
  const started = Date.now();
  for (;;) {
    const value = await evaluate(cdp, session, expression).catch(() => undefined);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

async function screenshot(cdp, session, path) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session);
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot: ${path}`);
}

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'mpq-chrome-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-swiftshader',
      '--window-size=1400,1200',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let stderr = '';
  chrome.stderr.on('data', (d) => {
    stderr += String(d);
  });

  const cdp = await connect(await browserEndpoint());
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  if (MOBILE) {
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
      sessionId
    );
  }
  await cdp.send('Page.navigate', { url: URL_UNDER_TEST }, sessionId);

  const problems = [];
  const watch = setInterval(() => {
    for (const e of cdp.events.splice(0)) {
      if (e.method === 'Runtime.exceptionThrown') {
        problems.push(`exception: ${e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text}`);
      } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
        problems.push(`console.error: ${e.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        problems.push(`log: ${e.params.entry.text}`);
      }
    }
  }, 250);

  try {
    const status = await waitFor(
      cdp,
      sessionId,
      `document.getElementById('status')?.textContent?.includes('Listed') ? document.getElementById('status').textContent : ''`,
      'the archive listing'
    );
    console.log(`status: ${status}`);
    const rows = await evaluate(cdp, sessionId, `document.querySelectorAll('tbody > tr').length`);
    console.log(`rows on page one: ${rows}`);
    await screenshot(cdp, sessionId, SHOT('list'));

    // A texture, filtered to one known file.
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.getElementById('filter');
        input.value = 'HumanMaleSkin.blp';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    await sleep(400);
    const blpRow = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const row = [...document.querySelectorAll('tbody > tr.blp-preview-trigger')][0];
        if (!row) return '';
        row.click();
        return row.getAttribute('data-name');
      })()`
    );
    console.log(`blp: ${blpRow}`);
    await waitFor(
      cdp,
      sessionId,
      `document.querySelector('.blp-preview-image img')?.naturalWidth || 0`,
      'the texture preview'
    );
    const blpSize = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const img = document.querySelector('.blp-preview-image img');
        return img ? img.naturalWidth + 'x' + img.naturalHeight : '';
      })()`
    );
    console.log(`texture pixels: ${blpSize}`);
    await screenshot(cdp, sessionId, SHOT('blp'));

    // A character model, which also exercises the DBC composite.
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.getElementById('filter');
        input.value = 'Character\\\\Human\\\\Male\\\\HumanMale.m2';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    await sleep(400);
    const m2Row = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const row = [...document.querySelectorAll('tbody > tr.m2-preview-trigger')][0];
        if (!row) return '';
        row.click();
        return row.getAttribute('data-name');
      })()`
    );
    console.log(`m2: ${m2Row}`);
    const modelState = await waitFor(
      cdp,
      sessionId,
      `(() => {
        const canvas = document.querySelector('.m2-canvas');
        const error = document.querySelector('.m2-preview-error');
        if (canvas) return 'canvas';
        if (error) return 'error: ' + error.textContent;
        return '';
      })()`,
      'the model viewer'
    ).catch((e) => `timed out: ${e.message}`);
    console.log(`model state: ${modelState}`);
    await sleep(2500);
    const model = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const info = document.querySelector('.m2-info');
        const select = document.querySelector('.m2-anim-select');
        const canvas = document.querySelector('.m2-canvas');
        return {
          info: info?.textContent ?? '',
          animations: select?.options.length ?? 0,
          canvas: canvas ? canvas.width + 'x' + canvas.height : '',
          error: document.querySelector('.m2-preview-error')?.textContent ?? '',
        };
      })()`
    );
    console.log(`model: ${JSON.stringify(model)}`);
    await screenshot(cdp, sessionId, SHOT('m2'));

    // The references panel: which tables name a model, and the displays behind it.
    const references = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const details = document.querySelector('.dbc-list');
        if (details && !details.open) details.open = true;
        return details ? 'opened' : 'missing';
      })()`
    );
    const refsSummary = await waitFor(
      cdp,
      sessionId,
      `(() => {
        const text = document.querySelector('.dbc-list summary')?.textContent ?? '';
        return text.startsWith('DBCs (') ? text : '';
      })()`,
      'the model references',
      120_000
    ).catch((e) => `timed out: ${e.message}`);
    const refsRows = await evaluate(
      cdp,
      sessionId,
      `[...document.querySelectorAll('.dbc-list .refs-row')].slice(0, 4).map((r) => r.textContent.trim())`
    );
    console.log(`references (${references}): ${refsSummary}`);
    console.log(`reference rows: ${JSON.stringify(refsRows)}`);

    // Creature voice: the SoundEntries kits a display's events play, and one that plays.
    const voiceState = await waitFor(
      cdp,
      sessionId,
      `(() => {
        const rows = document.querySelectorAll('.refs-voice-row').length;
        const headings = [...document.querySelectorAll('.dbc-list .refs-heading')].map((h) => h.textContent);
        if (!rows) return '';
        return rows + ' voice row(s) | ' + headings.filter((h) => /voice|extras/.test(h)).join(' | ');
      })()`,
      'the creature voice panel',
      120_000
    ).catch((e) => `timed out: ${e.message}`);
    console.log(`voice: ${voiceState}`);
    const played = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const button = document.querySelector('.refs-voice-play .voice-play-button');
        if (!button) return 'no play button';
        button.click();
        return 'clicked';
      })()`
    );
    const audioState = await waitFor(
      cdp,
      sessionId,
      `(() => {
        const audio = document.querySelector('.refs-voice-play audio');
        if (!audio) return '';
        return isNaN(audio.duration) ? '' : 'blob ' + audio.duration.toFixed(2) + 's';
      })()`,
      'the voice audio',
      30_000
    ).catch((e) => `timed out: ${e.message}`);
    console.log(`voice audio (${played}): ${audioState}`);


    // A terrain tile: the 256-chunk mesh, its MTEX list, and the fly controls.
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.getElementById('filter');
        input.value = 'Azeroth_30_49.adt';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    await sleep(400);
    const adtRow = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const row = [...document.querySelectorAll('tbody > tr.adt-preview-trigger')][0];
        if (!row) return '';
        row.click();
        return row.getAttribute('data-name');
      })()`
    );
    console.log(`adt: ${adtRow}`);
    const adtState = await waitFor(
      cdp,
      sessionId,
      `(() => {
        if (document.querySelector('.terrain-canvas')) return 'canvas';
        const error = document.querySelector('.m2-preview-error');
        return error ? 'error: ' + error.textContent : '';
      })()`,
      'the terrain viewer'
    ).catch((e) => `timed out: ${e.message}`);
    console.log(`terrain state: ${adtState}`);
    await sleep(2000);
    const terrain = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const canvas = document.querySelector('.terrain-canvas');
        return {
          info: document.querySelector('.m2-info')?.textContent ?? '',
          textures: document.querySelectorAll('.m2-texture-row').length,
          placements: document.querySelector('.terrain-placements summary')?.textContent ?? '',
          canvas: canvas ? canvas.width + 'x' + canvas.height : '',
        };
      })()`
    );
    console.log(`terrain: ${JSON.stringify(terrain)}`);
    await screenshot(cdp, sessionId, SHOT('adt'));

    // Doodads and buildings: the toggle reads the placed models and draws them.
    const placed = await evaluate(
      cdp,
      sessionId,
      `(() => ({
        title: document.querySelector('.terrain-placements summary')?.textContent ?? '',
        toggles: [...document.querySelectorAll('.terrain-prop-toggle')].map((l) => l.textContent.trim()),
      }))()`
    );
    console.log(`placed: ${JSON.stringify(placed)}`);
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.querySelector('.terrain-prop-toggle input');
        if (!input || input.disabled) return false;
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        return true;
      })()`
    );
    const propsState = await waitFor(
      cdp,
      sessionId,
      `(() => {
        const text = document.querySelector('.terrain-prop-controls .m2-info')?.textContent ?? '';
        return text.includes('batch') || text.includes('could not') ? text : '';
      })()`,
      'the placed models',
      120_000
    ).catch((e) => `timed out: ${e.message}`);
    console.log(`props: ${propsState}`);
    await sleep(1500);
    await screenshot(cdp, sessionId, SHOT('props'));

    // Flying: hold W, then compare where the camera ended up.
    await evaluate(
      cdp,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))`
    );
    await sleep(1200);
    await evaluate(
      cdp,
      sessionId,
      `document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))`
    );
    await sleep(300);
    await screenshot(cdp, sessionId, SHOT('adt-flown'));

    // A DBC: column names from the shipped schema, a page of rows, and a filter.
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.getElementById('filter');
        input.value = 'CreatureDisplayInfo.dbc';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    await sleep(400);
    const dbcRow = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const row = [...document.querySelectorAll('tbody > tr.dbc-preview-trigger')][0];
        if (!row) return '';
        row.click();
        return row.getAttribute('data-name');
      })()`
    );
    console.log(`dbc: ${dbcRow}`);
    await waitFor(
      cdp,
      sessionId,
      `document.querySelectorAll('.dbc-table tbody tr').length || 0`,
      'the DBC table'
    );
    const dbc = await evaluate(
      cdp,
      sessionId,
      `(() => ({
        caption: document.querySelector('.dbc-caption')?.textContent ?? '',
        columns: [...document.querySelectorAll('.dbc-table thead th')].slice(0, 6).map((h) => h.textContent),
        rows: document.querySelectorAll('.dbc-table tbody tr').length,
        firstCell: document.querySelector('.dbc-table tbody td')?.textContent ?? '',
      }))()`
    );
    console.log(`dbc table: ${JSON.stringify(dbc)}`);
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.querySelector('.dbc-filter');
        input.value = 'ZombieSkinSeaGreen';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    await sleep(900);
    const filtered = await evaluate(
      cdp,
      sessionId,
      `document.querySelector('.dbc-controls .m2-info')?.textContent ?? ''`
    );
    console.log(`dbc filter: ${filtered}`);
    await screenshot(cdp, sessionId, SHOT('dbc'));

    // The terrain panel names the tables it read, and the zones underfoot.
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.getElementById('filter');
        input.value = 'Azeroth_30_49.adt';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    await sleep(400);
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const row = [...document.querySelectorAll('tbody > tr.adt-preview-trigger')][0];
        row?.click();
      })()`
    );
    await waitFor(
      cdp,
      sessionId,
      `document.querySelector('.terrain-canvas') ? 'canvas' : ''`,
      'the terrain viewer again'
    );
    await sleep(1200);
    const tables = await evaluate(
      cdp,
      sessionId,
      `(() => ({
        zones: (document.querySelector('.m2-info')?.textContent ?? '').match(/areas .*/)?.[0] ?? '',
        found: [...document.querySelectorAll('.tables-read-link')].map((a) => a.textContent),
      }))()`
    );
    console.log(`terrain tables: ${JSON.stringify(tables)}`);

    // A sound: the player, its format line, and the kit that plays it.
    await evaluate(
      cdp,
      sessionId,
      `(() => {
        const input = document.getElementById('filter');
        input.value = 'ZombieAggro.wav';
        input.dispatchEvent(new Event('input'));
      })()`
    );
    await sleep(400);
    const soundRow = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const row = [...document.querySelectorAll('tbody > tr.sound-preview-trigger')][0];
        if (!row) return '';
        row.click();
        return row.getAttribute('data-name');
      })()`
    );
    console.log(`sound: ${soundRow}`);
    await waitFor(
      cdp,
      sessionId,
      `document.querySelector('.sound-info')?.textContent || ''`,
      'the sound preview'
    );
    await waitFor(
      cdp,
      sessionId,
      `(() => {
        const a = document.querySelector('.sound-player');
        return a && a.readyState >= 2 ? 'ready' : '';
      })()`,
      'the sound to decode',
      30_000
    ).catch((e) => console.log(`audio: ${e.message}`));
    const sound = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const a = document.querySelector('.sound-player');
        return {
          info: document.querySelector('.sound-info')?.textContent ?? '',
          kits: [...document.querySelectorAll('.sound-kit')].map((e) => e.textContent).slice(0, 3),
          duration: a ? Math.round(a.duration * 100) / 100 : 0,
          decodeError: a?.error?.message ?? '',
        };
      })()`
    );
    console.log(`sound info: ${sound.info} | duration ${sound.duration}s`);
    console.log(`sound kits: ${JSON.stringify(sound.kits)}`);
    if (sound.decodeError) console.log(`PROBLEM audio: ${sound.decodeError}`);
    await screenshot(cdp, sessionId, SHOT('sound'));
  } finally {
    clearInterval(watch);
    for (const p of problems) console.log(`PROBLEM ${p}`);
    chrome.kill('SIGTERM');
    if (problems.length === 0) console.log('smoke: no page errors');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
