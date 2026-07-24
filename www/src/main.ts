import {
  M2Viewer,
  type M2Payload,
  type AnimationInfo,
  type CharacterAppearance,
  type CharacterChoice,
  type CharacterChoiceOptions,
} from './m2viewer';
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
const archiveFiles = new Map<string, File>();
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

interface WorkerResponse {
  type: string;
  id?: number;
  entries?: MpqEntry[];
  png?: Uint8Array;
  payload?: M2Payload;
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
      } else if (data.type === 'listResult') {
        pending.resolve(data.entries as unknown);
      } else if (data.type === 'blpResult') {
        pending.resolve(data.png as unknown);
      } else if (data.type === 'm2Result') {
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

function listArchive(path: string, file: File): Promise<MpqEntry[]> {
  return sendMessage<MpqEntry[]>('list', { path, file });
}

function readBlpPreview(path: string, file: File, name: string): Promise<Uint8Array> {
  return sendMessage<Uint8Array>('readBlp', { file, path, name });
}

function readM2Preview(path: string, file: File, name: string, characterChoice?: CharacterChoice): Promise<M2Payload> {
  return sendMessage<M2Payload>('readM2', {
    file,
    path,
    name,
    characterChoice,
    archives: Array.from(archiveFiles, ([archivePath, archiveFile]) => ({
      path: archivePath,
      file: archiveFile,
    })),
  });
}

/** WebGL viewers keyed by preview key so we can dispose them on teardown. */
const activeViewers = new Map<string, M2Viewer>();

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
          (e) => {
            const lower = e.name.toLowerCase();
            const isBlp = lower.endsWith('.blp');
            const isM2 = lower.endsWith('.m2');
            const triggerClass = isBlp
              ? 'blp-preview-trigger'
              : isM2
                ? 'm2-preview-trigger'
                : '';
            return `
        <tr class="${triggerClass}" data-archive="${escapeHtml(e.archive)}" data-name="${escapeHtml(e.name)}">
          <td>${escapeHtml(e.archive)}</td>
          <td class="path">${escapeHtml(e.name)}</td>
          <td class="num">${humanSize(e.size)}</td>
          <td class="num">${humanSize(e.compressed_size)}</td>
          <td>
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
  tableContainer.innerHTML = '';
  statsEl.textContent = '';
  filterInput.hidden = true;
  filterInput.value = '';
  paginationEl.hidden = true;
  allEntries = [];
  filteredEntries = [];
  currentPage = 0;
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

  if (mpqFiles.length === 0) {
    setStatus('No .mpq files found in the selected folder.');
    pickButton.disabled = false;
    return;
  }

  terminateWorker();
  archiveFiles.clear();
  for (const { path, handle } of mpqFiles) {
    archiveFiles.set(path, await handle.getFile());
  }

  setStatus(`Found ${mpqFiles.length} MPQ archive(s). Reading headers and tables...`);
  setProgress(0, mpqFiles.length);

  const loaded: MpqEntry[] = [];

  for (let i = 0; i < mpqFiles.length; i++) {
    const { path } = mpqFiles[i];
    setStatus(`Listing ${path} (${i + 1}/${mpqFiles.length})...`);
    try {
      const file = archiveFiles.get(path)!;
      const entries = await listArchive(path, file);
      loaded.push(...entries);
    } catch (e) {
      console.error(`Failed to list ${path}:`, e);
      loaded.push({
        archive: path,
        name: `ERROR: ${e}`,
        size: 0,
        compressed_size: 0,
        flags: 0,
        compressed: false,
        encrypted: false,
        single_unit: false,
        exists: true,
      });
    }
    setProgress(i + 1, mpqFiles.length);
  }

  hideProgress();
  allEntries = loaded;
  filteredEntries = allEntries.slice();
  filterInput.hidden = false;
  paginationEl.hidden = false;
  pageSizeSelect.value = String(DEFAULT_PAGE_SIZE);
  currentPage = 0;
  setStatus(`Done. Listed ${allEntries.length.toLocaleString()} file(s) from ${mpqFiles.length} archive(s).`);
  renderPage();
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

  const file = archiveFiles.get(archive);
  if (!file) {
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
    const png = await readBlpPreview(archive, file, name);
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

  const file = archiveFiles.get(archive);
  if (!file) {
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
    const payload = await readM2Preview(archive, file, name);
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
    info.textContent = payload.character
      ? `${payload.textures.length} texture(s) | ${characterSummary(payload.character.appearance, payload.character.options)}`
      : `${payload.textures.length} texture(s)`;

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
          const updated = await readM2Preview(archive, file, name, choice);
          if (!updated.character || !activeViewers.has(key)) return;
          character = updated.character;
          viewer.applyCharacterAppearance(character.appearance);
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
  }
}

pickButton.addEventListener('click', onPickFolder);
filterInput.addEventListener('input', applyFilter);
prevPageBtn.addEventListener('click', () => goToPage(currentPage - 1));
nextPageBtn.addEventListener('click', () => goToPage(currentPage + 1));
pageSizeSelect.addEventListener('change', () => setPageSize(Number(pageSizeSelect.value)));
tableContainer.addEventListener('click', handleTableClick);
