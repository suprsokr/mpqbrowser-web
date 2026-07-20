import initMpq, { MpqStreamingArchive } from 'wow-mpq-web';
import initBlp, { blpToPng, decodeBlp } from 'wow-blp-web';
import initM2, { M2File } from 'wow-m2-web';

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
}

type WorkerMessage = ListMessage | ReadBlpMessage | ReadM2Message;

/** A decoded texture ready to upload to a WebGL texture. */
interface DecodedTexture {
  /** Index into the model's texture list. */
  index: number;
  /** Source filename resolved from the model (for diagnostics). */
  filename: string;
  width: number;
  height: number;
  /** RGBA pixels, width*height*4 bytes. */
  rgba: Uint8Array;
}

/** Payload returned for an M2 preview request. */
interface M2Payload {
  m2Bytes: Uint8Array;
  /** Null when the model uses an embedded skin (pre-WotLK). */
  skinBytes: Uint8Array | null;
  textures: DecodedTexture[];
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
    initPromise = Promise.all([initMpq(), initBlp(), initM2()]);
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

/**
 * Derive the external `.skin` path for a WotLK+ model. WoW names the
 * primary skin `<model>00.skin` next to the `.m2`.
 */
function skinPathFor(m2Name: string): string {
  return m2Name.replace(/\.m2$/i, '00.skin');
}

/**
 * Read an M2 model plus everything needed to render it: the external
 * `.skin` (if present) and the decoded BLP textures it references.
 */
async function readM2(file: File, path: string, name: string): Promise<M2Payload> {
  const archive = new MpqStreamingArchive(file, readRange);
  try {
    const m2Bytes = archive.readFile(normalizePath(name)) as Uint8Array;
    log('readM2', { path, name, size: m2Bytes.length });

    // Parse metadata to discover skin + texture filenames.
    const model = new M2File(m2Bytes);
    let summary: {
      textures: { filename: string }[];
    };
    try {
      summary = model.summary() as typeof summary;
    } finally {
      model.free();
    }

    // Try to load the external .skin. Missing skins are fine (older
    // models embed their skin data in the .m2 itself).
    let skinBytes: Uint8Array | null = null;
    const skinName = normalizePath(skinPathFor(name));
    try {
      skinBytes = archive.readFile(skinName) as Uint8Array;
      log('readM2 skin', { skinName, size: skinBytes.length });
    } catch {
      log('readM2 no external skin, using embedded', { skinName });
      skinBytes = null;
    }

    // Decode each referenced texture. Missing textures are skipped; the
    // renderer falls back to a placeholder for unresolved indices.
    const textures: DecodedTexture[] = [];
    summary.textures.forEach((tex, index) => {
      const filename = (tex.filename || '').trim();
      if (!filename) {
        return;
      }
      try {
        const blpBytes = archive.readFile(normalizePath(filename)) as Uint8Array;
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

    return { m2Bytes, skinBytes, textures };
  } finally {
    archive.free();
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
      const payload = await readM2(msg.file, msg.path, msg.name);
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
