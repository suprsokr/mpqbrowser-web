/* tslint:disable */
/* eslint-disable */

/**
 * Parsed legacy DBC tables, ready to resolve characters.
 */
export class LegacyDatabase {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Enumerate valid legacy customization choices for a race + gender.
     *
     * Returns `{ skins, faces, hairStyles, hairColors, facialStyles }`, where
     * values are the DBC choice indices expected by `resolve(...)`.
     */
    legacyChoices(race_id: number, gender: number): any;
    /**
     * Parse the four legacy DBCs from their raw `.dbc` bytes.
     *
     * Order: `CharSections`, `CharHairGeosets`, `CharacterFacialHairStyles`,
     * `ChrRaces`.
     */
    constructor(char_sections: Uint8Array, hair_geosets: Uint8Array, facial_hair_styles: Uint8Array, chr_races: Uint8Array);
    /**
     * Resolve the DBC rows for a race + gender + choice.
     *
     * `gender`: 0 = male, 1 = female. `choice` is a JS object; all fields
     * default to 0. Returns an opaque [`ResolvedCharacter`] handle.
     */
    resolve(race_id: number, gender: number, choice: any): ResolvedCharacter;
    /**
     * Row counts per table: `{ charSections, hairGeosets, facialHairStyles, races }`.
     */
    tableSizes(): any;
}

export class Mat4 {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    asFloat32Array(): Float32Array;
    static identity(): Mat4;
}

export class Quat {
    free(): void;
    [Symbol.dispose](): void;
    static identity(): Quat;
    constructor(x: number, y: number, z: number, w: number);
    toRendererSpace(): Quat;
    w: number;
    x: number;
    y: number;
    z: number;
}

/**
 * Opaque handle to a resolved character context.
 *
 * Produced by [`LegacyDatabase::resolve`]; consumed by [`ResolvedCharacter::build_plan`].
 */
export class ResolvedCharacter {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Build the ordered body-layer + geoset plan for this character.
     *
     * `options` is a JS object (`{ showUnderwear, showFacialHair }`); both
     * default to `true`. Returns a serialized [`crate::legacy_customization::LegacyPlan`].
     */
    buildPlan(options: any): any;
    /**
     * `Context::isValid()` — true when at least a skin + hair style resolved.
     */
    isValid(): boolean;
}

/**
 * 2D vector exposed for JS/TS consumers and used by higher-level APIs.
 */
export class Vec2 {
    free(): void;
    [Symbol.dispose](): void;
    length(): number;
    constructor(x: number, y: number);
    x: number;
    y: number;
}

/**
 * 3D vector. Coordinate conversion helpers match the existing WMVx/Noggit
 * convention used by `warcraft-rs-wasm`: WoW Z-up -> renderer Y-up.
 */
export class Vec3 {
    free(): void;
    [Symbol.dispose](): void;
    length(): number;
    constructor(x: number, y: number, z: number);
    /**
     * Convert this vector as a *scale* into renderer space (Y/Z swap without
     * the handedness sign flip used for positions/directions).
     */
    scaleToRendererSpace(): Vec3;
    toRendererSpace(): Vec3;
    x: number;
    y: number;
    z: number;
}

export class Vec4 {
    free(): void;
    [Symbol.dispose](): void;
    constructor(x: number, y: number, z: number, w: number);
    w: number;
    x: number;
    y: number;
    z: number;
}

/**
 * WMVx character customization facade for JS/TS.
 *
 * ```js
 * import init, { WmvxCharacter } from "wmvx-wasm";
 * await init();
 *
 * const character = new WmvxCharacter({
 *   options: { showHair: true, showFacialHair: true, showUnderwear: true },
 *   context: {
 *     skin: { textures: ["skinBody.blp", "fur.blp"] },
 *     face: { textures: ["faceLower.blp", "faceUpper.blp"] },
 *     hairColour: { textures: ["hair.blp", "", ""] },
 *     hairStyle: { geoset: 1 },
 *   },
 *   equipment: [
 *     { slot: "chest", geosetGlovesFlags: 2, geosetRobeFlags: 1 },
 *     { slot: "head" },
 *   ],
 *   geosetIds: [0, 1, 101, 201, 301, 701, 702, 401, 402],
 * });
 *
 * const geosets = character.visibleGeosets(); // Uint32Array
 * const texture = character.texturePlan();     // { baseLayer, layers, replaceable }
 * const attach  = character.attachments();     // [{ slot, positions }]
 * const all     = character.assemble();        // full object
 * ```
 */
export class WmvxCharacter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Compute everything at once and return a single object.
     */
    assemble(): any;
    /**
     * Compute attachment positions for equipped slots.
     */
    attachments(): any;
    /**
     * Return the normalized customization input.
     */
    input(): any;
    /**
     * Create a character from a JS [`LegacyCustomizationInput`] object.
     */
    constructor(input: any);
    /**
     * Toggle whether weapons are drawn sheathed (affects hand attachment positions).
     */
    setSheatheWeapons(value: boolean): void;
    /**
     * Compute the character texture composition plan.
     */
    texturePlan(): any;
    /**
     * Compute the set of visible geoset ids as a `Uint32Array`.
     */
    visibleGeosets(): Uint32Array;
}

/**
 * Ready-to-draw M2 model with WMVx-oriented animation/evaluation APIs.
 *
 * This is intentionally renderer-agnostic: it returns typed arrays and batch
 * metadata, while the consumer owns WebGL/WebGPU/Three.js/etc.
 *
 * Parsing, coordinate conversion, and CPU skinning are delegated to the
 * in-house [`wmvx_m2`] crate (a faithful WMVx port), keeping this project
 * self-contained.
 */
export class WmvxModel {
    free(): void;
    [Symbol.dispose](): void;
    animations(): any;
    /**
     * Attachment anchors (weapon/held-item/effect points) for the *current*
     * animation/time.
     *
     * Each entry is `{ id, bone, position: [x,y,z], transform: [16 floats,
     * column-major] }`. `transform` carries the anchor bone's orientation, so a
     * consumer can parent a model/effect to it directly.
     */
    attachments(): any;
    batches(): any;
    boundingBox(): Float32Array;
    indices(): Uint32Array;
    /**
     * Create a model from M2 bytes and optional external `.skin` bytes.
     *
     * `skin_data` is required for WotLK (external `.skin`) and ignored for
     * `<= TBC` models, which carry embedded views.
     */
    constructor(m2_data: Uint8Array, skin_data?: Uint8Array | null);
    /**
     * Per-render-pass animated material state for the *current* animation/time.
     *
     * Returns an array parallel to `batches()`, each entry
     * `{ submesh, rgb: [r,g,b], alpha, uvTransform: [9 floats, column-major] }`.
     * A renderer multiplies the pass texture by `rgb`, uses `alpha` as the
     * material opacity, and applies `uvTransform` to the pass's UVs.
     */
    passMaterials(): any;
    setAnimation(index: number): void;
    skinnedNormals(): Float32Array;
    skinnedVertices(): Float32Array;
    texCoords(): Float32Array;
    textures(): any;
    update(delta_ms: number): void;
    vertexCount(): number;
}

/**
 * Assemble a child model (weapon/effect) at a parent attachment position.
 *
 * This mirrors WMVx's attachment transform: resolve `attachmentLookup[position]`,
 * then use `bone_matrix * translate(local_position)` for the child world matrix.
 */
export function assembleAttachment(parent: WmvxModel, child: WmvxModel, options: any): any;

/**
 * Assemble a legacy character model for rendering.
 *
 * Inputs are existing wasm handles:
 * - `model`: parsed character M2 (`WmvxModel`)
 * - `resolved`: resolved DBC character context (`LegacyDatabase.resolve(...)`)
 * - `options`: `{ showHair?, showUnderwear?, showFacialHair?, tabard?, forceFaceVisible? }`
 *
 * Returns plain JS data. The renderer still owns GPU buffers/textures/draw calls.
 */
export function assembleLegacyCharacter(model: WmvxModel, resolved: ResolvedCharacter, options: any): any;

/**
 * Composite decoded body layers into the legacy 512px body sheet.
 *
 * `layers` is a JS array of `{ rgba, width, height, region?, layer }` objects;
 * omit `region` (or pass null) for the full-sheet base layer. Returns
 * `{ width, height, rgba: Uint8Array }`.
 */
export function composeBodyTexture(layers: any): any;

/**
 * Decode a BLP texture from in-memory bytes and return RGBA pixels for one mip level.
 *
 * The result is a JS object:
 * `{ width, height, rgba: Uint8Array, mipmaps, version, compression, alphaBits }`.
 */
export function decodeBlp(data: Uint8Array, mipmap_level?: number | null): any;

/**
 * Filter a model's geoset ids down to the default-visible subset.
 *
 * This is the renderer-agnostic entry point for the common "draw a sensible
 * default look" case: pass every geoset id present in the model and get back
 * only the ones that should be drawn, with **no** customization/DBC data
 * required. Order is preserved.
 *
 * A geoset is visible by default when its id is `0` or the first variant of a
 * group (`id > 100 && id % 100 == 1`), matching WMVx's `ModelDefaultsGeosetModifier`.
 *
 * ```js
 * import init, { defaultVisibleGeosets } from "wmvx-wasm";
 * await init();
 * const allIds = new Uint32Array([0, 1, 2, 302, 303, 401, 402, 1501, 1502]);
 * const visible = defaultVisibleGeosets(allIds); // Uint32Array [0, 302, 401, 1501]
 * ```
 */
export function defaultVisibleGeosets(geoset_ids: Uint32Array): Uint32Array;

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly decodeBlp: (a: number, b: number, c: number) => [number, number, number];
    readonly __wbg_wmvxcharacter_free: (a: number, b: number) => void;
    readonly defaultVisibleGeosets: (a: number, b: number) => any;
    readonly wmvxcharacter_assemble: (a: number) => [number, number, number];
    readonly wmvxcharacter_attachments: (a: number) => [number, number, number];
    readonly wmvxcharacter_input: (a: number) => [number, number, number];
    readonly wmvxcharacter_new: (a: any) => [number, number, number];
    readonly wmvxcharacter_setSheatheWeapons: (a: number, b: number) => void;
    readonly wmvxcharacter_texturePlan: (a: number) => [number, number, number];
    readonly wmvxcharacter_visibleGeosets: (a: number) => any;
    readonly __wbg_get_quat_w: (a: number) => number;
    readonly __wbg_get_quat_x: (a: number) => number;
    readonly __wbg_get_quat_y: (a: number) => number;
    readonly __wbg_get_quat_z: (a: number) => number;
    readonly __wbg_mat4_free: (a: number, b: number) => void;
    readonly __wbg_quat_free: (a: number, b: number) => void;
    readonly __wbg_set_quat_w: (a: number, b: number) => void;
    readonly __wbg_set_quat_x: (a: number, b: number) => void;
    readonly __wbg_set_quat_y: (a: number, b: number) => void;
    readonly __wbg_set_quat_z: (a: number, b: number) => void;
    readonly __wbg_vec2_free: (a: number, b: number) => void;
    readonly __wbg_vec3_free: (a: number, b: number) => void;
    readonly __wbg_vec4_free: (a: number, b: number) => void;
    readonly mat4_asFloat32Array: (a: number) => any;
    readonly mat4_identity: () => number;
    readonly quat_identity: () => number;
    readonly quat_new: (a: number, b: number, c: number, d: number) => number;
    readonly quat_toRendererSpace: (a: number) => number;
    readonly vec2_length: (a: number) => number;
    readonly vec3_length: (a: number) => number;
    readonly vec3_new: (a: number, b: number, c: number) => number;
    readonly vec3_scaleToRendererSpace: (a: number) => number;
    readonly vec3_toRendererSpace: (a: number) => number;
    readonly __wbg_set_vec2_x: (a: number, b: number) => void;
    readonly __wbg_set_vec2_y: (a: number, b: number) => void;
    readonly __wbg_set_vec3_x: (a: number, b: number) => void;
    readonly __wbg_set_vec3_y: (a: number, b: number) => void;
    readonly __wbg_set_vec3_z: (a: number, b: number) => void;
    readonly __wbg_set_vec4_w: (a: number, b: number) => void;
    readonly __wbg_set_vec4_x: (a: number, b: number) => void;
    readonly __wbg_set_vec4_y: (a: number, b: number) => void;
    readonly __wbg_set_vec4_z: (a: number, b: number) => void;
    readonly __wbg_get_vec2_x: (a: number) => number;
    readonly __wbg_get_vec2_y: (a: number) => number;
    readonly __wbg_get_vec3_x: (a: number) => number;
    readonly __wbg_get_vec3_y: (a: number) => number;
    readonly __wbg_get_vec3_z: (a: number) => number;
    readonly __wbg_get_vec4_w: (a: number) => number;
    readonly __wbg_get_vec4_x: (a: number) => number;
    readonly __wbg_get_vec4_y: (a: number) => number;
    readonly __wbg_get_vec4_z: (a: number) => number;
    readonly vec2_new: (a: number, b: number) => number;
    readonly vec4_new: (a: number, b: number, c: number, d: number) => number;
    readonly start: () => void;
    readonly assembleAttachment: (a: number, b: number, c: any) => [number, number, number];
    readonly assembleLegacyCharacter: (a: number, b: number, c: any) => [number, number, number];
    readonly __wbg_legacydatabase_free: (a: number, b: number) => void;
    readonly __wbg_resolvedcharacter_free: (a: number, b: number) => void;
    readonly composeBodyTexture: (a: any) => [number, number, number];
    readonly legacydatabase_legacyChoices: (a: number, b: number, c: number) => [number, number, number];
    readonly legacydatabase_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly legacydatabase_resolve: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly legacydatabase_tableSizes: (a: number) => [number, number, number];
    readonly resolvedcharacter_buildPlan: (a: number, b: any) => [number, number, number];
    readonly resolvedcharacter_isValid: (a: number) => number;
    readonly __wbg_wmvxmodel_free: (a: number, b: number) => void;
    readonly wmvxmodel_animations: (a: number) => [number, number, number];
    readonly wmvxmodel_attachments: (a: number) => [number, number, number];
    readonly wmvxmodel_batches: (a: number) => [number, number, number];
    readonly wmvxmodel_boundingBox: (a: number) => any;
    readonly wmvxmodel_indices: (a: number) => any;
    readonly wmvxmodel_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wmvxmodel_passMaterials: (a: number) => [number, number, number];
    readonly wmvxmodel_setAnimation: (a: number, b: number) => void;
    readonly wmvxmodel_skinnedNormals: (a: number) => any;
    readonly wmvxmodel_skinnedVertices: (a: number) => any;
    readonly wmvxmodel_texCoords: (a: number) => any;
    readonly wmvxmodel_textures: (a: number) => [number, number, number];
    readonly wmvxmodel_update: (a: number, b: number) => void;
    readonly wmvxmodel_vertexCount: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
