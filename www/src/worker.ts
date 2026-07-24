import initMpq, { MpqStreamingArchive } from 'wow-mpq-web';
import initBlp, { blpToPng, decodeBlp } from 'wow-blp-web';
import initWmvx, {
  WmvxModel,
  LegacyDatabase,
  assembleLegacyCharacter,
  composeBodyTexture,
  decodeBlp as decodeWmvxBlp,
} from '../vendor/wmvx-wasm/wmvx_wasm.js';

interface ListMessage {
  type: 'list';
  id: number;
  file: File;
  path: string;
}

interface ReadBlpMessage {
  type: 'readBlp';
  id: number;
  file: File;
  path: string;
  name: string;
}

interface ReadM2Message {
  type: 'readM2';
  id: number;
  file: File;
  path: string;
  name: string;
  archives?: { path: string; file: File }[];
  characterChoice?: CharacterChoice;
}

type WorkerMessage = ListMessage | ReadBlpMessage | ReadM2Message;

/** A decoded texture ready to upload to a WebGL texture. */
interface DecodedTexture {
  /** Index into the model's texture list, or -1 for dynamic character slots. */
  index: number;
  /** Source filename resolved from the model (for diagnostics). */
  filename: string;
  width: number;
  height: number;
  /** RGBA pixels, width*height*4 bytes. */
  rgba: Uint8Array;
}

interface CharacterChoiceOptions {
  skins: number[];
  faces: number[];
  hairStyles: number[];
  hairColors: number[];
  facialStyles: number[];
}

interface CharacterChoice {
  skin: number;
  face: number;
  hairStyle: number;
  hairColor: number;
  facialStyle: number;
  facialColor: number;
}

interface CharacterAppearance {
  choice: CharacterChoice;
  visibleGeosets: number[];
  body: DecodedTexture;
  hair: DecodedTexture | null;
  skinExtra: DecodedTexture | null;
}

interface CharacterPayload {
  raceId: number;
  gender: number;
  options: CharacterChoiceOptions;
  appearance: CharacterAppearance;
}

/** Payload returned for an M2 preview request. */
interface M2Payload {
  m2Bytes: Uint8Array;
  /** Null when the model uses an embedded skin (pre-WotLK). */
  skinBytes: Uint8Array | null;
  textures: DecodedTexture[];
  character: CharacterPayload | null;
}

interface ListedEntry {
  name: string;
  size: number;
  compressed_size: number;
  flags: number;
  compressed: boolean;
  encrypted: boolean;
  single_unit: boolean;
  exists: boolean;
}

let initPromise: Promise<[unknown, unknown, unknown]> | null = null;

function ensureInit(): Promise<[unknown, unknown, unknown]> {
  if (!initPromise) {
    initPromise = Promise.all([initMpq(), initBlp(), initWmvx()]);
  }
  return initPromise;
}

if (typeof FileReaderSync === 'undefined') {
  throw new Error(
    'FileReaderSync is not available in this Worker context. MPQ browsing requires a browser that supports FileReaderSync in Web Workers.'
  );
}

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[mpqbrowser worker]', ...args);
}

/**
 * Synchronous file read using FileReaderSync inside a Web Worker.
 *
 * This runs on the worker thread, so it never blocks the main UI thread.
 */
function readRange(file: File, offset: number, length: number): Uint8Array {
  if (length < 0) {
    throw new Error(`Negative read length: ${length}`);
  }
  if (length === 0) {
    return new Uint8Array(0);
  }
  if (offset < 0 || offset > file.size) {
    throw new Error(
      `Read offset out of range: offset=${offset}, fileSize=${file.size}`
    );
  }

  try {
    const reader = new FileReaderSync();
    const end = Math.min(offset + length, file.size);
    const blob = file.slice(offset, end);
    const buffer = reader.readAsArrayBuffer(blob);
    if (!(buffer instanceof ArrayBuffer)) {
      throw new Error(
        `FileReaderSync returned unexpected type: ${typeof buffer}`
      );
    }
    return new Uint8Array(buffer);
  } catch (err) {
    log('readRange failed', { offset, length, fileSize: file.size, err });
    throw err;
  }
}

function isBlpPath(name: string): boolean {
  return name.toLowerCase().endsWith('.blp');
}

function isM2Path(name: string): boolean {
  return name.toLowerCase().endsWith('.m2');
}

async function readBlp(file: File, path: string, name: string): Promise<Uint8Array> {
  const archive = new MpqStreamingArchive(file, readRange);
  try {
    const blpBytes = archive.readFile(name);
    log('readBlp', { path, name, size: blpBytes.length });
    return blpToPng(blpBytes);
  } finally {
    archive.free();
  }
}

/** Normalize an MPQ path to backslashes and lowercase for lookups. */
function normalizePath(name: string): string {
  return name.replace(/\//g, '\\');
}

/** Higher number = higher patch priority when resolving cross-MPQ assets. */
function patchPriority(path: string): number {
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? path.toLowerCase();
  if (/^patch(?:-|_|\.)/.test(base)) return 100;
  if (base === 'texture.mpq') return 40;
  if (base === 'model.mpq') return 30;
  if (base === 'dbc.mpq') return 20;
  if (base === 'misc.mpq') return 10;
  if (base === 'base.mpq') return 0;
  return 50;
}

/**
 * Derive the external `.skin` path for a WotLK+ model. WoW names the
 * primary skin `<model>00.skin` next to the `.m2`.
 */
function skinPathFor(m2Name: string): string {
  return m2Name.replace(/\.m2$/i, '00.skin');
}

function inferLegacyCharacter(name: string): { raceId: number; gender: number } | null {
  const n = normalizePath(name).toLowerCase();
  const m = n.match(/^character\\([^\\]+)\\(male|female)\\/);
  if (!m) return null;
  const race: Record<string, number> = {
    human: 1,
    orc: 2,
    dwarf: 3,
    nightelf: 4,
    scourge: 5,
    undead: 5,
    tauren: 6,
    gnome: 7,
    troll: 8,
    goblin: 9,
    bloodelf: 10,
    draenei: 11,
  };
  const raceId = race[m[1]];
  if (!raceId) return null;
  return { raceId, gender: m[2] === 'female' ? 1 : 0 };
}


function choiceFromOptions(options: CharacterChoiceOptions): CharacterChoice {
  const pick = (xs: number[], fallback = 0) => xs.length ? xs[0] : fallback;
  return {
    skin: pick(options.skins),
    face: pick(options.faces),
    hairStyle: pick(options.hairStyles),
    hairColor: pick(options.hairColors),
    facialStyle: pick(options.facialStyles),
    facialColor: pick(options.hairColors),
  };
}

function decodeLayer(readAny: (name: string) => Uint8Array, req: { texture: string; region?: string | null; layer: number }) {
  const decoded = decodeWmvxBlp(readAny(req.texture), 0) as { width: number; height: number; rgba: Uint8Array };
  return {
    rgba: decoded.rgba,
    width: decoded.width,
    height: decoded.height,
    region: req.region ?? null,
    layer: req.layer ?? 0,
  };
}

function decodeTexture(readAny: (name: string) => Uint8Array, filename: string, index: number): DecodedTexture {
  const decoded = decodeWmvxBlp(readAny(filename), 0) as { width: number; height: number; rgba: Uint8Array };
  return { index, filename, width: decoded.width, height: decoded.height, rgba: decoded.rgba };
}

function assembleCharacterAppearance(
  model: WmvxModel,
  db: LegacyDatabase,
  readAny: (name: string) => Uint8Array,
  raceId: number,
  gender: number,
  options: CharacterChoiceOptions,
  choice: CharacterChoice,
): CharacterAppearance {
  const resolved = db.resolve(raceId, gender, choice);
  try {
    const assembled = assembleLegacyCharacter(model, resolved, {
      showHair: true,
      showUnderwear: true,
      showFacialHair: true,
    }) as {
      bodyLayers: { texture: string; region?: string | null; layer: number }[];
      replaceableTextures: { hair: string | null; skinExtra: string | null };
      visibleGeosets: number[];
    };
    const layers = assembled.bodyLayers.map((req) => decodeLayer(readAny, req));
    const body = composeBodyTexture(layers) as { width: number; height: number; rgba: Uint8Array };
    return {
      choice,
      visibleGeosets: assembled.visibleGeosets,
      body: { index: -1, filename: '(composited body)', width: body.width, height: body.height, rgba: body.rgba },
      hair: assembled.replaceableTextures.hair ? decodeTexture(readAny, assembled.replaceableTextures.hair, -2) : null,
      skinExtra: assembled.replaceableTextures.skinExtra ? decodeTexture(readAny, assembled.replaceableTextures.skinExtra, -3) : null,
    };
  } finally {
    resolved.free();
  }
}

function tryBuildLegacyCharacter(
  model: WmvxModel,
  readAny: (name: string) => Uint8Array,
  name: string,
  requestedChoice?: CharacterChoice,
): CharacterPayload | null {
  const inferred = inferLegacyCharacter(name);
  if (!inferred) return null;
  try {
    const db = new LegacyDatabase(
      readAny('DBFilesClient\\CharSections.dbc'),
      readAny('DBFilesClient\\CharHairGeosets.dbc'),
      readAny('DBFilesClient\\CharacterFacialHairStyles.dbc'),
      readAny('DBFilesClient\\ChrRaces.dbc'),
    );
    try {
      const options = db.legacyChoices(inferred.raceId, inferred.gender) as CharacterChoiceOptions;
      const choice = requestedChoice ?? choiceFromOptions(options);
      const appearance = assembleCharacterAppearance(model, db, readAny, inferred.raceId, inferred.gender, options, choice);
      return { raceId: inferred.raceId, gender: inferred.gender, options, appearance };
    } finally {
      db.free();
    }
  } catch (err) {
    log('legacy character assembly unavailable', { name, err: String(err) });
    return null;
  }
}

/**
 * Read an M2 model plus everything needed to render it: the external
 * `.skin` (if present) and the decoded BLP textures it references.
 */
async function readM2(
  file: File,
  path: string,
  name: string,
  archivesInput?: { path: string; file: File }[],
  requestedChoice?: CharacterChoice,
): Promise<M2Payload> {
  const archiveInputs = archivesInput?.length ? archivesInput : [{ path, file }];
  const archives = archiveInputs.map((a) => ({
    path: a.path,
    archive: new MpqStreamingArchive(a.file, readRange),
  }));
  const readAny = (assetName: string): Uint8Array => {
    const norm = normalizePath(assetName);
    const ordered = [...archives].sort((a, b) => patchPriority(b.path) - patchPriority(a.path));
    let lastErr: unknown = null;
    for (const candidate of ordered) {
      try {
        return candidate.archive.readFile(norm) as Uint8Array;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error(`File not found: ${norm}`);
  };

  try {
    const m2Bytes = readAny(name);
    log('readM2', { path, name, size: m2Bytes.length, archives: archives.length });

    // Try to load the external .skin. Missing skins are fine (older
    // models embed their skin data in the .m2 itself).
    let skinBytes: Uint8Array | null = null;
    const skinName = normalizePath(skinPathFor(name));
    try {
      skinBytes = readAny(skinName);
      log('readM2 skin', { skinName, size: skinBytes.length });
    } catch {
      log('readM2 no external skin, using embedded', { skinName });
      skinBytes = null;
    }

    // Parse metadata with wmvx-wasm to discover texture definitions. The renderer
    // binds render passes by textureDefIndex, not the legacy pass texture unit.
    const model = new WmvxModel(m2Bytes, skinBytes);
    let textureDefs: { textureType: number; flags: number; filename: string }[];
    let character: CharacterPayload | null = null;
    try {
      textureDefs = model.textures() as typeof textureDefs;
      character = tryBuildLegacyCharacter(model, readAny, name, requestedChoice);
    } finally {
      model.free();
    }

    // Decode each hardcoded texture reference. Missing/replaceable textures are
    // skipped; the renderer falls back to a placeholder for unresolved indices.
    const textures: DecodedTexture[] = [];
    textureDefs.forEach((tex, index) => {
      const filename = (tex.filename || '').trim();
      if (!filename) {
        return;
      }
      try {
        const blpBytes = readAny(filename);
        const decoded = decodeBlp(blpBytes) as {
          width: number;
          height: number;
          rgba: Uint8Array;
        };
        textures.push({
          index,
          filename,
          width: decoded.width,
          height: decoded.height,
          rgba: decoded.rgba,
        });
      } catch (err) {
        log('readM2 texture decode failed', { filename, err: String(err) });
      }
    });

    return { m2Bytes, skinBytes, textures, character };
  } finally {
    for (const a of archives) {
      a.archive.free();
    }
  }
}

/** Collect transferable ArrayBuffers from an M2 payload for zero-copy postMessage. */
function m2Transferables(payload: M2Payload): Transferable[] {
  const transfers: Transferable[] = [payload.m2Bytes.buffer];
  if (payload.skinBytes) {
    transfers.push(payload.skinBytes.buffer);
  }
  for (const tex of payload.textures) {
    transfers.push(tex.rgba.buffer);
  }
  if (payload.character) {
    transfers.push(payload.character.appearance.body.rgba.buffer);
    if (payload.character.appearance.hair) transfers.push(payload.character.appearance.hair.rgba.buffer);
    if (payload.character.appearance.skinExtra) transfers.push(payload.character.appearance.skinExtra.rgba.buffer);
  }
  return transfers;
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  if (msg.type === 'list') {
    log('listing', msg.file.name, 'size', msg.file.size);

    try {
      await ensureInit();
      const archive = new MpqStreamingArchive(msg.file, readRange);
      const entries = (archive.list() as ListedEntry[]).map((entry) => ({
        ...entry,
        archive: msg.path,
      }));
      archive.free();
      self.postMessage({ type: 'listResult', id: msg.id, entries });
    } catch (err) {
      log('listing failed', msg.file.name, err);
      self.postMessage({ type: 'error', id: msg.id, error: String(err) });
    }
    return;
  }

  if (msg.type === 'readBlp') {
    if (!isBlpPath(msg.name)) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        error: `Not a BLP file: ${msg.name}`,
      });
      return;
    }

    try {
      await ensureInit();
      const png = await readBlp(msg.file, msg.path, msg.name);
      self.postMessage({ type: 'blpResult', id: msg.id, png });
    } catch (err) {
      log('readBlp failed', msg.path, msg.name, err);
      self.postMessage({ type: 'error', id: msg.id, error: String(err) });
    }
    return;
  }

  if (msg.type === 'readM2') {
    if (!isM2Path(msg.name)) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        error: `Not an M2 file: ${msg.name}`,
      });
      return;
    }

    try {
      await ensureInit();
      const payload = await readM2(msg.file, msg.path, msg.name, msg.archives, msg.characterChoice);
      self.postMessage(
        { type: 'm2Result', id: msg.id, payload },
        m2Transferables(payload)
      );
    } catch (err) {
      log('readM2 failed', msg.path, msg.name, err);
      self.postMessage({ type: 'error', id: msg.id, error: String(err) });
    }
    return;
  }
};

export {};
