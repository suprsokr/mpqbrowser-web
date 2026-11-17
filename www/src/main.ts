import {
  M2Viewer,
  type M2Payload,
  type TextureReport,
  type AnimationInfo,
  type CharacterAppearance,
  type CharacterChoice,
  type CharacterChoiceOptions,
  type DecodedTexture,
} from './m2viewer';
import { TerrainViewer, type AdtPayload, type PropsPayload } from './terrainviewer';
import type { CreatureVoicePayload, ModelRefsPayload } from './worker';
import { animationName } from './anim_names';

interface MpqEntry {
  archive: string;
  name: string;
  size: number;
  compressed_size: number;
  flags: number;
  compressed: boolean;
  encrypted: boolean;
  single_unit: boolean;
  exists: boolean;
}

const pickButton = document.getElementById('pick-folder') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const progressEl = document.getElementById('progress') as HTMLProgressElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const tableContainer = document.getElementById('table-container') as HTMLDivElement;
const filterInput = document.getElementById('filter') as HTMLInputElement;
const paginationEl = document.getElementById('pagination') as HTMLDivElement;
const prevPageBtn = document.getElementById('prev-page') as HTMLButtonElement;
const nextPageBtn = document.getElementById('next-page') as HTMLButtonElement;
const pageInfoEl = document.getElementById('page-info') as HTMLSpanElement;
const pageSizeSelect = document.getElementById('page-size') as HTMLSelectElement;

const DEFAULT_PAGE_SIZE = 100;

let allEntries: MpqEntry[] = [];
let filteredEntries: MpqEntry[] = [];
let currentPage = 0;
let pageSize = DEFAULT_PAGE_SIZE;

let worker: Worker | null = null;

/** One mounted archive: a server endpoint, or a `File` from the folder picker. */
interface ArchiveRef {
  name: string;
  size: number;
  url?: string;
  file?: File;
}

const archives = new Map<string, ArchiveRef>();
let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

const activePreviews = new Map<string, HTMLTableRowElement>();

function humanSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/** The listing as the worker returns it: one column array per field. */
interface Listing {
  names: string[];
  archive: Uint16Array;
  size: Uint32Array;
  compressed: Uint32Array;
  flags: Uint32Array;
}

interface LoadResult {
  archives: string[];
  listing: Listing;
}

/** One page of a DBC, with column names from the schemas benilla ships. */
interface DbcSheet {
  path: string;
  columns: string[];
  rows: (number | string | null)[][];
  total: number;
  matched: number;
  offset: number;
  schema: string | null;
  keyIndex: number | null;
  types?: string[];
  note?: string;
  recordCount: number;
  fieldCount: number;
}

/** A sound file and the `SoundEntries` kits that play it. */
interface SoundPayload {
  path: string;
  bytes: Uint8Array;
  tables?: string[];
  kits: {
    id: number;
    soundType: number;
    name: string;
    volume: number;
    minDistance: number;
    distanceCutoff: number;
  }[];
}

interface WorkerResponse {
  type: string;
  id?: number;
  archives?: string[];
  listing?: Listing;
  png?: Uint8Array;
  payload?: M2Payload | AdtPayload | SoundPayload | DbcSheet;
  error?: string;
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.id === undefined) {
        return;
      }
      const pending = pendingRequests.get(data.id);
      if (!pending) {
        return;
      }
      pendingRequests.delete(data.id);
      if (data.type === 'error') {
        pending.reject(new Error(data.error || 'Unknown worker error'));
      } else if (data.type === 'loadResult') {
        pending.resolve({
          archives: data.archives,
          listing: data.listing,
        });
      } else if (data.type === 'blpResult') {
        pending.resolve(data.png as unknown);
      } else if (
        data.type === 'm2Result' ||
        data.type === 'adtResult' ||
        data.type === 'soundResult' ||
        data.type === 'dbcResult' ||
        data.type === 'propsResult' ||
        data.type === 'refsResult' ||
        data.type === 'voiceResult'
      ) {
        pending.resolve(data.payload as unknown);
      } else {
        pending.reject(new Error(`Unknown response type: ${data.type}`));
      }
    });
  }
  return worker;
}

function clearPreviews(): void {
  for (const viewer of activeViewers.values()) {
    viewer.dispose();
  }
  activeViewers.clear();
  for (const row of activePreviews.values()) {
    if (row.dataset.url) {
      URL.revokeObjectURL(row.dataset.url);
    }
    row.remove();
  }
  activePreviews.clear();
}

function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    clearPreviews();
    for (const pending of pendingRequests.values()) {
      pending.reject(new Error('Worker terminated'));
    }
    pendingRequests.clear();
  }
}

function sendMessage<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  const id = nextRequestId++;
  const promise = new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
  });
  ensureWorker().postMessage({ type, ...payload, id });
  return promise;
}

/** Mount `refs` in the worker and list every path they hold. */
function loadArchives(refs: ArchiveRef[]): Promise<LoadResult> {
  return sendMessage<LoadResult>('load', { archives: refs });
}

function readBlpPreview(name: string): Promise<Uint8Array> {
  return sendMessage<Uint8Array>('readBlp', { name });
}

function readM2Preview(name: string, characterChoice?: CharacterChoice): Promise<M2Payload> {
  return sendMessage<M2Payload>('readM2', { name, characterChoice });
}

function readAdtPreview(name: string): Promise<AdtPayload> {
  return sendMessage<AdtPayload>('readAdt', { name });
}

function readSoundPreview(name: string): Promise<SoundPayload> {
  return sendMessage<SoundPayload>('readSound', { name });
}

/** The model's `CreatureSoundData` voice rows and `CreatureDisplayInfoExtra` looks. */
function readCreatureVoice(path: string): Promise<CreatureVoicePayload> {
  return sendMessage<CreatureVoicePayload>('readVoice', { path });
}

function readPropsPreview(
  items: { path: string; position: [number, number, number]; rotation: [number, number, number]; scale: number }[]
): Promise<PropsPayload> {
  return sendMessage<PropsPayload>('readProps', { items });
}

function readDbcSheet(
  name: string,
  offset = 0,
  limit = 200,
  filter = ''
): Promise<DbcSheet> {
  return sendMessage<DbcSheet>('readDbc', { name, offset, limit, filter });
}

/** The worker's column listing as table rows. */
function entriesFromListing(listing: Listing, archiveNames: string[]): MpqEntry[] {
  const out: MpqEntry[] = [];
  for (let i = 0; i < listing.names.length; i++) {
    const flags = listing.flags[i];
    out.push({
      archive: archiveNames[listing.archive[i]] ?? '?',
      name: listing.names[i],
      size: listing.size[i],
      compressed_size: listing.compressed[i],
      flags,
      compressed: (flags & 0x0000ff00) !== 0,
      encrypted: (flags & 0x00010000) !== 0,
      single_unit: (flags & 0x01000000) !== 0,
      exists: (flags & 0x80000000) !== 0,
    });
  }
  return out;
}

/** Mount a set of archives, list them, and render the first page. */
async function mount(refs: ArchiveRef[], note: string): Promise<void> {
  if (refs.length === 0) {
    setStatus('No .mpq archives found.');
    return;
  }
  terminateWorker();
  archives.clear();
  for (const ref of refs) {
    archives.set(ref.name, ref);
  }
  tableContainer.innerHTML = '';
  statsEl.textContent = '';
  filterInput.hidden = true;
  filterInput.value = '';
  paginationEl.hidden = true;
  allEntries = [];
  filteredEntries = [];
  currentPage = 0;
  setStatus(`${note}: mounting ${refs.length} archive(s) and reading their tables...`);
  setProgress(0, refs.length);
  try {
    const result = await loadArchives(refs);
    allEntries = entriesFromListing(result.listing, result.archives);
    filteredEntries = allEntries.slice();
    hideProgress();
    filterInput.hidden = false;
    paginationEl.hidden = false;
    pageSizeSelect.value = String(DEFAULT_PAGE_SIZE);
    currentPage = 0;
    setStatus(
      `Done. Listed ${allEntries.length.toLocaleString()} file(s) from ${result.archives.length} archive(s).`
    );
    renderPage();
  } catch (e) {
    hideProgress();
    setStatus(`Listing failed: ${String(e)}`);
  }
}

/** The local server's archives, when the page is served by `server.mjs`. */
async function loadFromServer(): Promise<boolean> {
  setStatus('Looking for the local archive server...');
  try {
    // Relative to the page, so the probe stays under the app's path on a project page.
    const response = await fetch(new URL('api/archives', document.baseURI));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      dataDir?: string;
      archives: { name: string; size: number }[];
    };
    if (!body.archives.length) {
      throw new Error(`no MPQ archives in ${body.dataDir ?? 'the data folder'}`);
    }
    const refs: ArchiveRef[] = body.archives.map((a) => ({
      name: a.name,
      size: a.size,
      url: `/api/archive/${encodeURIComponent(a.name)}`,
    }));
    await mount(refs, `Server ${body.dataDir ?? ''}`);
    return true;
  } catch (e) {
    setStatus(`No local archive server (${String(e)}). Pick a Data folder instead.`);
    return false;
  }
}

/** What a preview panel holds that needs tearing down: a GL viewer, or a playing sound. */
interface Disposable {
  dispose(): void;
}

/** Viewer state keyed by preview key, so a page turn or close can dispose it. */
const activeViewers = new Map<string, Disposable>();

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function setProgress(value: number, max: number): void {
  progressEl.hidden = false;
  progressEl.value = value;
  progressEl.max = max;
}

function hideProgress(): void {
  progressEl.hidden = true;
}

/**
 * Recursively find all `.mpq` / `.MPQ` files under a directory handle.
 */
async function findMpqFiles(
  dirHandle: FileSystemDirectoryHandle,
  relativePath = ''
): Promise<{ path: string; handle: FileSystemFileHandle }[]> {
  const results: { path: string; handle: FileSystemFileHandle }[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const entryPath = relativePath ? `${relativePath}/${name}` : name;
    if (handle.kind === 'directory') {
      results.push(...(await findMpqFiles(handle as FileSystemDirectoryHandle, entryPath)));
    } else if (handle.kind === 'file' && name.toLowerCase().endsWith('.mpq')) {
      results.push({ path: entryPath, handle: handle as FileSystemFileHandle });
    }
  }
  return results;
}


function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderPage(): void {
  const start = currentPage * pageSize;
  const end = Math.min(start + pageSize, filteredEntries.length);
  const pageEntries = filteredEntries.slice(start, end);

  clearPreviews();

  if (pageEntries.length === 0) {
    tableContainer.innerHTML = '<p>No files found.</p>';
    pageInfoEl.textContent = '0 / 0';
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Archive</th>
        <th>Path</th>
        <th class="num">Size</th>
        <th class="num">Compressed</th>
        <th>Flags</th>
      </tr>
    </thead>
    <tbody>
      ${pageEntries
        .map(
          (e, index) => {
            const lower = e.name.toLowerCase();
            const isBlp = lower.endsWith('.blp');
            const isM2 = lower.endsWith('.m2');
            const isAdt = lower.endsWith('.adt');
            const isDbc = lower.endsWith('.dbc');
            const isSound = lower.endsWith('.wav') || lower.endsWith('.mp3');
            const triggerClass = isBlp
              ? 'blp-preview-trigger'
              : isM2
                ? 'm2-preview-trigger'
                : isAdt
                  ? 'adt-preview-trigger'
                  : isDbc
                    ? 'dbc-preview-trigger'
                    : isSound
                      ? 'sound-preview-trigger'
                      : '';
            return `
        <tr class="${triggerClass}" data-archive="${escapeHtml(e.archive)}" data-name="${escapeHtml(e.name)}">
          <td class="archive${index > 0 && pageEntries[index - 1].archive === e.archive ? ' repeat' : ''}" data-label="archive">${escapeHtml(e.archive)}</td>
          <td class="path" data-label="path">${escapeHtml(e.name)}</td>
          <td class="num" data-label="size">${humanSize(e.size)}</td>
          <td class="num" data-label="packed">${humanSize(e.compressed_size)}</td>
          <td class="flags" data-label="flags">
            ${e.compressed ? '<span class="flag comp">COMP</span>' : ''}
            ${e.encrypted ? '<span class="flag enc">ENC</span>' : ''}
            ${e.single_unit ? '<span class="flag single">UNIT</span>' : ''}
          </td>
        </tr>
      `;
          }
        )
        .join('')}
    </tbody>
  `;
  tableContainer.innerHTML = '';
  tableContainer.appendChild(table);

  const totalPages = Math.ceil(filteredEntries.length / pageSize) || 1;
  pageInfoEl.textContent = `Page ${currentPage + 1} / ${totalPages} (${start + 1}-${end} of ${filteredEntries.length.toLocaleString()})`;
  prevPageBtn.disabled = currentPage === 0;
  nextPageBtn.disabled = currentPage >= totalPages - 1;

  statsEl.textContent = `
    Total files: ${allEntries.length.toLocaleString()}
    | Filtered: ${filteredEntries.length.toLocaleString()}
    | Uncompressed total: ${humanSize(filteredEntries.reduce((s, e) => s + e.size, 0))}
    | Compressed total: ${humanSize(filteredEntries.reduce((s, e) => s + e.compressed_size, 0))}
  `;
}

function applyFilter(): void {
  const query = filterInput.value.trim().toLowerCase();
  filteredEntries = query
    ? allEntries.filter(
        (e) =>
          e.name.toLowerCase().includes(query) ||
          e.archive.toLowerCase().includes(query)
      )
    : allEntries.slice();
  currentPage = 0;
  renderPage();
}

function goToPage(page: number): void {
  const totalPages = Math.ceil(filteredEntries.length / pageSize) || 1;
  currentPage = Math.max(0, Math.min(page, totalPages - 1));
  renderPage();
  tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setPageSize(size: number): void {
  pageSize = size;
  currentPage = 0;
  renderPage();
}

async function onPickFolder(): Promise<void> {
  if (!('showDirectoryPicker' in window)) {
    setStatus('Your browser does not support the File System Access API (showDirectoryPicker).');
    return;
  }
  pickButton.disabled = true;
  setStatus('Scanning for MPQ files...');

  let dirHandle: FileSystemDirectoryHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch (e) {
    setStatus(`Folder selection cancelled or failed: ${e}`);
    pickButton.disabled = false;
    return;
  }

  const mpqFiles = await findMpqFiles(dirHandle);
  const refs: ArchiveRef[] = [];
  for (const { handle } of mpqFiles) {
    const file = await handle.getFile();
    refs.push({ name: file.name, size: file.size, file });
  }
  await mount(refs, 'Selected folder');
  pickButton.disabled = false;
}

function previewKey(archive: string, name: string): string {
  return `${archive}\0${name}`;
}

async function toggleBlpPreview(row: HTMLTableRowElement): Promise<void> {
  const archive = row.getAttribute('data-archive');
  const name = row.getAttribute('data-name');
  if (!archive || !name) {
    return;
  }

  const key = previewKey(archive, name);
  const existing = activePreviews.get(key);
  if (existing) {
    if (existing.dataset.url) {
      URL.revokeObjectURL(existing.dataset.url);
    }
    existing.remove();
    activePreviews.delete(key);
    return;
  }

  if (!archives.has(archive)) {
    return;
  }

  const previewRow = document.createElement('tr');
  previewRow.className = 'blp-preview-row';
  const cell = document.createElement('td');
  cell.colSpan = 5;
  cell.innerHTML = '<div class="blp-preview-loading">Loading preview...</div>';
  previewRow.appendChild(cell);
  row.after(previewRow);
  activePreviews.set(key, previewRow);

  try {
    const png = await readBlpPreview(name);
    if (!activePreviews.has(key)) {
      return;
    }
    const blob = new Blob([png as unknown as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    previewRow.dataset.url = url;
    cell.innerHTML = `
      <div class="blp-preview-image">
        <img src="${url}" alt="${escapeHtml(name)}" />
      </div>
    `;
  } catch (e) {
    if (!activePreviews.has(key)) {
      return;
    }
    cell.innerHTML = `<div class="blp-preview-error">Failed to preview: ${escapeHtml(String(e))}</div>`;
  }
}


function optionIndex(values: number[], value: number): number {
  const i = values.indexOf(value);
  return i >= 0 ? i : 0;
}

function cycleChoice(choice: CharacterChoice, options: CharacterChoiceOptions, field: keyof CharacterChoice, delta: number): CharacterChoice {
  const map: Record<keyof CharacterChoice, number[]> = {
    skin: options.skins,
    face: options.faces,
    hairStyle: options.hairStyles,
    hairColor: options.hairColors,
    facialStyle: options.facialStyles,
    facialColor: options.hairColors,
  };
  const values = map[field];
  if (!values.length) return { ...choice };
  const next = values[(optionIndex(values, choice[field]), optionIndex(values, choice[field]) + delta + values.length) % values.length];
  const out = { ...choice, [field]: next } as CharacterChoice;
  if (field === 'hairColor') out.facialColor = next;
  return out;
}

/** The pixels a texture slot binds right now, which a re-composite can change. */
function texturePixels(payload: M2Payload, report: TextureReport): DecodedTexture | null {
  const appearance = payload.character?.appearance;
  if (report.textureType === 1) {
    return appearance?.body ?? null;
  }
  if (report.textureType === 6) {
    return appearance?.hair ?? null;
  }
  if (report.textureType === 8) {
    return appearance?.skinExtra ?? null;
  }
  return payload.textures.find((texture) => texture.index === report.index) ?? null;
}

function textureThumbnail(texture: DecodedTexture, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }
  const source = document.createElement('canvas');
  source.width = texture.width;
  source.height = texture.height;
  const sourceContext = source.getContext('2d');
  if (sourceContext) {
    const pixels = new Uint8ClampedArray(texture.rgba.length);
    pixels.set(texture.rgba);
    sourceContext.putImageData(new ImageData(pixels, texture.width, texture.height), 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, size, size);
  }
  return canvas;
}

/** The slot's role when it has no file of its own. */
function textureSlotName(textureType: number): string {
  switch (textureType) {
    case 1:
      return 'body (composited atlas)';
    case 2:
      return "item skin (bound to a worn object)";
    case 6:
      return 'hair';
    case 8:
      return 'extra skin (fur)';
    default:
      return 'unnamed slot';
  }
}

/** One row per texture slot: what it read, how big it is, and what binds it. */
function buildTexturePanel(payload: M2Payload, viewer: M2Viewer): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'm2-textures';
  // Nothing opens itself: every panel starts collapsed so the model or tile fills the view.
  details.open = false;

  const loaded = payload.textureReport.filter((t) => t.status === 'loaded').length;
  const summary = document.createElement('summary');
  summary.textContent = `Textures — ${loaded} of ${payload.textureReport.length} loaded`;
  details.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'm2-texture-list';
  for (const report of payload.textureReport) {
    const row = document.createElement('div');
    row.className = 'm2-texture-row';

    const pixels = report.status === 'loaded' ? texturePixels(payload, report) : null;
    if (pixels) {
      row.appendChild(textureThumbnail(pixels, 48));
    } else {
      const empty = document.createElement('div');
      empty.className = 'm2-texture-empty';
      empty.textContent = '?';
      row.appendChild(empty);
      row.classList.add('m2-texture-row-missing');
    }

    const meta = document.createElement('div');
    meta.className = 'm2-texture-meta';
    const name = document.createElement('div');
    name.className = 'm2-texture-name';
    name.textContent = report.filename ?? textureSlotName(report.textureType);
    const detail = document.createElement('div');
    detail.className = 'm2-texture-detail';
    const used = viewer.batchCountForTexture(report.index);
    detail.textContent =
      report.status === 'loaded'
        ? `slot ${report.index} · ${report.width}×${report.height} · ${used} batch${used === 1 ? '' : 'es'}`
        : `slot ${report.index} · ${report.status}${report.note ? ` · ${report.note}` : ''}`;
    meta.append(name, detail);
    row.appendChild(meta);
    list.appendChild(row);
  }
  details.appendChild(list);
  return details;
}

function characterSummary(appearance: CharacterAppearance, options: CharacterChoiceOptions): string {
  const c = appearance.choice;
  return `Skin ${optionIndex(options.skins, c.skin) + 1}/${options.skins.length || 1}` +
    ` | Face ${optionIndex(options.faces, c.face) + 1}/${options.faces.length || 1}` +
    ` | Hair ${optionIndex(options.hairStyles, c.hairStyle) + 1}/${options.hairStyles.length || 1}` +
    ` | Colour ${optionIndex(options.hairColors, c.hairColor) + 1}/${options.hairColors.length || 1}` +
    ` | Facial ${optionIndex(options.facialStyles, c.facialStyle) + 1}/${options.facialStyles.length || 1}`;
}

async function toggleM2Preview(row: HTMLTableRowElement): Promise<void> {
  const archive = row.getAttribute('data-archive');
  const name = row.getAttribute('data-name');
  if (!archive || !name) {
    return;
  }

  const key = previewKey(archive, name);
  const existing = activePreviews.get(key);
  if (existing) {
    const viewer = activeViewers.get(key);
    if (viewer) {
      viewer.dispose();
      activeViewers.delete(key);
    }
    existing.remove();
    activePreviews.delete(key);
    return;
  }

  if (!archives.has(archive)) {
    return;
  }

  const previewRow = document.createElement('tr');
  previewRow.className = 'm2-preview-row';
  const cell = document.createElement('td');
  cell.colSpan = 5;
  cell.innerHTML = '<div class="m2-preview-loading">Loading model...</div>';
  previewRow.appendChild(cell);
  row.after(previewRow);
  activePreviews.set(key, previewRow);

  try {
    const payload = await readM2Preview(name);
    if (!activePreviews.has(key)) {
      return;
    }

    // Build the viewer UI: canvas + controls.
    cell.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'm2-preview-container';

    const canvas = document.createElement('canvas');
    canvas.className = 'm2-canvas';
    container.appendChild(canvas);

    const controls = document.createElement('div');
    controls.className = 'm2-controls';

    const animSelect = document.createElement('select');
    animSelect.className = 'm2-anim-select';

    const playBtn = document.createElement('button');
    playBtn.textContent = 'Pause';

    const wireLabel = document.createElement('label');
    wireLabel.className = 'm2-wire-label';
    const wireCheck = document.createElement('input');
    wireCheck.type = 'checkbox';
    wireLabel.appendChild(wireCheck);
    wireLabel.appendChild(document.createTextNode(' Wireframe'));

    const info = document.createElement('span');
    info.className = 'm2-info';
    const loaded = `${payload.textures.length} texture(s)`;
    info.textContent = payload.character
      ? `${loaded} | ${characterSummary(payload.character.appearance, payload.character.options)}`
      : payload.characterError
        ? `${loaded} | character variants unavailable: ${payload.characterError}`
        : loaded;

    const charControls = document.createElement('span');
    charControls.className = 'm2-character-controls';

    controls.appendChild(animSelect);
    controls.appendChild(playBtn);
    controls.appendChild(wireLabel);
    controls.appendChild(charControls);
    controls.appendChild(info);
    container.appendChild(controls);
    cell.appendChild(container);

    const viewer = new M2Viewer(canvas, payload);
    activeViewers.set(key, viewer);

    await viewer.ready;
    if (!activeViewers.has(key)) {
      // Preview was closed while loading.
      viewer.dispose();
      return;
    }

    // What the model's texture slots read, and which of them came up empty.
    let texturePanel = buildTexturePanel(payload, viewer);
    container.appendChild(texturePanel);
    const dbcList = buildDbcList({
      read: payload.tables ?? [],
      onOpen: payload.character
        ? ['ItemDisplayInfo']
        : ['CreatureDisplayInfoExtra', 'CreatureSoundData', 'SoundEntries'],
      model: name,
    });
    if (dbcList) {
      container.appendChild(dbcList);
    }

    // Populate animation dropdown.
    const anims: AnimationInfo[] = viewer.animations;
    if (anims.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No animations';
      animSelect.appendChild(opt);
      animSelect.disabled = true;
    } else {
      anims.forEach((a) => {
        const opt = document.createElement('option');
        opt.value = String(a.index);
        opt.textContent = animationName(a.id);
        animSelect.appendChild(opt);
      });
      animSelect.addEventListener('change', () => {
        viewer.setAnimation(Number(animSelect.value));
      });
    }

    let playing = true;
    playBtn.addEventListener('click', () => {
      playing = !playing;
      viewer.setPlaying(playing);
      playBtn.textContent = playing ? 'Pause' : 'Play';
    });
    wireCheck.addEventListener('change', () => {
      viewer.setWireframe(wireCheck.checked);
    });

    if (viewer.character) {
      let character = viewer.character;
      const buttons: [string, keyof CharacterChoice][] = [
        ['Skin', 'skin'],
        ['Face', 'face'],
        ['Hair', 'hairStyle'],
        ['Colour', 'hairColor'],
        ['Facial', 'facialStyle'],
      ];
      const applyChoice = async (choice: CharacterChoice): Promise<void> => {
        info.textContent = 'Updating character...';
        try {
          const updated = await readM2Preview(name, choice);
          if (!updated.character || !activeViewers.has(key)) return;
          character = updated.character;
          viewer.applyCharacterAppearance(character.appearance);
          // The body and hair slots now hold the new look, so the list is rebuilt from it.
          payload.textures = updated.textures;
          payload.textureReport = updated.textureReport;
          const rebuilt = buildTexturePanel(payload, viewer);
          texturePanel.replaceWith(rebuilt);
          texturePanel = rebuilt;
          info.textContent = `${payload.textures.length} texture(s) | ${characterSummary(character.appearance, character.options)}`;
        } catch (e) {
          info.textContent = `Character update failed: ${String(e)}`;
        }
      };

      for (const [label, field] of buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.title = `Cycle ${label.toLowerCase()}`;
        btn.addEventListener('click', () => {
          const next = cycleChoice(character.appearance.choice, character.options, field, 1);
          void applyChoice(next);
        });
        charControls.appendChild(btn);
      }
    }
  } catch (e) {
    if (!activePreviews.has(key)) {
      return;
    }
    const viewer = activeViewers.get(key);
    if (viewer) {
      viewer.dispose();
      activeViewers.delete(key);
    }
    cell.innerHTML = `<div class="m2-preview-error">Failed to preview: ${escapeHtml(String(e))}</div>`;
  }
}


/** One row per MTEX entry: the thumbnail, which chunks draw it, and its size. */
function buildTerrainTexturePanel(payload: AdtPayload): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'm2-textures';
  details.open = false;

  const decoded = new Map(payload.decoded.map((t) => [t.name.toLowerCase(), t]));
  const summary = document.createElement('summary');
  summary.textContent = `Textures — ${decoded.size} of ${payload.textures.length} loaded`;
  details.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'm2-texture-list';
  for (const texture of payload.textures) {
    const pixels = decoded.get(texture.name.toLowerCase());
    const row = document.createElement('div');
    row.className = 'm2-texture-row';
    if (pixels) {
      row.appendChild(
        textureThumbnail(
          { index: 0, filename: texture.name, width: pixels.width, height: pixels.height, rgba: pixels.rgba },
          48
        )
      );
    } else {
      const empty = document.createElement('div');
      empty.className = 'm2-texture-empty';
      empty.textContent = '?';
      row.appendChild(empty);
      row.classList.add('m2-texture-row-missing');
    }
    const meta = document.createElement('div');
    meta.className = 'm2-texture-meta';
    const name = document.createElement('div');
    name.className = 'm2-texture-name';
    name.textContent = texture.name;
    const detail = document.createElement('div');
    detail.className = 'm2-texture-detail';
    detail.textContent = pixels
      ? `${texture.chunks} chunk${texture.chunks === 1 ? '' : 's'} · ${pixels.width}×${pixels.height}`
      : `${texture.chunks} chunk${texture.chunks === 1 ? '' : 's'} · missing`;
    meta.append(name, detail);
    row.appendChild(meta);
    list.appendChild(row);
  }
  details.appendChild(list);
  return details;
}

/** Every placed model of one kind, named and counted, and the toggle that draws them. */
function buildPlacementsPanel(
  payload: AdtPayload,
  viewer: TerrainViewer
): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'm2-textures terrain-placements';

  const doodads = payload.doodads.reduce((sum, d) => sum + d.count, 0);
  const wmos = payload.wmos.reduce((sum, w) => sum + w.count, 0);
  const summary = document.createElement('summary');
  summary.textContent = `Doodads and Buildings — ${doodads} doodad(s), ${wmos} building(s)`;
  details.appendChild(summary);

  const controls = document.createElement('div');
  controls.className = 'terrain-prop-controls';
  const status = document.createElement('span');
  status.className = 'm2-info';

  let loaded: PropsPayload | null = null;
  let loading = false;

  const toggles: { kind: 'doodad' | 'building'; input: HTMLInputElement }[] = [];
  for (const [kind, label, total] of [
    ['doodad', 'Doodads', doodads],
    ['building', 'Buildings', wmos],
  ] as [('doodad' | 'building'), string, number][]) {
    const wrapper = document.createElement('label');
    wrapper.className = 'terrain-prop-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.disabled = total === 0;
    wrapper.append(input, document.createTextNode(` ${label} (${total})`));
    input.addEventListener('change', () => {
      const want = input.checked;
      viewer.setPropsVisible(kind, want);
      if (want && !loaded && !loading) {
        void load();
      }
    });
    toggles.push({ kind, input });
    controls.appendChild(wrapper);
  }

  const load = async (): Promise<void> => {
    loading = true;
    status.textContent = 'reading models...';
    try {
      // One placement list for both kinds: the worker loads each model once and the viewer splits
      // the result by kind, so either toggle can come first.
      const items: {
        path: string;
        position: [number, number, number];
        rotation: [number, number, number];
        scale: number;
      }[] = [];
      for (const model of [...payload.doodads, ...payload.wmos]) {
        for (const placement of model.placements) {
          items.push({
            path: model.model,
            position: [placement[0], placement[1], placement[2]],
            rotation: [placement[3], placement[4], placement[5]],
            scale: placement[6],
          });
        }
      }
      const propPayload = await readPropsPreview(items);
      loaded = propPayload;
      viewer.setProps(propPayload);
      for (const toggle of toggles) {
        viewer.setPropsVisible(toggle.kind, toggle.input.checked);
      }
      const perKind = propPayload.batches.filter((b) => b.kind === 'doodad').length;
      const perBuilding = propPayload.batches.filter((b) => b.kind === 'building').length;
      status.textContent = [
        `${(propPayload.vertexCount / 1000).toFixed(0)}k vertex(es)`,
        `doodads in ${perKind} batch(es)`,
        `buildings in ${perBuilding} batch(es)`,
        propPayload.missingTextures.length ? `${propPayload.missingTextures.length} missing texture(s)` : '',
        propPayload.failed.length ? `${propPayload.failed.length} model(s) failed` : '',
        propPayload.skipped.length ? `${propPayload.skipped.length} model(s) over budget` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    } catch (e) {
      status.textContent = `could not read the placed models: ${String(e)}`;
      for (const toggle of toggles) toggle.input.checked = false;
      viewer.setPropsVisible('doodad', false);
      viewer.setPropsVisible('building', false);
    } finally {
      loading = false;
    }
  };

  controls.append(status);
  details.appendChild(controls);

  const list = document.createElement('div');
  list.className = 'm2-texture-list';
  const lines: [string, number, string][] = [
    ...payload.doodads.map((d): [string, number, string] => [d.model, d.count, 'doodad']),
    ...payload.wmos.map((w): [string, number, string] => [w.model, w.count, 'building']),
  ];
  for (const [model, count, kind] of lines.slice(0, 40)) {
    const row = document.createElement('div');
    row.className = 'terrain-placement';
    const name = document.createElement('span');
    name.className = 'm2-texture-name';
    name.textContent = model;
    const detail = document.createElement('span');
    detail.className = 'm2-texture-detail';
    detail.textContent = `${kind} ×${count}`;
    row.append(name, detail);
    list.appendChild(row);
  }
  if (lines.length > 40) {
    const more = document.createElement('div');
    more.className = 'terrain-placement';
    more.textContent = `…and ${lines.length - 40} more`;
    list.appendChild(more);
  }
  details.appendChild(list);
  return details;
}

async function toggleAdtPreview(row: HTMLTableRowElement): Promise<void> {
  const archive = row.getAttribute('data-archive');
  const name = row.getAttribute('data-name');
  if (!archive || !name) {
    return;
  }

  const key = previewKey(archive, name);
  const existing = activePreviews.get(key);
  if (existing) {
    activeViewers.get(key)?.dispose();
    activeViewers.delete(key);
    existing.remove();
    activePreviews.delete(key);
    return;
  }

  if (!archives.has(archive)) {
    return;
  }

  const previewRow = document.createElement('tr');
  previewRow.className = 'm2-preview-row';
  const cell = document.createElement('td');
  cell.colSpan = 5;
  cell.innerHTML = '<div class="m2-preview-loading">Reading the tile...</div>';
  previewRow.appendChild(cell);
  row.after(previewRow);
  activePreviews.set(key, previewRow);

  try {
    const payload = await readAdtPreview(name);
    if (!activePreviews.has(key)) {
      return;
    }

    cell.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'm2-preview-container';

    const canvas = document.createElement('canvas');
    canvas.className = 'm2-canvas terrain-canvas';
    container.appendChild(canvas);

    const controls = document.createElement('div');
    controls.className = 'm2-controls';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset view';

    const hint = document.createElement('span');
    hint.className = 'terrain-hint';
    hint.textContent = 'Drag to look · WASD fly · Space / C up, down · Shift 4× · Wheel speed';

    const info = document.createElement('span');
    info.className = 'm2-info';
    const textures = payload.textures.length;
    const doodads = payload.doodads.reduce((sum, d) => sum + d.count, 0);
    const wmos = payload.wmos.reduce((sum, w) => sum + w.count, 0);
    info.textContent =
      `${payload.chunks.length} chunks · ${payload.triangleCount.toLocaleString()} triangles · ` +
      (textures === 0
        ? 'no ground textures (an instance tile keeps its interior in a WMO) · '
        : `${textures} texture(s) · `) +
      `${doodads} doodad(s), ${wmos} building(s) · ` +
      `areas ${payload.areas
        .slice(0, 6)
        .map((area) => (area.name ? `${area.name} (${area.id})` : String(area.id)))
        .join(', ')}`;

    controls.append(resetBtn, hint, info);
    container.appendChild(controls);
    cell.appendChild(container);

    const viewer = new TerrainViewer(canvas, payload);
    activeViewers.set(key, viewer);
    await viewer.ready;
    if (!activeViewers.has(key)) {
      viewer.dispose();
      return;
    }
    resetBtn.addEventListener('click', () => viewer.reset());

    // Touch has no keyboard: two press-and-hold buttons do the flying.
    for (const [label, code] of [['↟ forward', 'KeyW'], ['↡ back', 'KeyS']] as [string, string][]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'terrain-touch';
      button.textContent = label;
      const press = (down: boolean) => viewer.setKey(code, down);
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        press(true);
      });
      button.addEventListener('pointerup', () => press(false));
      button.addEventListener('pointercancel', () => press(false));
      button.addEventListener('pointerleave', () => press(false));
      controls.insertBefore(button, hint);
    }

    container.appendChild(buildTerrainTexturePanel(payload));
    container.appendChild(buildPlacementsPanel(payload, viewer));
    const adtTables = buildDbcList({
      read: payload.tables ?? [],
      unread: [
        'GroundEffectTexture',
        'GroundEffectDoodad',
        'Light',
        'LightParams',
        'LightIntBand',
        'LightFloatBand',
        'SoundWaterType',
        'Map',
      ],
    });
    if (adtTables) {
      container.appendChild(adtTables);
    }
  } catch (e) {
    if (!activePreviews.has(key)) {
      return;
    }
    activeViewers.get(key)?.dispose();
    activeViewers.delete(key);
    cell.innerHTML = `<div class="m2-preview-error">Failed to preview: ${escapeHtml(String(e))}</div>`;
  }
}

/** A RIFF header's format, when the file has one; music is MP3 and has none. */
function wavFormat(bytes: Uint8Array): string | null {
  if (bytes.length < 44) return null;
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE') return null;
  let offset = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const id = text(offset);
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
    if (id === 'fmt ' && offset + 8 + 16 <= bytes.length) {
      const base = offset + 8;
      channels = bytes[base + 2] | (bytes[base + 3] << 8);
      rate = bytes[base + 4] | (bytes[base + 5] << 8) | (bytes[base + 6] << 16) | (bytes[base + 7] << 24);
      bits = bytes[base + 14] | (bytes[base + 15] << 8);
    } else if (id === 'data') {
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size & 1);
  }
  if (!channels || !rate) return null;
  const parts = [`${rate} Hz`, `${channels} channel${channels === 1 ? '' : 's'}`, `${bits}-bit`];
  if (dataBytes > 0 && bits > 0) {
    const seconds = dataBytes / (rate * channels * (bits / 8));
    parts.push(`${seconds.toFixed(2)} s`);
  }
  return parts.join(' · ');
}

/** The `SoundType` a kit is, for the one-line caption. */
function soundTypeName(type: number): string {
  switch (type) {
    case 1:
      return 'spell';
    case 2:
      return 'interface';
    case 3:
      return 'footstep';
    case 28:
      return 'zone music';
    case 50:
      return 'zone ambience';
    default:
      return `type ${type}`;
  }
}

async function toggleSoundPreview(row: HTMLTableRowElement): Promise<void> {
  const archive = row.getAttribute('data-archive');
  const name = row.getAttribute('data-name');
  if (!archive || !name) {
    return;
  }

  const key = previewKey(archive, name);
  const existing = activePreviews.get(key);
  if (existing) {
    activeViewers.get(key)?.dispose();
    activeViewers.delete(key);
    if (existing.dataset.url) {
      URL.revokeObjectURL(existing.dataset.url);
    }
    existing.remove();
    activePreviews.delete(key);
    return;
  }

  if (!archives.has(archive)) {
    return;
  }

  const previewRow = document.createElement('tr');
  previewRow.className = 'sound-preview-row';
  const cell = document.createElement('td');
  cell.colSpan = 5;
  cell.innerHTML = '<div class="blp-preview-loading">Loading sound...</div>';
  previewRow.appendChild(cell);
  row.after(previewRow);
  activePreviews.set(key, previewRow);

  try {
    const payload = await readSoundPreview(name);
    if (!activePreviews.has(key)) {
      return;
    }
    const lower = name.toLowerCase();
    const type = lower.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav';
    const url = URL.createObjectURL(
      new Blob([payload.bytes as unknown as BlobPart], { type })
    );
    previewRow.dataset.url = url;

    cell.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'sound-panel';

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = true;
    audio.src = url;
    audio.className = 'sound-player';
    panel.appendChild(audio);

    const info = document.createElement('div');
    info.className = 'sound-info';
    const format = wavFormat(payload.bytes);
    info.textContent = `${humanSize(payload.bytes.length)}${format ? ` · ${format}` : ''}`;
    panel.appendChild(info);

    if (payload.kits.length) {
      const kits = document.createElement('div');
      kits.className = 'sound-kits';
      for (const kit of payload.kits) {
        const line = document.createElement('div');
        line.className = 'sound-kit';
        const where =
          kit.distanceCutoff > 0
            ? `${kit.distanceCutoff} yd cutoff, ${kit.minDistance} yd full`
            : 'non-positional';
        line.textContent =
          `kit ${kit.id} "${kit.name}" · ${soundTypeName(kit.soundType)} · ` +
          `volume ${kit.volume.toFixed(2)} · ${where}`;
        kits.appendChild(line);
      }
      panel.appendChild(kits);
    } else {
      const none = document.createElement('div');
      none.className = 'sound-kit sound-kit-none';
      none.textContent = 'no SoundEntries kit names this file';
      panel.appendChild(none);
    }

    cell.appendChild(panel);
    const soundTables = buildDbcList({ read: payload.tables ?? [] });
    if (soundTables) {
      panel.appendChild(soundTables);
    }
    activeViewers.set(key, {
      dispose: () => {
        audio.pause();
        audio.src = '';
      },
    });
  } catch (e) {
    if (!activePreviews.has(key)) {
      return;
    }
    cell.innerHTML = `<div class="blp-preview-error">Failed to preview: ${escapeHtml(String(e))}</div>`;
  }
}


/** A number as the table shows it: ints plain, floats to what they need. */
function cellText(value: number | string | null, type: string | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (type === 'f32') {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }
  return String(value);
}

/**
 * A DBC as a table: column names from the schemas benilla ships, one page at a time, filtered by a
 * substring over every cell.
 */
function buildDbcPanel(sheet: DbcSheet, reload: (offset: number, limit: number, filter: string) => Promise<DbcSheet>): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'dbc-panel';

  let state: DbcSheet = sheet;
  let pageSize = 200;
  let offset = sheet.offset;
  let filter = '';

  const controls = document.createElement('div');
  controls.className = 'dbc-controls';

  const filterInput = document.createElement('input');
  filterInput.type = 'search';
  filterInput.className = 'dbc-filter';
  filterInput.placeholder = 'Filter any cell';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = 'Prev';
  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Next';
  const info = document.createElement('span');
  info.className = 'm2-info';

  const sizeSelect = document.createElement('select');
  for (const size of [100, 200, 1000]) {
    const option = document.createElement('option');
    option.value = String(size);
    option.textContent = String(size);
    if (size === pageSize) option.selected = true;
    sizeSelect.appendChild(option);
  }

  const caption = document.createElement('div');
  caption.className = 'dbc-caption';

  controls.append(filterInput, prev, next, sizeSelect, info);
  panel.append(controls, caption);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'dbc-table-wrap';
  panel.appendChild(tableWrap);

  const render = (): void => {
    const pages = Math.max(1, Math.ceil(state.matched / pageSize));
    const page = Math.floor(offset / pageSize) + 1;
    info.textContent =
      `${state.matched.toLocaleString()} of ${state.total.toLocaleString()} record(s) · ` +
      `${state.columns.length} column(s) · page ${page}/${pages}`;
    prev.disabled = offset === 0;
    next.disabled = offset + pageSize >= state.matched;

    const head = state.columns
      .map((name, index) => {
        const type = state.types?.[index];
        const kind = index === state.keyIndex ? ' class="dbc-key"' : '';
        return `<th${kind} title="${escapeHtml(type ?? 'raw')}">${escapeHtml(name)}</th>`;
      })
      .join('');
    const body = state.rows
      .map((row) => {
        const cells = row
          .map((value, index) => {
            const type = state.types?.[index];
            const text = cellText(value, type);
            const numeric = typeof value === 'number' ? ' class="num"' : '';
            return `<td${numeric}>${escapeHtml(text)}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    tableWrap.innerHTML = `<table class="dbc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };

  const load = async (): Promise<void> => {
    try {
      state = await reload(offset, pageSize, filter);
      render();
    } catch (e) {
      tableWrap.innerHTML = `<div class="blp-preview-error">Failed to read the table: ${escapeHtml(String(e))}</div>`;
    }
  };

  let filterTimer = 0;
  filterInput.addEventListener('input', () => {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      filter = filterInput.value.trim();
      offset = 0;
      void load();
    }, 200);
  });
  prev.addEventListener('click', () => {
    offset = Math.max(0, offset - pageSize);
    void load();
  });
  next.addEventListener('click', () => {
    offset += pageSize;
    void load();
  });
  sizeSelect.addEventListener('change', () => {
    pageSize = Number(sizeSelect.value);
    offset = 0;
    void load();
  });

  // `Spell` and friends are listed in benilla as `F0..Fn`: a slot count the loader walks by hand,
  // not a set of names, so say so rather than presenting placeholders as column names.
  const generic = state.columns.length > 0 && state.columns.every((name) => /^F\d+$/.test(name));
  const shape = `${state.fieldCount} slots per record, ${state.recordCount.toLocaleString()} records`;
  caption.textContent = state.schema
    ? `schema ${state.schema} — ${shape}${generic ? ' · slots only: this table ships no column names' : ''}` +
      (state.note ? ` · ${state.note}` : '')
    : `${state.note ?? 'no schema'} — ${shape}`;

  render();
  return panel;
}

async function toggleDbcPreview(row: HTMLTableRowElement): Promise<void> {
  const archive = row.getAttribute('data-archive');
  const name = row.getAttribute('data-name');
  if (!archive || !name) {
    return;
  }

  const key = previewKey(archive, name);
  const existing = activePreviews.get(key);
  if (existing) {
    existing.remove();
    activePreviews.delete(key);
    return;
  }

  const previewRow = document.createElement('tr');
  previewRow.className = 'dbc-preview-row';
  const cell = document.createElement('td');
  cell.colSpan = 5;
  cell.innerHTML = '<div class="blp-preview-loading">Reading the table...</div>';
  previewRow.appendChild(cell);
  row.after(previewRow);
  activePreviews.set(key, previewRow);

  try {
    const sheet = await readDbcSheet(name);
    if (!activePreviews.has(key)) {
      return;
    }
    cell.innerHTML = '';
    cell.appendChild(
      buildDbcPanel(sheet, (offset, limit, filter) => readDbcSheet(name, offset, limit, filter))
    );
  } catch (e) {
    if (!activePreviews.has(key)) {
      return;
    }
    cell.innerHTML = `<div class="blp-preview-error">Failed to read the table: ${escapeHtml(String(e))}</div>`;
  }
}

/** The body slots `CreatureDisplayInfoExtra.equipment` fills, in column order. */
const EXTRA_SLOTS = [
  'head',
  'shoulder',
  'shirt',
  'chest',
  'belt',
  'pants',
  'boots',
  'wrist',
  'gloves',
  'tabard',
];

/** One click away from a `.wav` played in place, the row showing what the kit resolves to. */
function playKitFile(path: string, label = '▶ play'): HTMLSpanElement {
  const holder = document.createElement('span');
  holder.className = 'voice-play';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'voice-play-button';
  button.textContent = label;
  button.title = path;
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'reading...';
    void (async () => {
      try {
        const payload = await readSoundPreview(path);
        const url = URL.createObjectURL(
          new Blob([payload.bytes as unknown as BlobPart], {
            type: path.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
          })
        );
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.autoplay = true;
        audio.className = 'voice-player';
        audio.src = url;
        audio.addEventListener('ended', () => URL.revokeObjectURL(url));
        holder.replaceChildren(audio);
      } catch (e) {
        button.disabled = false;
        button.textContent = label;
        holder.append(` ${String(e)}`);
      }
    })();
  });
  holder.appendChild(button);
  return holder;
}

/** What a `DBCs (n)` panel shows for one preview. */
interface DbcPanelOptions {
  /** The tables the preview itself read. */
  read: string[];
  /** Tables this panel opens on demand, counted in the title but not read yet. */
  onOpen?: string[];
  /** Tables the client reads for the same asset that neither this preview nor this panel does. */
  unread?: string[];
  /** A model path: the panel also lists the rows these tables reach, by id. */
  model?: string;
}

/**
 * Every DBC table behind a preview, under one panel: what it read, what this panel reads when
 * opened, and for a model the rows those tables reach by id. An M2 has no customization table of
 * its own, so its sections are the whole answer: a creature's variation is its
 * `CreatureDisplayInfo` row (three skins, a scale, an alpha) over one `CreatureModelData` row, its
 * voice is `CreatureSoundData` resolved through that row, and an effect's is the
 * `SpellVisualKit` slot firing its `SpellVisualEffectName`.
 */
function buildDbcList(options: DbcPanelOptions): HTMLDetailsElement | null {
  const { read, onOpen = [], unread = [], model } = options;
  const tables = [...read, ...onOpen];
  if (!tables.length) {
    return null;
  }
  const details = document.createElement('details');
  details.className = 'm2-textures dbc-list';
  const summary = document.createElement('summary');
  summary.textContent = `DBCs (${tables.length})`;
  const list = document.createElement('div');
  list.className = 'm2-texture-list';
  details.append(summary, list);

  const tableRow = (name: string, note: string): HTMLDivElement => {
    const row = document.createElement('div');
    row.className = 'terrain-placement';
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'm2-texture-name tables-read-link';
    link.textContent = `DBFilesClient\\${name}.dbc`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void openTableInListing(`DBFilesClient\\${name}.dbc`);
    });
    const detail = document.createElement('span');
    detail.className = 'm2-texture-detail';
    detail.textContent = note;
    row.append(link, detail);
    return row;
  };

  for (const name of read) {
    list.appendChild(tableRow(name, 'read to build this preview'));
  }
  for (const name of onOpen) {
    list.appendChild(tableRow(name, 'read when you open this panel'));
  }
  if (unread.length) {
    const more = document.createElement('div');
    more.className = 'tables-read-alsoread';
    more.textContent = `The client also reads ${unread.join(', ')} for this; this preview does not.`;
    list.appendChild(more);
  }

  if (model) {
    let requested = false;
    details.addEventListener('toggle', () => {
      if (details.open && !requested) {
        requested = true;
        void fillModelReferences(list, model);
      }
    });
  }
  return details;
}

/** The rows a model's tables reach by id: one helper per row shape the panel draws. */
function buildModelReferenceBlocks(list: HTMLDivElement): {
  line: (label: Node | string, detail: string) => HTMLDivElement;
  heading: (text: string) => HTMLDivElement;
  link: (text: string, table: string, row?: number) => HTMLAnchorElement;
} {
  const line = (label: Node | string, detail: string): HTMLDivElement => {
    const row = document.createElement('div');
    row.className = 'refs-row';
    if (typeof label === 'string') {
      const span = document.createElement('span');
      span.className = 'm2-texture-name';
      span.textContent = label;
      row.appendChild(span);
    } else {
      row.appendChild(label);
    }
    const info = document.createElement('span');
    info.className = 'm2-texture-detail';
    info.textContent = detail;
    row.appendChild(info);
    return row;
  };
  const heading = (text: string): HTMLDivElement => {
    const div = document.createElement('div');
    div.className = 'tables-read-alsoread refs-heading';
    div.textContent = text;
    return div;
  };
  const link = (text: string, table: string, row?: number): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'm2-texture-name tables-read-link';
    a.textContent = text;
    a.addEventListener('click', (event) => {
      event.preventDefault();
      void openTableInListing(`DBFilesClient\\${table}.dbc`, row === undefined ? undefined : String(row));
    });
    return a;
  };
  void list;
  return { line, heading, link };
}

/** Load and render a model's reference rows into the `DBCs` panel that was just opened. */
async function fillModelReferences(list: HTMLDivElement, path: string): Promise<void> {
  const { line, heading, link } = buildModelReferenceBlocks(list);
  try {
    const [refs, voice] = await Promise.all([
      sendMessage('readRefs', { path }) as Promise<ModelRefsPayload>,
      readCreatureVoice(path).catch((e: unknown) => ({ error: String(e) }) as unknown as CreatureVoicePayload),
    ]);
    const voiceData = voice && !('error' in voice) ? voice : null;
    if (refs.hits.length || voiceData?.voices.length) {
      list.appendChild(heading(`Rows these tables reach — ${refs.model}`));
    }
    if (voice && 'error' in voice) {
      list.appendChild(line('creature voice', `unavailable: ${String(voice.error)}`));
    }
    if (!refs.hits.length) {
      list.appendChild(
        line('unused art', `no DBC row, of the ${refs.tables} tables read, spells this path`)
      );
    }
    // One row per table and column, since a shared weapon model sits in hundreds of records.
    const groups = new Map<
      string,
      { table: string; column: string; rows: number[]; spelling: string; nameOnly: boolean }
    >();
    for (const hit of refs.hits) {
      const key = `${hit.table}.${hit.column}`;
      const group =
        groups.get(key) ??
        { table: hit.table, column: hit.column, rows: [], spelling: hit.spelling, nameOnly: hit.nameOnly };
      group.rows.push(hit.row);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const shown = group.rows.slice(0, 6).join(', ');
      const more = group.rows.length > 6 ? `, and ${group.rows.length - 6} more` : '';
      const spelling = group.nameOnly
        ? `${group.spelling} (a file name: the client reads it from Item\\ObjectComponents\\)`
        : group.spelling;
      list.appendChild(
        line(
          link(`${group.table}.${group.column}`, group.table, group.rows[0]),
          `${group.rows.length} row(s): ${shown}${more} · ${spelling}`
        )
      );
    }
    if (refs.displays.length) {
      const character = path.toLowerCase().startsWith('character\\');
      list.appendChild(
        heading(
          character
            ? `NPC display rows — ${refs.displays.length} that wear this body`
            : `Creature display rows — ${refs.displays.length}, the whole variation a creature has`
        )
      );
      if (character) {
        list.appendChild(
          line(
            'character body',
            'built from CharSections, CharHairGeosets and CharacterFacialHairStyles per race and sex: no table names this file'
          )
        );
      }
      for (const display of refs.displays.slice(0, 12)) {
        const scale = Number.isInteger(display.scale) ? display.scale.toFixed(0) : display.scale.toFixed(2);
        const look =
          display.race !== null
            ? `character composite · race ${display.race} · ${display.sex === 0 ? 'male' : 'female'}`
            : `skins ${display.skins.map((skin) => skin ?? '—').join(', ')}`;
        list.appendChild(
          line(
            link(`display ${display.id}`, 'CreatureDisplayInfo', display.id),
            `scale ${scale} · alpha ${display.alpha.toFixed(2)} · ${look}`
          )
        );
      }
      if (refs.displays.length > 12) {
        list.appendChild(line('', `and ${refs.displays.length - 12} more display row(s)`));
      }
    }
    if (voiceData && voiceData.voices.length) {
      list.appendChild(
        heading(`Creature voice — ${voiceData.voices.length} CreatureSoundData row(s)`)
      );
      for (const group of voiceData.voices) {
        const used =
          group.displays.length === voiceData.displays
            ? `all ${group.displays.length} display(s)`
            : `${group.displays.length} of ${voiceData.displays} display(s)`;
        list.appendChild(
          line(
            link(`CreatureSoundData row ${group.row}`, 'CreatureSoundData', group.row),
            `${used} · ${group.events.length} event(s)`
          )
        );
        for (const event of group.events) {
          const kitLabel = link(`kit ${event.kit}`, 'SoundEntries', event.kit);
          const name = event.name && event.name !== 'null' ? ` "${event.name}"` : '';
          const row = document.createElement('div');
          row.className = 'refs-row refs-voice-row';
          const head = document.createElement('div');
          head.className = 'm2-texture-name';
          head.append(`${event.event} · `, kitLabel, name);
          const detail = document.createElement('div');
          detail.className = 'm2-texture-detail';
          if (event.files.length) {
            const bits = [`${event.files.length} file(s)`];
            if (event.volume !== undefined) bits.push(`vol ${event.volume.toFixed(2)}`);
            if (event.cutoff) bits.push(`${event.cutoff.toFixed(0)} yd cutoff`);
            bits.push(event.files[0]);
            detail.textContent = bits.join(' · ');
            const holder = document.createElement('div');
            holder.className = 'refs-voice-play';
            // A kit's variations are alternate takes: label each by its position so two buttons
            // are not two anonymous plays.
            const letters = ['A', 'B', 'C'];
            const shown = event.files.slice(0, letters.length);
            shown.forEach((variation, index) => {
              holder.appendChild(
                playKitFile(variation, shown.length === 1 ? '▶ play' : `▶ ${letters[index]}`)
              );
            });
            row.append(head, detail, holder);
          } else {
            detail.textContent = 'the kit names no file';
            row.append(head, detail);
          }
          list.appendChild(row);
        }
      }
    }
    if (voiceData) {
      if (voiceData.extraTotal === 0) {
        list.appendChild(heading('Creature display extras — none'));
        list.appendChild(
          line(
            'plain creature',
            `all ${voiceData.displays} display(s) have ExtendedDisplayInfoID 0: no NPC body composite, no worn items`
          )
        );
      } else {
        list.appendChild(
          heading(
            `Creature display extras — ${voiceData.extraTotal} display(s) composite a character body`
          )
        );
        for (const extra of voiceData.extras.slice(0, 12)) {
          const worn = extra.equipment
            .map((id, index) => (id ? link(`${EXTRA_SLOTS[index]} ${id}`, 'ItemDisplayInfo', id) : null))
            .filter((value): value is HTMLAnchorElement => value !== null);
          const row = document.createElement('div');
          row.className = 'refs-row';
          const head = document.createElement('div');
          head.className = 'm2-texture-name';
          head.append(link(`extra ${extra.id}`, 'CreatureDisplayInfoExtra', extra.id));
          const detail = document.createElement('div');
          detail.className = 'm2-texture-detail';
          detail.textContent =
            `race ${extra.race} · ${extra.sex === 0 ? 'male' : 'female'} · skin ${extra.skin} · ` +
            `face ${extra.face} · hair ${extra.hairStyle}/${extra.hairColor}` +
            (extra.facialHair ? ` · facial ${extra.facialHair}` : '') +
            ` · ${extra.displays.length} display(s)` +
            (extra.baked ? ` · baked ${extra.baked}` : '');
          row.append(head, detail);
          if (worn.length) {
            const items = document.createElement('div');
            items.className = 'm2-texture-detail refs-items';
            worn.forEach((a, index) => {
              if (index) items.append(' · ');
              items.appendChild(a);
            });
            row.appendChild(items);
          }
          list.appendChild(row);
        }
        if (voiceData.extraTotal > voiceData.extras.length) {
          list.appendChild(
            line('', `and ${voiceData.extraTotal - voiceData.extras.length} more display(s) with an extra row`)
          );
        }
      }
    }
    if (refs.kits.length) {
      list.appendChild(heading(`Spell visual kits — ${refs.kits.length} slot(s) fire this model`));
      for (const kit of refs.kits.slice(0, 12)) {
        list.appendChild(
          line(link(`kit ${kit.kit}`, 'SpellVisualKit', kit.kit), `${kit.slot} slot · effect ${kit.effect}`)
        );
      }
      if (refs.kits.length > 12) {
        list.appendChild(line('', `and ${refs.kits.length - 12} more slot(s)`));
      }
    }
    if (refs.unreadable.length) {
      const note = document.createElement('div');
      note.className = 'tables-read-alsoread';
      note.textContent =
        `${refs.unreadable.length} table(s) still have no column names: benilla has no schema for them and ` +
        `their VanillaDBDefs .dbd blocks describe a different column count, so their cells stay unread as ` +
        `text: ${refs.unreadable.slice(0, 6).join(', ')}` +
        (refs.unreadable.length > 6 ? `, and ${refs.unreadable.length - 6} more` : '');
      list.appendChild(note);
    }
  } catch (e) {
    list.appendChild(line('references', `unavailable: ${String(e)}`));
  }
}

/** Filter the listing to one DBC and open it where it sits, optionally filtered to a row. */
async function openTableInListing(path: string, rowFilter?: string): Promise<void> {
  filterInput.value = path;
  applyFilter();
  const row = [...tableContainer.querySelectorAll<HTMLTableRowElement>('tbody > tr')].find(
    (candidate) => candidate.getAttribute('data-name')?.toLowerCase() === path.toLowerCase()
  );
  if (!row) {
    setStatus(`${path} is not in the mounted archives.`);
    return;
  }
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!row.classList.contains('dbc-preview-trigger')) {
    return;
  }
  const key = previewKey(row.getAttribute('data-archive') ?? '', row.getAttribute('data-name') ?? '');
  if (!activePreviews.has(key)) {
    await toggleDbcPreview(row);
  }
  if (rowFilter) {
    const preview = activePreviews.get(key);
    const input = preview?.querySelector<HTMLInputElement>('.dbc-filter');
    if (input) {
      input.value = rowFilter;
      input.dispatchEvent(new Event('input'));
    }
  }
}

function handleTableClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const row = target.closest('tbody > tr') as HTMLTableRowElement | null;
  if (!row) {
    return;
  }
  if (row.classList.contains('blp-preview-trigger')) {
    event.preventDefault();
    void toggleBlpPreview(row);
  } else if (row.classList.contains('m2-preview-trigger')) {
    event.preventDefault();
    void toggleM2Preview(row);
  } else if (row.classList.contains('adt-preview-trigger')) {
    event.preventDefault();
    void toggleAdtPreview(row);
  } else if (row.classList.contains('sound-preview-trigger')) {
    event.preventDefault();
    void toggleSoundPreview(row);
  } else if (row.classList.contains('dbc-preview-trigger')) {
    event.preventDefault();
    void toggleDbcPreview(row);
  }
}

pickButton.addEventListener('click', onPickFolder);
void loadFromServer();
filterInput.addEventListener('input', applyFilter);
prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));
pageSizeSelect.addEventListener('change', () => setPageSize(Number(pageSizeSelect.value)));
tableContainer.addEventListener('click', handleTableClick);
