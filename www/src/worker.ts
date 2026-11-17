/**
 * The archive worker: every format read goes through the benilla client's own code, compiled to
 * wasm. `benilla-mpq` lists and decompresses the archives, `benilla-blp` decodes textures,
 * `benilla-formats` builds the M2 submeshes and animation keys, and the DBC tables drive the
 * character composite.
 *
 * The archives stay on disk: the wasm reader calls back for one byte range at a time, answered
 * here from a `File` (folder picker) or a synchronous range request (the local server).
 */
import init, { Client, M2 } from '../vendor/benilla-web/benilla_web.js';

interface ArchiveRef {
  name: string;
  size: number;
  /** The server's archive endpoint; absent when the page read a picked folder's `File`. */
  url?: string;
  file?: File;
}

interface LoadMessage {
  type: 'load';
  id: number;
  archives: ArchiveRef[];
}

interface ReadBlpMessage {
  type: 'readBlp';
  id: number;
  name: string;
}

interface ReadM2Message {
  type: 'readM2';
  id: number;
  name: string;
  characterChoice?: CharacterChoice;
}

interface ReadAdtMessage {
  type: 'readAdt';
  id: number;
  name: string;
}

interface ReadSoundMessage {
  type: 'readSound';
  id: number;
  name: string;
}

interface ReadPropsMessage {
  type: 'readProps';
  id: number;
  items: {
    path: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: number;
  }[];
}

interface ReadRefsMessage {
  type: 'readRefs';
  id: number;
  path: string;
}

interface ReadVoiceMessage {
  type: 'readVoice';
  id: number;
  path: string;
}

interface ReadDbcMessage {
  type: 'readDbc';
  id: number;
  name: string;
  offset: number;
  limit: number;
  filter: string;
}

type WorkerMessage =
  | LoadMessage
  | ReadBlpMessage
  | ReadM2Message
  | ReadAdtMessage
  | ReadSoundMessage
  | ReadDbcMessage
  | ReadPropsMessage
  | ReadRefsMessage
  | ReadVoiceMessage;

interface DecodedTexture {
  index: number;
  filename: string;
  width: number;
  height: number;
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

/** A creature's voice and NPC body data, reached from its `CreatureDisplayInfo` rows. */
export interface CreatureVoicePayload {
  /** Displays naming the model. */
  displays: number;
  /** One entry per `CreatureSoundData` row, deduplicated: 14 kobold displays share one. */
  voices: {
    row: number;
    displays: number[];
    events: {
      event: string;
      kit: number;
      /** `SoundEntries.Name`, or null for a kit row that names none. */
      name: string | null;
      volume?: number;
      cutoff?: number;
      /** The kit's variation files, in weight order: the ones a play button can open. */
      files: string[];
    }[];
  }[];
  /** `CreatureDisplayInfoExtra` looks, deduplicated by appearance, capped at 40 rows. */
  extras: {
    id: number;
    race: number;
    sex: number;
    skin: number;
    face: number;
    hairStyle: number;
    hairColor: number;
    facialHair: number;
    baked: string | null;
    /** Worn `ItemDisplayInfo` ids by slot: head, shoulder, shirt, chest, belt, pants, boots,
     * wrist, gloves, tabard. 0 is empty. */
    equipment: number[];
    displays: number[];
  }[];
  /** Displays with an `ExtendedDisplayInfoID`, before the 40-row cap. */
  extraTotal: number;
}

/** One cell that spells a model path, and the id-reached rows behind it. */
export interface ModelRefsPayload {
  /** The path as the cache resolves it (lowercase, `.mdx` as `.m2`). */
  model: string;
  hits: { table: string; column: string; row: number; spelling: string; nameOnly: boolean }[];
  /** Tables read, and tables whose cells carry no types. */
  tables: number;
  unreadable: string[];
  /** `CreatureDisplayInfo` rows naming the matched model rows: the whole per-creature variation. */
  displays: {
    id: number;
    scale: number;
    alpha: number;
    skins: (string | null)[];
    /** Set for a character-model display: the composite keys on race and sex, not skin slots. */
    race: number | null;
    sex: number | null;
  }[];
  /** `SpellVisualKit` slots firing the matched `SpellVisualEffectName` rows. */
  kits: { kit: number; effect: number; slot: string }[];
}

/** What one texture slot of the model resolved to, for the page's texture list. */
interface TextureReport {
  /** The slot in the model's texture list, which batches bind by. */
  index: number;
  /** The file read, or what the slot is (a composited body, an empty record). */
  filename: string | null;
  /** 0 a file, 1 the body atlas, 2 an item's skin, 6 hair, 8 the extra skin. */
  textureType: number;
  width: number;
  height: number;
  status: 'loaded' | 'missing' | 'unsupported';
  /** Why a slot did not load, when it did not. */
  note?: string;
}

interface M2Payload {
  m2Bytes: Uint8Array;
  /** The model's folder, which its skin records are named beside. */
  modelDir: string;
  /** The `Monster1/2/3` variations the creature tables give this model. */
  skins: (string | null)[];
  textures: DecodedTexture[];
  /** Every texture slot, decoded or not, in slot order. */
  textureReport: TextureReport[];
  character: CharacterPayload | null;
  characterError?: string;
  /** The DBC tables this preview read to build itself. */
  tables: string[];
}

/** The tables a creature model's preview reads: the display rows and the model rows. */
const CREATURE_TABLES = ['CreatureDisplayInfo', 'CreatureModelData'];
/** The tables a character preview reads: the composite, the hair geosets and the dials. */
const CHARACTER_TABLES = [
  'ChrRaces',
  'CharBaseInfo',
  'CharStartOutfit',
  'NameGen',
  'CharSections',
  'CharHairGeosets',
  'CharacterFacialHairStyles',
  'HelmetGeosetVisData',
];

/** One MTEX entry: the file, and how many chunks of the tile draw it. */
interface AdtTexture {
  name: string;
  chunks: number;
}

/** One MCLQ block: its grid geometry and what fills it. */
interface AdtLiquid {
  positions: Float32Array;
  indices: Uint32Array;
  kind: string;
}

/** One MCNK: geometry, layer slots, atlas corners, liquids. */
interface AdtChunk {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Texture-array index per layer slot; `-1` where the chunk has no such layer. */
  layers: Uint32Array;
  /** The chunk's corner in the alpha atlas, in texels; null with one layer. */
  alphaAtlas: Float32Array | null;
  shadowAtlas: Float32Array | null;
  liquids: AdtLiquid[];
  areaId: number;
  impassable: boolean;
}

/** A terrain tile as `adt_to_tile_mesh` builds it, plus the layer textures decoded here. */
interface AdtPayload {
  textures: AdtTexture[];
  /** The layer textures that decoded, by MTEX name. */
  decoded: { name: string; width: number; height: number; rgba: Uint8Array }[];
  chunks: AdtChunk[];
  /** `AreaTable` ids under the tile, named by the table. */
  areas: { id: number; name: string }[];
  /** Placed models: `placements` is `[x, y, z, rx, ry, rz, scale]` per instance. */
  doodads: PlacedModel[];
  wmos: PlacedModel[];
  /** The DBC tables this preview read to build itself. */
  tables: string[];
  /** RGBA `alphaAtlasSide`², one 64-texel tile per chunk that blends more than one layer. */
  alphaAtlas: Uint8Array;
  alphaAtlasSide: number;
  /** One byte per texel, 255 shadowed; a tile per chunk with an MCSH map. */
  shadowAtlas: Uint8Array;
  shadowAtlasSide: number;
  vertexCount: number;
  triangleCount: number;
}

/** One page of a DBC, column names from the schemas benilla ships. */
interface DbcSheet {
  path: string;
  columns: string[];
  rows: (number | string | null)[][];
  /** Records in the file. */
  total: number;
  /** Records the filter kept. */
  matched: number;
  offset: number;
  /** The schema's table name, or null when no schema fits the file. */
  schema: string | null;
  keyIndex: number | null;
  /** Per column: u32, i32, f32 or string. */
  types?: string[];
  note?: string;
  recordCount: number;
  fieldCount: number;
}

/** A placed model and every placement of it in a tile. */
interface PlacedModel {
  model: string;
  count: number;
  placements: Float32Array[];
}

/** Doodads and buildings baked into world space, one entry per merged batch. */
interface PropsPayload {
  textures: { name: string; width: number; height: number; rgba: Uint8Array }[];
  batches: {
    model: string;
    kind: 'doodad' | 'building';
    /** Index into `textures`; -1 for a batch with no texture. */
    texture: number;
    blend: number;
    twoSided: boolean;
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
  }[];
  failed: { model: string; error: string }[];
  skipped: { model: string; count: number }[];
  missingTextures: string[];
  vertexCount: number;
}

/** A sound file and the `SoundEntries` kits that play it. */
interface SoundPayload {
  path: string;
  bytes: Uint8Array;
  /** The DBC tables this preview read. */
  tables: string[];
  kits: {
    id: number;
    soundType: number;
    name: string;
    volume: number;
    minDistance: number;
    distanceCutoff: number;
  }[];
}

interface Listing {
  names: string[];
  archive: Uint16Array;
  size: Uint32Array;
  compressed: Uint32Array;
  flags: Uint32Array;
}

let client: Client | null = null;
let archives: ArchiveRef[] = [];
let initPromise: Promise<unknown> | null = null;

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[mpqbrowser worker]', ...args);
}

/** A synchronous range read, the shape `benilla_mpq::Source` asks for inside wasm. */
function readRange(id: number, offset: number, length: number): Uint8Array {
  const archive = archives[id];
  if (!archive) {
    throw new Error(`read from unknown archive ${id}`);
  }
  if (length <= 0) {
    return new Uint8Array(0);
  }
  const end = Math.min(offset + length, archive.size);

  if (archive.file) {
    const reader = new FileReaderSync();
    const buffer = reader.readAsArrayBuffer(archive.file.slice(offset, end));
    return new Uint8Array(buffer);
  }

  // A worker may issue a synchronous request, which is what lets wasm's reader stay
  // synchronous while the bytes stay on the server's disk.
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `${archive.url}?offset=${offset}&length=${end - offset}`, false);
  xhr.responseType = 'arraybuffer';
  xhr.send();
  if (xhr.status !== 206 && xhr.status !== 200) {
    throw new Error(`${archive.name}: range ${offset}+${end - offset} answered ${xhr.status}`);
  }
  return new Uint8Array(xhr.response as ArrayBuffer);
}

async function ensureClient(refs: ArchiveRef[]): Promise<Client> {
  if (!initPromise) {
    initPromise = init();
  }
  await initPromise;
  archives = refs;
  if (!client) {
    const names = refs.map((a) => a.name);
    const sizes = refs.map((a) => a.size);
    client = new Client(names, new Float64Array(sizes), readRange);
  }
  return client;
}

function isBlpPath(name: string): boolean {
  return name.toLowerCase().endsWith('.blp');
}

/** PNG-encode RGBA pixels with the worker's own canvas, so the page gets an <img> source. */
async function rgbaToPng(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

function normalizePath(name: string): string {
  return name.replace(/\//g, '\\');
}

function inferLegacyCharacter(name: string): { raceId: number; gender: number } | null {
  const n = normalizePath(name).toLowerCase();
  const m = n.match(/^character\\([^\\]+)\\(male|female)\\/);
  if (!m) {
    return null;
  }
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
  if (!raceId) {
    return null;
  }
  return { raceId, gender: m[2] === 'female' ? 1 : 0 };
}

function choiceFromOptions(options: CharacterChoiceOptions): CharacterChoice {
  const pick = (xs: number[], fallback = 0) => (xs.length ? xs[0] : fallback);
  return {
    skin: pick(options.skins),
    face: pick(options.faces),
    hairStyle: pick(options.hairStyles),
    hairColor: pick(options.hairColors),
    facialStyle: pick(options.facialStyles),
    facialColor: pick(options.hairColors),
  };
}

function buildCharacter(
  source: Client,
  raceId: number,
  gender: number,
  requested?: CharacterChoice
): CharacterPayload {
  const options = source.characterOptions(raceId, gender) as CharacterChoiceOptions;
  const choice = requested ?? choiceFromOptions(options);
  const composed = source.character(raceId, gender, choice) as {
    choice: CharacterChoice;
    visibleGeosets: Uint16Array;
    body: { width: number; height: number; rgba: Uint8Array } | null;
    hair: { filename: string; width: number; height: number; rgba: Uint8Array } | null;
    skinExtra: { filename: string; width: number; height: number; rgba: Uint8Array } | null;
  };
  if (!composed.body) {
    throw new Error(`race ${raceId} sex ${gender} has no base skin row`);
  }
  return {
    raceId,
    gender,
    options,
    appearance: {
      choice: composed.choice,
      visibleGeosets: Array.from(composed.visibleGeosets),
      body: {
        index: -1,
        filename: '(composited body)',
        width: composed.body.width,
        height: composed.body.height,
        rgba: composed.body.rgba,
      },
      hair: composed.hair
        ? {
            index: -2,
            filename: composed.hair.filename,
            width: composed.hair.width,
            height: composed.hair.height,
            rgba: composed.hair.rgba,
          }
        : null,
      skinExtra: composed.skinExtra
        ? {
            index: -3,
            filename: composed.skinExtra.filename,
            width: composed.skinExtra.width,
            height: composed.skinExtra.height,
            rgba: composed.skinExtra.rgba,
          }
        : null,
    },
  };
}

function modelDir(name: string): string {
  const cut = name.replace(/\//g, '\\').lastIndexOf('\\');
  return cut <= 0 ? '' : name.slice(0, cut);
}

function readM2(source: Client, name: string, requestedChoice?: CharacterChoice): M2Payload {
  const m2Bytes = source.readFile(name);
  const dir = modelDir(name);
  const isCharacter = inferLegacyCharacter(name) !== null;
  // A creature's M2 leaves `Monster1/2/3` unfilled; the creature tables name its skins.
  const skins = isCharacter ? [] : (source.creatureSkins(name) as (string | null)[]);
  const model = new M2(m2Bytes, dir, skins.length ? skins : null);
  let character: CharacterPayload | null = null;
  let characterError: string | undefined;
  const textures: DecodedTexture[] = [];
  const textureReport: TextureReport[] = [];
  try {
    const defs = model.textures() as { index: number; filename: string | null; textureType: number }[];
    const inferred = inferLegacyCharacter(name);
    if (inferred) {
      try {
        character = buildCharacter(source, inferred.raceId, inferred.gender, requestedChoice);
      } catch (err) {
        characterError = String(err);
        log('character assembly failed', { name, err: characterError });
      }
    }
    // A creature, doodad or spell model has no character dials at all: that is not an error worth
    // saying, so only a character path that failed to compose reports one.

    for (const def of defs) {
      const resolved = resolveModelTexture(source, def, character);
      if (resolved.pixels) {
        const { filename, width, height, rgba } = resolved.pixels;
        textures.push({ index: def.index, filename, width, height, rgba });
        textureReport.push({
          index: def.index,
          filename,
          textureType: def.textureType,
          width,
          height,
          status: 'loaded',
        });
      } else {
        textureReport.push({
          index: def.index,
          filename: def.filename,
          textureType: def.textureType,
          width: 0,
          height: 0,
          status: resolved.status,
          note: resolved.note,
        });
      }
    }
  } finally {
    model.free();
  }
  return {
    m2Bytes,
    modelDir: dir,
    skins,
    textures,
    textureReport,
    character,
    characterError,
    tables: character ? CHARACTER_TABLES : CREATURE_TABLES,
  };
}

/** What a texture slot binds: a decoded image, or why there is none. */
function resolveModelTexture(
  source: Client,
  def: { index: number; filename: string | null; textureType: number },
  character: CharacterPayload | null
): {
  pixels?: { filename: string; width: number; height: number; rgba: Uint8Array };
  status: 'missing' | 'unsupported';
  note: string;
} {
  // A slot the client fills from the character composite or an item.
  if (def.textureType === 1) {
    const body = character?.appearance.body;
    return body
      ? { pixels: { filename: body.filename, width: body.width, height: body.height, rgba: body.rgba }, status: 'missing', note: '' }
      : { status: 'missing', note: 'the body composite needs a character model and its DBC tables' };
  }
  if (def.textureType === 6) {
    const hair = character?.appearance.hair;
    return hair
      ? { pixels: { filename: hair.filename, width: hair.width, height: hair.height, rgba: hair.rgba }, status: 'missing', note: '' }
      : { status: 'missing', note: 'this look has no hair texture' };
  }
  if (def.textureType === 8) {
    const extra = character?.appearance.skinExtra;
    return extra
      ? { pixels: { filename: extra.filename, width: extra.width, height: extra.height, rgba: extra.rgba }, status: 'missing', note: '' }
      : { status: 'missing', note: 'this race has no extra skin (fur) texture' };
  }
  if (def.textureType === 2) {
    return { status: 'unsupported', note: "an item's texture, which the client binds to a worn object" };
  }
  if (!def.filename) {
    return { status: 'missing', note: 'the model names no file and no display supplies one' };
  }
  try {
    const pixels = source.decodeBlp(source.readFile(def.filename)) as {
      width: number;
      height: number;
      rgba: Uint8Array;
    };
    return {
      pixels: { filename: def.filename, width: pixels.width, height: pixels.height, rgba: pixels.rgba },
      status: 'missing',
      note: '',
    };
  } catch (err) {
    log('texture decode failed', { filename: def.filename, err: String(err) });
    return { status: 'missing', note: String(err) };
  }
}

/** A tile's payload, with every layer texture decoded through the chain's BLP reader. */
function readAdt(source: Client, name: string): AdtPayload {
  const tile = source.adt(name) as AdtPayload;
  const decoded: { name: string; width: number; height: number; rgba: Uint8Array }[] = [];
  for (const texture of tile.textures) {
    const path = texture.name.toLowerCase().endsWith('.blp') ? texture.name : `${texture.name}.blp`;
    try {
      const pixels = source.decodeBlp(source.readFile(path)) as {
        width: number;
        height: number;
        rgba: Uint8Array;
      };
      decoded.push({ name: texture.name, width: pixels.width, height: pixels.height, rgba: pixels.rgba });
    } catch (err) {
      log('terrain texture decode failed', { name: texture.name, err: String(err) });
    }
  }
  tile.decoded = decoded;
  // Zone ids are named through `AreaTable`, which the tile call loads.
  tile.tables = ['AreaTable'];
  return tile;
}

/** A sound file's bytes, and the kits whose variations name it. */
function readSound(source: Client, name: string): SoundPayload {
  const bytes = source.readFile(name);
  const kits = source.soundKits(name) as SoundPayload['kits'];
  return { path: name, bytes, kits, tables: ['SoundEntries'] };
}

function adtTransferables(payload: AdtPayload): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (bytes: ArrayBufferView | null | undefined) => {
    if (bytes) buffers.add(bytes.buffer as ArrayBuffer);
  };
  add(payload.alphaAtlas);
  add(payload.shadowAtlas);
  for (const texture of payload.decoded) add(texture.rgba);
  for (const chunk of payload.chunks) {
    add(chunk.positions);
    add(chunk.normals);
    add(chunk.uvs);
    add(chunk.indices);
    add(chunk.layers);
    add(chunk.alphaAtlas);
    add(chunk.shadowAtlas);
    for (const liquid of chunk.liquids) {
      add(liquid.positions);
      add(liquid.indices);
    }
  }
  return [...buffers];
}

function m2Transferables(payload: M2Payload): Transferable[] {
  // The composited body, hair and extra skin are both a texture a batch binds and the character's
  // appearance, so one buffer can be named twice; postMessage refuses a duplicate.
  const buffers = new Set<ArrayBuffer>();
  const add = (bytes: Uint8Array) => buffers.add(bytes.buffer as ArrayBuffer);
  add(payload.m2Bytes);
  for (const tex of payload.textures) {
    add(tex.rgba);
  }
  if (payload.character) {
    add(payload.character.appearance.body.rgba);
    if (payload.character.appearance.hair) {
      add(payload.character.appearance.hair.rgba);
    }
    if (payload.character.appearance.skinExtra) {
      add(payload.character.appearance.skinExtra.rgba);
    }
  }
  return [...buffers];
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  try {
    if (msg.type === 'load') {
      const source = await ensureClient(msg.archives);
      const listing = source.list() as Listing;
      self.postMessage({
        type: 'loadResult',
        id: msg.id,
        archives: source.archives(),
        listing,
      });
      return;
    }

    if (msg.type === 'readBlp') {
      if (!isBlpPath(msg.name)) {
        throw new Error(`not a BLP file: ${msg.name}`);
      }
      const source = await ensureClient(archives);
      const pixels = source.decodeBlp(source.readFile(msg.name)) as {
        width: number;
        height: number;
        rgba: Uint8Array;
      };
      const png = await rgbaToPng(pixels.width, pixels.height, pixels.rgba);
      self.postMessage({ type: 'blpResult', id: msg.id, png });
      return;
    }

    if (msg.type === 'readM2') {
      if (!msg.name.toLowerCase().endsWith('.m2')) {
        throw new Error(`not an M2 file: ${msg.name}`);
      }
      const source = await ensureClient(archives);
      const payload = readM2(source, msg.name, msg.characterChoice);
      self.postMessage({ type: 'm2Result', id: msg.id, payload }, m2Transferables(payload));
      return;
    }

    if (msg.type === 'readAdt') {
      if (!msg.name.toLowerCase().endsWith('.adt')) {
        throw new Error(`not an ADT file: ${msg.name}`);
      }
      const source = await ensureClient(archives);
      const payload = readAdt(source, msg.name);
      self.postMessage({ type: 'adtResult', id: msg.id, payload }, adtTransferables(payload));
      return;
    }

    if (msg.type === 'readProps') {
      const source = await ensureClient(archives);
      const payload = source.props(msg.items) as PropsPayload;
      const buffers = new Set<ArrayBuffer>();
      const add = (bytes: ArrayBufferView) => buffers.add(bytes.buffer as ArrayBuffer);
      for (const texture of payload.textures) add(texture.rgba);
      for (const batch of payload.batches) {
        add(batch.positions);
        add(batch.normals);
        add(batch.uvs);
        add(batch.indices);
      }
      self.postMessage({ type: 'propsResult', id: msg.id, payload }, [...buffers]);
      return;
    }

    if (msg.type === 'readVoice') {
      const source = await ensureClient(archives);
      const payload = source.creatureVoice(msg.path) as CreatureVoicePayload;
      self.postMessage({ type: 'voiceResult', id: msg.id, payload });
      return;
    }

    if (msg.type === 'readRefs') {
      const source = await ensureClient(archives);
      const payload = source.modelReferences(msg.path) as ModelRefsPayload;
      self.postMessage({ type: 'refsResult', id: msg.id, payload });
      return;
    }

    if (msg.type === 'readDbc') {
      const source = await ensureClient(archives);
      const sheet = source.dbc(
        msg.name,
        msg.offset,
        msg.limit,
        msg.filter
      ) as DbcSheet;
      self.postMessage({ type: 'dbcResult', id: msg.id, payload: sheet });
      return;
    }

    if (msg.type === 'readSound') {
      const lower = msg.name.toLowerCase();
      if (!lower.endsWith('.wav') && !lower.endsWith('.mp3')) {
        throw new Error(`not a sound file: ${msg.name}`);
      }
      const source = await ensureClient(archives);
      const payload = readSound(source, msg.name);
      self.postMessage(
        { type: 'soundResult', id: msg.id, payload },
        [payload.bytes.buffer as ArrayBuffer]
      );
      return;
    }
  } catch (err) {
    log(`${msg.type} failed`, err);
    self.postMessage({ type: 'error', id: msg.id, error: String(err) });
  }
};

export {};
