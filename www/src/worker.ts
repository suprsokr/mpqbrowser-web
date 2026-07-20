import init, { MpqStreamingArchive } from 'wow-mpq-web';

interface ListMessage {
  type: 'list';
  file: File;
  path: string;
}

type WorkerMessage = ListMessage;

let initPromise: Promise<unknown> | null = null;

function ensureInit(): Promise<unknown> {
  if (!initPromise) {
    initPromise = init();
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

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  if (msg.type !== 'list') {
    return;
  }

  log('listing', msg.file.name, 'size', msg.file.size);

  try {
    await ensureInit();
    const archive = new MpqStreamingArchive(msg.file, readRange);
    const entries = (archive.list() as ListedEntry[]).map((entry) => ({
      ...entry,
      archive: msg.path,
    }));
    archive.free();
    self.postMessage({ type: 'listResult', entries });
  } catch (err) {
    log('listing failed', msg.file.name, err);
    self.postMessage({ type: 'error', error: String(err) });
  }
};

export {};
