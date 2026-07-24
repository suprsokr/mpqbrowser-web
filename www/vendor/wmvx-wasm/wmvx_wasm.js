/* @ts-self-types="./wmvx_wasm.d.ts" */

/**
 * Parsed legacy DBC tables, ready to resolve characters.
 */
export class LegacyDatabase {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LegacyDatabaseFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_legacydatabase_free(ptr, 0);
    }
    /**
     * Enumerate valid legacy customization choices for a race + gender.
     *
     * Returns `{ skins, faces, hairStyles, hairColors, facialStyles }`, where
     * values are the DBC choice indices expected by `resolve(...)`.
     * @param {number} race_id
     * @param {number} gender
     * @returns {any}
     */
    legacyChoices(race_id, gender) {
        const ret = wasm.legacydatabase_legacyChoices(this.__wbg_ptr, race_id, gender);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Parse the four legacy DBCs from their raw `.dbc` bytes.
     *
     * Order: `CharSections`, `CharHairGeosets`, `CharacterFacialHairStyles`,
     * `ChrRaces`.
     * @param {Uint8Array} char_sections
     * @param {Uint8Array} hair_geosets
     * @param {Uint8Array} facial_hair_styles
     * @param {Uint8Array} chr_races
     */
    constructor(char_sections, hair_geosets, facial_hair_styles, chr_races) {
        const ptr0 = passArray8ToWasm0(char_sections, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(hair_geosets, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(facial_hair_styles, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(chr_races, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.legacydatabase_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        LegacyDatabaseFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Resolve the DBC rows for a race + gender + choice.
     *
     * `gender`: 0 = male, 1 = female. `choice` is a JS object; all fields
     * default to 0. Returns an opaque [`ResolvedCharacter`] handle.
     * @param {number} race_id
     * @param {number} gender
     * @param {any} choice
     * @returns {ResolvedCharacter}
     */
    resolve(race_id, gender, choice) {
        const ret = wasm.legacydatabase_resolve(this.__wbg_ptr, race_id, gender, choice);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ResolvedCharacter.__wrap(ret[0]);
    }
    /**
     * Row counts per table: `{ charSections, hairGeosets, facialHairStyles, races }`.
     * @returns {any}
     */
    tableSizes() {
        const ret = wasm.legacydatabase_tableSizes(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
}
if (Symbol.dispose) LegacyDatabase.prototype[Symbol.dispose] = LegacyDatabase.prototype.free;

export class Mat4 {
    static __wrap(ptr) {
        const obj = Object.create(Mat4.prototype);
        obj.__wbg_ptr = ptr;
        Mat4Finalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Mat4Finalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mat4_free(ptr, 0);
    }
    /**
     * @returns {Float32Array}
     */
    asFloat32Array() {
        const ret = wasm.mat4_asFloat32Array(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Mat4}
     */
    static identity() {
        const ret = wasm.mat4_identity();
        return Mat4.__wrap(ret);
    }
}
if (Symbol.dispose) Mat4.prototype[Symbol.dispose] = Mat4.prototype.free;

export class Quat {
    static __wrap(ptr) {
        const obj = Object.create(Quat.prototype);
        obj.__wbg_ptr = ptr;
        QuatFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        QuatFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_quat_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get w() {
        const ret = wasm.__wbg_get_quat_w(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.__wbg_get_quat_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.__wbg_get_quat_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.__wbg_get_quat_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Quat}
     */
    static identity() {
        const ret = wasm.quat_identity();
        return Quat.__wrap(ret);
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} w
     */
    constructor(x, y, z, w) {
        const ret = wasm.quat_new(x, y, z, w);
        this.__wbg_ptr = ret;
        QuatFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Quat}
     */
    toRendererSpace() {
        const ret = wasm.quat_toRendererSpace(this.__wbg_ptr);
        return Quat.__wrap(ret);
    }
    /**
     * @param {number} arg0
     */
    set w(arg0) {
        wasm.__wbg_set_quat_w(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set x(arg0) {
        wasm.__wbg_set_quat_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set y(arg0) {
        wasm.__wbg_set_quat_y(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set z(arg0) {
        wasm.__wbg_set_quat_z(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Quat.prototype[Symbol.dispose] = Quat.prototype.free;

/**
 * Opaque handle to a resolved character context.
 *
 * Produced by [`LegacyDatabase::resolve`]; consumed by [`ResolvedCharacter::build_plan`].
 */
export class ResolvedCharacter {
    static __wrap(ptr) {
        const obj = Object.create(ResolvedCharacter.prototype);
        obj.__wbg_ptr = ptr;
        ResolvedCharacterFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ResolvedCharacterFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_resolvedcharacter_free(ptr, 0);
    }
    /**
     * Build the ordered body-layer + geoset plan for this character.
     *
     * `options` is a JS object (`{ showUnderwear, showFacialHair }`); both
     * default to `true`. Returns a serialized [`crate::legacy_customization::LegacyPlan`].
     * @param {any} options
     * @returns {any}
     */
    buildPlan(options) {
        const ret = wasm.resolvedcharacter_buildPlan(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * `Context::isValid()` — true when at least a skin + hair style resolved.
     * @returns {boolean}
     */
    isValid() {
        const ret = wasm.resolvedcharacter_isValid(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) ResolvedCharacter.prototype[Symbol.dispose] = ResolvedCharacter.prototype.free;

/**
 * 2D vector exposed for JS/TS consumers and used by higher-level APIs.
 */
export class Vec2 {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Vec2Finalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vec2_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.__wbg_get_vec2_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.__wbg_get_vec2_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set x(arg0) {
        wasm.__wbg_set_vec2_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set y(arg0) {
        wasm.__wbg_set_vec2_y(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    length() {
        const ret = wasm.vec2_length(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} x
     * @param {number} y
     */
    constructor(x, y) {
        const ret = wasm.vec2_new(x, y);
        this.__wbg_ptr = ret;
        Vec2Finalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Vec2.prototype[Symbol.dispose] = Vec2.prototype.free;

/**
 * 3D vector. Coordinate conversion helpers match the existing WMVx/Noggit
 * convention used by `warcraft-rs-wasm`: WoW Z-up -> renderer Y-up.
 */
export class Vec3 {
    static __wrap(ptr) {
        const obj = Object.create(Vec3.prototype);
        obj.__wbg_ptr = ptr;
        Vec3Finalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Vec3Finalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vec3_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.__wbg_get_vec3_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.__wbg_get_vec3_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.__wbg_get_vec3_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set x(arg0) {
        wasm.__wbg_set_vec3_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set y(arg0) {
        wasm.__wbg_set_vec3_y(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set z(arg0) {
        wasm.__wbg_set_vec3_z(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    length() {
        const ret = wasm.vec3_length(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    constructor(x, y, z) {
        const ret = wasm.vec3_new(x, y, z);
        this.__wbg_ptr = ret;
        Vec3Finalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Convert this vector as a *scale* into renderer space (Y/Z swap without
     * the handedness sign flip used for positions/directions).
     * @returns {Vec3}
     */
    scaleToRendererSpace() {
        const ret = wasm.vec3_scaleToRendererSpace(this.__wbg_ptr);
        return Vec3.__wrap(ret);
    }
    /**
     * @returns {Vec3}
     */
    toRendererSpace() {
        const ret = wasm.vec3_toRendererSpace(this.__wbg_ptr);
        return Vec3.__wrap(ret);
    }
}
if (Symbol.dispose) Vec3.prototype[Symbol.dispose] = Vec3.prototype.free;

export class Vec4 {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Vec4Finalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vec4_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get w() {
        const ret = wasm.__wbg_get_vec4_w(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get x() {
        const ret = wasm.__wbg_get_vec4_x(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get y() {
        const ret = wasm.__wbg_get_vec4_y(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z() {
        const ret = wasm.__wbg_get_vec4_z(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set w(arg0) {
        wasm.__wbg_set_vec4_w(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set x(arg0) {
        wasm.__wbg_set_vec4_x(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set y(arg0) {
        wasm.__wbg_set_vec4_y(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set z(arg0) {
        wasm.__wbg_set_vec4_z(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} w
     */
    constructor(x, y, z, w) {
        const ret = wasm.vec4_new(x, y, z, w);
        this.__wbg_ptr = ret;
        Vec4Finalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Vec4.prototype[Symbol.dispose] = Vec4.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WmvxCharacterFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wmvxcharacter_free(ptr, 0);
    }
    /**
     * Compute everything at once and return a single object.
     * @returns {any}
     */
    assemble() {
        const ret = wasm.wmvxcharacter_assemble(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute attachment positions for equipped slots.
     * @returns {any}
     */
    attachments() {
        const ret = wasm.wmvxcharacter_attachments(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Return the normalized customization input.
     * @returns {any}
     */
    input() {
        const ret = wasm.wmvxcharacter_input(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Create a character from a JS [`LegacyCustomizationInput`] object.
     * @param {any} input
     */
    constructor(input) {
        const ret = wasm.wmvxcharacter_new(input);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WmvxCharacterFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Toggle whether weapons are drawn sheathed (affects hand attachment positions).
     * @param {boolean} value
     */
    setSheatheWeapons(value) {
        wasm.wmvxcharacter_setSheatheWeapons(this.__wbg_ptr, value);
    }
    /**
     * Compute the character texture composition plan.
     * @returns {any}
     */
    texturePlan() {
        const ret = wasm.wmvxcharacter_texturePlan(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Compute the set of visible geoset ids as a `Uint32Array`.
     * @returns {Uint32Array}
     */
    visibleGeosets() {
        const ret = wasm.wmvxcharacter_visibleGeosets(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WmvxCharacter.prototype[Symbol.dispose] = WmvxCharacter.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WmvxModelFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wmvxmodel_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    animations() {
        const ret = wasm.wmvxmodel_animations(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Attachment anchors (weapon/held-item/effect points) for the *current*
     * animation/time.
     *
     * Each entry is `{ id, bone, position: [x,y,z], transform: [16 floats,
     * column-major] }`. `transform` carries the anchor bone's orientation, so a
     * consumer can parent a model/effect to it directly.
     * @returns {any}
     */
    attachments() {
        const ret = wasm.wmvxmodel_attachments(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {any}
     */
    batches() {
        const ret = wasm.wmvxmodel_batches(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @returns {Float32Array}
     */
    boundingBox() {
        const ret = wasm.wmvxmodel_boundingBox(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint32Array}
     */
    indices() {
        const ret = wasm.wmvxmodel_indices(this.__wbg_ptr);
        return ret;
    }
    /**
     * Create a model from M2 bytes and optional external `.skin` bytes.
     *
     * `skin_data` is required for WotLK (external `.skin`) and ignored for
     * `<= TBC` models, which carry embedded views.
     * @param {Uint8Array} m2_data
     * @param {Uint8Array | null} [skin_data]
     */
    constructor(m2_data, skin_data) {
        const ptr0 = passArray8ToWasm0(m2_data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(skin_data) ? 0 : passArray8ToWasm0(skin_data, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.wmvxmodel_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WmvxModelFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Per-render-pass animated material state for the *current* animation/time.
     *
     * Returns an array parallel to `batches()`, each entry
     * `{ submesh, rgb: [r,g,b], alpha, uvTransform: [9 floats, column-major] }`.
     * A renderer multiplies the pass texture by `rgb`, uses `alpha` as the
     * material opacity, and applies `uvTransform` to the pass's UVs.
     * @returns {any}
     */
    passMaterials() {
        const ret = wasm.wmvxmodel_passMaterials(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} index
     */
    setAnimation(index) {
        wasm.wmvxmodel_setAnimation(this.__wbg_ptr, index);
    }
    /**
     * @returns {Float32Array}
     */
    skinnedNormals() {
        const ret = wasm.wmvxmodel_skinnedNormals(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float32Array}
     */
    skinnedVertices() {
        const ret = wasm.wmvxmodel_skinnedVertices(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Float32Array}
     */
    texCoords() {
        const ret = wasm.wmvxmodel_texCoords(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {any}
     */
    textures() {
        const ret = wasm.wmvxmodel_textures(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {number} delta_ms
     */
    update(delta_ms) {
        wasm.wmvxmodel_update(this.__wbg_ptr, delta_ms);
    }
    /**
     * @returns {number}
     */
    vertexCount() {
        const ret = wasm.wmvxmodel_vertexCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WmvxModel.prototype[Symbol.dispose] = WmvxModel.prototype.free;

/**
 * Assemble a child model (weapon/effect) at a parent attachment position.
 *
 * This mirrors WMVx's attachment transform: resolve `attachmentLookup[position]`,
 * then use `bone_matrix * translate(local_position)` for the child world matrix.
 * @param {WmvxModel} parent
 * @param {WmvxModel} child
 * @param {any} options
 * @returns {any}
 */
export function assembleAttachment(parent, child, options) {
    _assertClass(parent, WmvxModel);
    _assertClass(child, WmvxModel);
    const ret = wasm.assembleAttachment(parent.__wbg_ptr, child.__wbg_ptr, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Assemble a legacy character model for rendering.
 *
 * Inputs are existing wasm handles:
 * - `model`: parsed character M2 (`WmvxModel`)
 * - `resolved`: resolved DBC character context (`LegacyDatabase.resolve(...)`)
 * - `options`: `{ showHair?, showUnderwear?, showFacialHair?, tabard?, forceFaceVisible? }`
 *
 * Returns plain JS data. The renderer still owns GPU buffers/textures/draw calls.
 * @param {WmvxModel} model
 * @param {ResolvedCharacter} resolved
 * @param {any} options
 * @returns {any}
 */
export function assembleLegacyCharacter(model, resolved, options) {
    _assertClass(model, WmvxModel);
    _assertClass(resolved, ResolvedCharacter);
    const ret = wasm.assembleLegacyCharacter(model.__wbg_ptr, resolved.__wbg_ptr, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Composite decoded body layers into the legacy 512px body sheet.
 *
 * `layers` is a JS array of `{ rgba, width, height, region?, layer }` objects;
 * omit `region` (or pass null) for the full-sheet base layer. Returns
 * `{ width, height, rgba: Uint8Array }`.
 * @param {any} layers
 * @returns {any}
 */
export function composeBodyTexture(layers) {
    const ret = wasm.composeBodyTexture(layers);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Decode a BLP texture from in-memory bytes and return RGBA pixels for one mip level.
 *
 * The result is a JS object:
 * `{ width, height, rgba: Uint8Array, mipmaps, version, compression, alphaBits }`.
 * @param {Uint8Array} data
 * @param {number | null} [mipmap_level]
 * @returns {any}
 */
export function decodeBlp(data, mipmap_level) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decodeBlp(ptr0, len0, isLikeNone(mipmap_level) ? Number.MAX_SAFE_INTEGER : (mipmap_level) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

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
 * @param {Uint32Array} geoset_ids
 * @returns {Uint32Array}
 */
export function defaultVisibleGeosets(geoset_ids) {
    const ptr0 = passArray32ToWasm0(geoset_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.defaultVisibleGeosets(ptr0, len0);
    return ret;
}

export function start() {
    wasm.start();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_9a4e0ecb0fa16705: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_c25d447a39f5578f: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_aca499c5de7ff5e5: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_ea9085d691f535d3: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_db4c3b15f63fc170: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_394265ed1e1b84ee: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_b0ca35b86a603356: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_8a2dd23819f8a60a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_89b2b13e91a60321: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_015dc610cd81ede0: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_get_507a50627bffa49b: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_c7eb1f358a7654df: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_unchecked_6e0ad6d2a41b06f6: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_309b927aaf7a3fc7: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_0677c962b281d01a: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_04f36e4056f1b851: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_6f722e4a93058b71: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_370319915dc99107: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_32b398fb48b6d94a: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_cd45aabdf6073e84: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_da52cf8fe3429cb2: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_7568ba55b4a7e81f: function(arg0, arg1) {
            const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_77cdfb7977362f3c: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_ddf8b82c4d6af38e: function(arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_next_6dbf2c0ac8cde20f: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_71f2aa1cb3d1e37e: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_8535240470bf2500: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_8a16b38e4805b298: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_a5d5488a9589444a: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./wmvx_wasm_bg.js": import0,
    };
}

const LegacyDatabaseFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_legacydatabase_free(ptr, 1));
const Mat4Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mat4_free(ptr, 1));
const QuatFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_quat_free(ptr, 1));
const ResolvedCharacterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_resolvedcharacter_free(ptr, 1));
const Vec2Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vec2_free(ptr, 1));
const Vec3Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vec3_free(ptr, 1));
const Vec4Finalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vec4_free(ptr, 1));
const WmvxCharacterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wmvxcharacter_free(ptr, 1));
const WmvxModelFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wmvxmodel_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('wmvx_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
