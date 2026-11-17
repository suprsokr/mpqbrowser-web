/* tslint:disable */
/* eslint-disable */

/**
 * A set of MPQ archives read through the page, mounted in the client's own priority order.
 */
export class Client {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A terrain tile through `adt_to_tile_mesh`: its geometry, layer textures, alpha and shadow
     * atlases, liquids, doodads and buildings, as the page's terrain viewer draws them.
     */
    adt(name: string): any;
    /**
     * The mounted archives, in ascending priority.
     */
    archives(): string[];
    /**
     * The appearance dials a race and sex offer: `{ skins, faces, hairStyles, hairColors,
     * facialStyles }`, each a run of variation indices.
     */
    characterOptions(race: number, sex: number): any;
    /**
     * Compose one look: the 256² body atlas, the hair and extra-skin textures, and the geosets
     * the appearance shows. `choice` carries `{ skin, face, hairStyle, hairColor, facialStyle }`.
     */
    character(race: number, sex: number, choice: any): any;
    /**
     * The `Monster1/2/3` skins the creature tables give a model path, as three entries (bare
     * file names, `null` for a slot the data leaves empty); an empty array when no display names
     * the model, which is then drawn the way the client draws it: no texture at all.
     */
    creatureSkins(model_path: string): any;
    /**
     * The creature side of a model: its `CreatureDisplayInfo` voice rows with the `SoundEntries`
     * kits each event plays, and the `CreatureDisplayInfoExtra` rows its displays point at.
     * `{ displays, voices, extras, extraTotal }`; `voices` is deduplicated by row, since 14
     * kobold displays share one voice set, and each event carries the kit's files to play.
     */
    creatureVoice(model_path: string): any;
    /**
     * One page of a DBC: `{ path, columns, rows, total, matched, offset, schema, keyIndex,
     * recordCount, fieldCount, types }`, `limit` rows from `offset` after `filter` matched a
     * cell. Column names come from benilla's own schemas; a table no schema covers shows its raw
     * `u32` slots as `field0`, `field1`, ...
     */
    dbc(path: string, offset: number, limit: number, filter: string): any;
    /**
     * One BLP decoded to `{ width, height, rgba }`, without going through the chain.
     */
    decodeBlp(bytes: Uint8Array | number[]): any;
    /**
     * Whether the chain holds a path, without reading it.
     */
    exists(path: string): boolean;
    /**
     * Every listed path as column arrays: `{ names, archive, size, compressed, flags }`, where
     * `archive` indexes [`Self::archives`]. A patch's copy wins its lower archive's, and a delete
     * marker removes the path instead of listing it empty.
     */
    list(): any;
    /**
     * Every shipped table that names `model_path`, plus the rows that reach those rows by id:
     * a `CreatureModelData.ModelName` hit yields its `CreatureDisplayInfo` rows (with the skins,
     * scale and alpha that make one model look like a dozen creatures), and a
     * `SpellVisualEffectName.FileName` hit yields the `SpellVisualKit` slots that fire it.
     * `{ model, hits, tables, unreadable, displays, kits }`; a model no table names is unused art.
     */
    modelReferences(model_path: string): any;
    /**
     * `names` and `sizes` describe the archives; `read(id, offset, length)` returns a
     * `Uint8Array` of one archive's bytes. Mount order is the client's: the base archives, then
     * `patch.MPQ`, then `patch-?.MPQ` by name, then `speech2.MPQ`.
     */
    constructor(names: string[], sizes: Float64Array | number[], read: Function);
    /**
     * Doodads and buildings placed by a tile, baked into world space: `items` is an array of
     * `{ path, position: [x, y, z], rotation: [rx, ry, rz] (degrees), scale }`. Returns
     * `{ textures, batches, failed, skipped, missingTextures, vertexCount }`.
     */
    props(items: any): any;
    /**
     * One file from the chain by MPQ path, `/` or `\`, any case.
     */
    readFile(name: string): Uint8Array;
    /**
     * Every schema the crate ships, as `name/slots`, for the page's diagnostics.
     */
    schemas(): string[];
    /**
     * The `SoundEntries` kits that play a file, by the file's MPQ path (any of a kit's variations
     * matching, case-insensitively): `{ id, soundType, name, volume, minDistance, distanceCutoff }`
     * per kit, by id. Empty for a file no kit names.
     */
    soundKits(path: string): any;
}

export class M2 {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Every playable sequence, in file order: `{ index, id, duration, looping }`.
     */
    animations(): any;
    /**
     * One entry per draw batch: its index range and the state the page's WebGL sets.
     */
    batches(): any;
    /**
     * `[min x, min y, min z, max x, max y, max z]`, renderer axes.
     */
    boundingBox(): Float32Array;
    indices(): Uint32Array;
    /**
     * `dir` is the model's folder and `skins` its `Monster1/2/3` texture variations (bare names),
     * which the creature tables supply; a character model passes its folder and no skins.
     */
    constructor(bytes: Uint8Array | number[], dir: string, skins: any);
    /**
     * Select a sequence by its index in [`Self::animations`], and rewind it.
     */
    setAnimation(index: number): void;
    /**
     * Skinned normals, `x, y, z` per vertex, renderer axes.
     */
    skinnedNormals(): Float32Array;
    /**
     * Skinned positions, `x, y, z` per vertex, renderer axes.
     */
    skinnedVertices(): Float32Array;
    texCoords(): Float32Array;
    /**
     * The textures the model binds, one entry per distinct slot.
     */
    textures(): any;
    /**
     * Advance the clip by `dt_ms` and pose the model.
     */
    update(dt_ms: number): void;
    vertexCount(): number;
}

/**
 * Install the panic hook so a reader panic shows up in the page's console with its message.
 */
export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_client_free: (a: number, b: number) => void;
    readonly __wbg_m2_free: (a: number, b: number) => void;
    readonly client_adt: (a: number, b: number, c: number) => [number, number, number];
    readonly client_archives: (a: number) => [number, number];
    readonly client_character: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly client_characterOptions: (a: number, b: number, c: number) => [number, number, number];
    readonly client_creatureSkins: (a: number, b: number, c: number) => [number, number, number];
    readonly client_creatureVoice: (a: number, b: number, c: number) => [number, number, number];
    readonly client_dbc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly client_decodeBlp: (a: number, b: number, c: number) => [number, number, number];
    readonly client_exists: (a: number, b: number, c: number) => number;
    readonly client_list: (a: number) => [number, number, number];
    readonly client_modelReferences: (a: number, b: number, c: number) => [number, number, number];
    readonly client_new: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly client_props: (a: number, b: any) => [number, number, number];
    readonly client_readFile: (a: number, b: number, c: number) => [number, number, number, number];
    readonly client_schemas: (a: number) => [number, number];
    readonly client_soundKits: (a: number, b: number, c: number) => [number, number, number];
    readonly m2_animations: (a: number) => [number, number, number];
    readonly m2_batches: (a: number) => [number, number, number];
    readonly m2_boundingBox: (a: number) => [number, number];
    readonly m2_indices: (a: number) => [number, number];
    readonly m2_new: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly m2_setAnimation: (a: number, b: number) => void;
    readonly m2_skinnedNormals: (a: number) => [number, number];
    readonly m2_skinnedVertices: (a: number) => [number, number];
    readonly m2_texCoords: (a: number) => [number, number];
    readonly m2_textures: (a: number) => [number, number, number];
    readonly m2_update: (a: number, b: number) => void;
    readonly m2_vertexCount: (a: number) => number;
    readonly start: () => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
