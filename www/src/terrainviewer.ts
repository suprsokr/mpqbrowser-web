/**
 * A terrain tile (ADT) preview: the 256 MCNK chunks as the client's terrain streamer meshes them,
 * each with its four MCLQ layer layers blended by the chunk's alpha map, the MCSH shadow multiply
 * and its liquid surfaces, plus a camera you can fly.
 *
 * Parsing is `benilla_formats::adt_to_tile_mesh` in wasm; this module is the WebGL2 plumbing.
 */

/** One MTEX entry: the file, and how many chunks of the tile draw it. */
export interface AdtTexture {
  name: string;
  chunks: number;
}

export interface AdtLiquid {
  positions: Float32Array;
  indices: Uint32Array;
  /** Depth swatch coordinate per vertex: 0 shallow, 1 the ramp's saturation. */
  depths: Float32Array;
  kind: string;
}

export interface AdtChunk {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Texture-array index per layer slot; `-1` where the chunk has no such layer. */
  layers: Uint32Array;
  /** The chunk's corner in the alpha atlas, in texels; null with a single layer. */
  alphaAtlas: Float32Array | null;
  shadowAtlas: Float32Array | null;
  liquids: AdtLiquid[];
  /** `AreaTable` id under the chunk, for the info line. */
  areaId: number;
}

/** A placed model and every placement of it in a tile. */
export interface PlacedModel {
  model: string;
  count: number;
  /** `[x, y, z, rx, ry, rz, scale]` per instance. */
  placements: Float32Array[];
}

/** Doodads and buildings baked into world space, one entry per merged batch. */
export interface PropsPayload {
  textures: { name: string; width: number; height: number; rgba: Uint8Array }[];
  batches: {
    kind: 'doodad' | 'building';
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

export interface AdtPayload {
  textures: AdtTexture[];
  decoded: { name: string; width: number; height: number; rgba: Uint8Array }[];
  chunks: AdtChunk[];
  doodads: PlacedModel[];
  wmos: PlacedModel[];
  /** `AreaTable` ids under the tile, named by the table. */
  areas: { id: number; name: string }[];
  /** The DBC tables this preview read. */
  tables: string[];
  alphaAtlas: Uint8Array;
  alphaAtlasSide: number;
  shadowAtlas: Uint8Array;
  shadowAtlasSide: number;
  vertexCount: number;
  triangleCount: number;
}

// --- column-major mat4 helpers, the same shape `m2viewer` uses ---

function mat4Identity(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4LookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const m = mat4Identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  return m;
}

function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize(a: number[]): number[] {
  const len = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / len, a[1] / len, a[2] / len];
}

// --- shaders ---

const TERRAIN_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_viewProj;
out vec3 v_normal;
out vec2 v_uv;
out vec3 v_world;
void main() {
  v_world = a_position;
  v_normal = a_normal;
  v_uv = a_uv;
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}`;

const TERRAIN_FRAG = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec2 v_uv;
in vec3 v_world;
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_tex2;
uniform sampler2D u_tex3;
uniform sampler2D u_alpha;
uniform sampler2D u_shadow;
uniform int u_layers;        // 1..4, how many of the samplers this chunk uses
uniform float u_hasAlpha;    // 1 when the chunk's alpha map is in the atlas
uniform float u_hasShadow;   // 1 when the chunk's MCSH map is in the atlas
uniform vec4 u_alphaTile;    // xy = origin in atlas uv, zw = tile size in atlas uv
uniform vec4 u_shadowTile;
uniform float u_uvScale;     // texture repeats per chunk (the client's fixed 8)
uniform vec3 u_sun;
uniform vec3 u_eye;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;
out vec4 fragColor;

void main() {
  vec2 tiled = v_uv * u_uvScale;
  vec3 color = texture(u_tex0, tiled).rgb;
  // The alpha map's R/G/B are the blend weights of layers 1/2/3, in the client's order.
  vec2 auv = clamp(v_uv, vec2(0.5 / 64.0), vec2(1.0 - 0.5 / 64.0));
  vec4 a = u_hasAlpha > 0.5 ? texture(u_alpha, u_alphaTile.xy + auv * u_alphaTile.zw) : vec4(0.0);
  if (u_layers > 1) color = mix(color, texture(u_tex1, tiled).rgb, a.r);
  if (u_layers > 2) color = mix(color, texture(u_tex2, tiled).rgb, a.g);
  if (u_layers > 3) color = mix(color, texture(u_tex3, tiled).rgb, a.b);

  // MCSH: 255 shadowed, 0 lit. The client scales diffuse by 0.3 in shadow, no tint.
  float shadow = 1.0;
  if (u_hasShadow > 0.5) {
    shadow = 1.0 - texture(u_shadow, u_shadowTile.xy + auv * u_shadowTile.zw).r;
  }

  float diff = max(dot(normalize(v_normal), u_sun), 0.0);
  vec3 lit = color * (0.45 + 0.55 * diff) * (0.3 * shadow + 0.7);

  float dist = length(v_world - u_eye);
  float fog = clamp((u_fogRange.y - dist) / max(u_fogRange.y - u_fogRange.x, 1.0), 0.0, 1.0);
  fragColor = vec4(mix(u_fogColor, lit, fog), 1.0);
}`;

const LIQUID_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in float a_depth;
uniform mat4 u_viewProj;
out vec3 v_world;
out float v_depth;
void main() {
  v_world = a_position;
  v_depth = a_depth;
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}`;

const LIQUID_FRAG = `#version 300 es
precision highp float;
in vec3 v_world;
in float v_depth;
uniform vec4 u_shallow;   // body colour at the shore
uniform vec4 u_deep;      // body colour where the depth ramp saturates; alpha 1 = opaque (magma)
uniform vec3 u_eye;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;
out vec4 fragColor;
void main() {
  // The reference's depth ramp: the swatch coordinate fades body colour and opacity together, so
  // a shoreline is clear water over sand and the open sea is dark.
  float d = clamp(v_depth, 0.0, 1.0);
  vec3 body = mix(u_shallow.rgb, u_deep.rgb, d);
  float alpha = mix(u_shallow.a, u_deep.a, d);
  float dist = length(v_world - u_eye);
  float fog = clamp((u_fogRange.y - dist) / max(u_fogRange.y - u_fogRange.x, 1.0), 0.0, 1.0);
  fragColor = vec4(mix(u_fogColor, body, fog), mix(1.0, alpha, fog));
}`;

/**
 * A liquid's body colours at the ends of the depth ramp, `[r, g, b, a]` each: the shore swatch
 * first, the saturated one second. Magma is opaque at both ends, and unlit.
 */
const LIQUID_COLORS: Record<string, [[number, number, number, number], [number, number, number, number]]> = {
  still: [[0.34, 0.56, 0.6, 0.3], [0.06, 0.2, 0.3, 0.92]],
  rapids: [[0.4, 0.6, 0.64, 0.3], [0.08, 0.26, 0.36, 0.92]],
  ocean: [[0.32, 0.55, 0.62, 0.26], [0.04, 0.15, 0.3, 0.94]],
  magma: [[0.62, 0.16, 0.05, 1.0], [0.42, 0.08, 0.02, 1.0]],
  slime: [[0.42, 0.55, 0.2, 0.9], [0.22, 0.34, 0.1, 0.95]],
};

const PROP_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_viewProj;
out vec3 v_normal;
out vec2 v_uv;
out vec3 v_world;
void main() {
  v_world = a_position;
  v_normal = a_normal;
  v_uv = a_uv;
  gl_Position = u_viewProj * vec4(a_position, 1.0);
}`;

const PROP_FRAG = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec2 v_uv;
in vec3 v_world;
uniform sampler2D u_tex;
uniform float u_alphaTest;   // discard below this; 0 for an opaque batch
uniform vec3 u_sun;
uniform vec3 u_eye;
uniform vec3 u_fogColor;
uniform vec2 u_fogRange;
out vec4 fragColor;
void main() {
  vec4 tex = texture(u_tex, v_uv);
  if (tex.a < u_alphaTest) discard;
  float diff = max(dot(normalize(v_normal), u_sun), 0.0);
  vec3 lit = tex.rgb * (0.5 + 0.5 * diff);
  float dist = length(v_world - u_eye);
  float fog = clamp((u_fogRange.y - dist) / max(u_fogRange.y - u_fogRange.x, 1.0), 0.0, 1.0);
  fragColor = vec4(mix(u_fogColor, lit, fog), tex.a);
}`;

const SKY: [number, number, number] = [0.58, 0.7, 0.85];

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('failed to create shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile error: ${info}`);
  }
  return sh;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vert: string,
  frag: string
): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error('failed to create program');
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link error: ${info}`);
  }
  return prog;
}

interface ChunkGpu {
  vao: WebGLVertexArrayObject;
  position: WebGLBuffer;
  normal: WebGLBuffer;
  uv: WebGLBuffer;
  index: WebGLBuffer;
  indexCount: number;
  /** The four sampler units' textures, layer 0 first; unused slots repeat layer 0. */
  textures: WebGLTexture[];
  layers: number;
  alphaTile: [number, number, number, number] | null;
  shadowTile: [number, number, number, number] | null;
}

interface PropGpu {
  vao: WebGLVertexArrayObject;
  position: WebGLBuffer;
  normal: WebGLBuffer;
  uv: WebGLBuffer;
  index: WebGLBuffer;
  indexCount: number;
  texture: WebGLTexture;
  blend: number;
  twoSided: boolean;
  kind: 'doodad' | 'building';
}

interface LiquidGpu {
  vao: WebGLVertexArrayObject;
  position: WebGLBuffer;
  depth: WebGLBuffer;
  index: WebGLBuffer;
  indexCount: number;
  shallow: [number, number, number, number];
  deep: [number, number, number, number];
}

export class TerrainViewer {
  private gl: WebGL2RenderingContext;
  private terrainProgram: WebGLProgram;
  private liquidProgram: WebGLProgram;
  private chunks: ChunkGpu[] = [];
  private liquids: LiquidGpu[] = [];
  private textures: WebGLTexture[] = [];
  private placeholder!: WebGLTexture;
  private alphaTexture!: WebGLTexture;
  private shadowTexture!: WebGLTexture;
  private propProgram: WebGLProgram;
  private props: PropGpu[] = [];
  /** `props`, opaque and cutouts first, so the blended batches draw last. */
  private propsOrdered: PropGpu[] = [];
  private propTextures: WebGLTexture[] = [];
  /** Which of the two kinds of placed model the view draws. */
  private showKind = { doodad: true, building: true };

  // Camera: the ADT's own frame (+X north, +Y west, +Z up), so no axis swap anywhere.
  private eye: [number, number, number] = [0, 0, 0];
  private yaw = 0;
  private pitch = -0.5;
  private speed = 60;
  private readonly home: [number, number, number];
  private readonly homeYaw: number;
  private readonly homePitch: number;

  private keys = new Set<string>();
  /** Stick deflection, -1..1: `move` gives forward/strafe, `look` a yaw/pitch rate. */
  private moveInput = { x: 0, y: 0 };
  private lookInput = { x: 0, y: 0 };
  /** The touch pads, present only on a coarse pointer. */
  private touchPad: HTMLDivElement | null = null;
  private rafId = 0;
  private lastTime = 0;
  private disposed = false;
  /** Where the tile's ground sits, for the info line's altitude readout. */
  readonly groundZ: number;
  /** Extent of the tile in yards, from its terrain vertices. */
  readonly extent: number;

  readonly ready: Promise<void>;

  constructor(
    private canvas: HTMLCanvasElement,
    private payload: AdtPayload
  ) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) {
      throw new Error('WebGL2 is not available in this browser');
    }
    this.gl = gl;
    this.terrainProgram = linkProgram(gl, TERRAIN_VERT, TERRAIN_FRAG);
    this.liquidProgram = linkProgram(gl, LIQUID_VERT, LIQUID_FRAG);
    this.propProgram = linkProgram(gl, PROP_VERT, PROP_FRAG);

    const bounds = this.payloadBounds();
    this.groundZ = bounds.maxZ;
    this.extent = bounds.extent;
    // Stand just south of the tile, a little above its highest ground, and look north across it:
    // from directly overhead the ground below is at 90 degrees and falls outside the frustum.
    this.home = [
      bounds.minX - bounds.extent * 0.25,
      bounds.center[1],
      Math.max(bounds.maxZ, bounds.liquidZ) + bounds.extent * 0.45,
    ];
    this.homeYaw = 0;
    this.homePitch = -0.87;
    this.eye = [...this.home] as [number, number, number];
    this.yaw = this.homeYaw;
    this.pitch = this.homePitch;

    this.attachControls();
    this.ready = this.init();
  }

  private payloadBounds(): {
    center: [number, number, number];
    minX: number;
    maxZ: number;
    minZ: number;
    extent: number;
    liquidZ: number;
  } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const chunk of this.payload.chunks) {
      const p = chunk.positions;
      for (let i = 0; i < p.length; i += 3) {
        minX = Math.min(minX, p[i]);
        maxX = Math.max(maxX, p[i]);
        minY = Math.min(minY, p[i + 1]);
        maxY = Math.max(maxY, p[i + 1]);
        minZ = Math.min(minZ, p[i + 2]);
        maxZ = Math.max(maxZ, p[i + 2]);
      }
    }
    // The highest surface in the tile, ground or water: a deep-ocean tile's floor sits hundreds of
    // yards under its sea-level ocean plane, and opening the camera under it puts the water sheet
    // overhead like a ceiling.
    let liquidZ = -Infinity;
    for (const chunk of this.payload.chunks) {
      for (const liquid of chunk.liquids) {
        const p = liquid.positions;
        for (let i = 2; i < p.length; i += 3) {
          if (Math.abs(p[i]) < 1e5) liquidZ = Math.max(liquidZ, p[i]);
        }
      }
    }
    if (!Number.isFinite(minX)) {
      return { center: [0, 0, 0], minX: 0, maxZ: 0, minZ: 0, extent: 533, liquidZ: 0 };
    }
    return {
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      minX,
      maxZ,
      minZ,
      extent: Math.max(maxX - minX, maxY - minY, maxZ - minZ),
      liquidZ: Number.isFinite(liquidZ) ? liquidZ : -Infinity,
    };
  }

  private async init(): Promise<void> {
    const gl = this.gl;
    this.placeholder = this.createTexture(1, 1, new Uint8Array([90, 90, 96, 255]));
    // `payload.textures` is the MTEX order `chunk.layers` indexes; a texture that failed to
    // decode keeps its slot but binds the placeholder.
    const byName = new Map<string, { width: number; height: number; rgba: Uint8Array }>();
    for (const decoded of this.payload.decoded) {
      byName.set(decoded.name.toLowerCase(), decoded);
    }
    const layerForMtex: number[] = [];
    this.payload.textures.forEach((texture) => {
      const decoded = byName.get(texture.name.toLowerCase());
      if (!decoded) {
        layerForMtex.push(-1);
        return;
      }
      layerForMtex.push(this.textures.length);
      this.textures.push(this.createTexture(decoded.width, decoded.height, decoded.rgba));
    });

    this.alphaTexture = this.createAtlas(
      this.payload.alphaAtlasSide,
      this.payload.alphaAtlas,
      4
    );
    this.shadowTexture = this.createAtlas(
      this.payload.shadowAtlasSide,
      this.payload.shadowAtlas,
      1
    );

    for (const chunk of this.payload.chunks) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const position = this.attribute(0, chunk.positions, 3);
      const normal = this.attribute(1, chunk.normals, 3);
      const uv = this.attribute(2, chunk.uvs, 2);
      const index = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      const used: WebGLTexture[] = [];
      for (let slot = 0; slot < 4; slot++) {
        const mtex = chunk.layers[slot];
        const layer = mtex === undefined || mtex === 0xffffffff ? -1 : layerForMtex[mtex] ?? -1;
        used.push(layer >= 0 ? this.textures[layer] : this.placeholder);
      }
      // Declared layer count: how many slots the chunk actually names, so the shader skips the
      // `mix` calls whose alpha weight is 0 anyway.
      let layers = 1;
      for (let slot = 0; slot < 4; slot++) {
        const mtex = chunk.layers[slot];
        if (mtex !== undefined && mtex !== 0xffffffff) layers = slot + 1;
      }

      const side = this.payload.alphaAtlasSide;
      const tileSize = 64 / side;
      const tile = (corner: Float32Array | null): [number, number, number, number] | null =>
        corner
          ? [corner[0] / side, corner[1] / side, tileSize, tileSize]
          : null;
      this.chunks.push({
        vao,
        position,
        normal,
        uv,
        index,
        indexCount: chunk.indices.length,
        textures: used,
        layers,
        alphaTile: tile(chunk.alphaAtlas),
        shadowTile: tile(chunk.shadowAtlas),
      });
    }

    // All liquid surfaces of one kind share one draw: they are the same colour and blend state.
    const byKind = new Map<string, { positions: number[]; depths: number[]; indices: number[] }>();
    for (const chunk of this.payload.chunks) {
      for (const liquid of chunk.liquids) {
        let bucket = byKind.get(liquid.kind);
        if (!bucket) {
          bucket = { positions: [], depths: [], indices: [] };
          byKind.set(liquid.kind, bucket);
        }
        const base = bucket.positions.length / 3;
        for (let i = 0; i < liquid.positions.length; i++) {
          bucket.positions.push(liquid.positions[i]);
        }
        for (let i = 0; i < liquid.depths.length; i++) {
          bucket.depths.push(liquid.depths[i]);
        }
        for (let i = 0; i < liquid.indices.length; i++) {
          bucket.indices.push(liquid.indices[i] + base);
        }
      }
    }
    for (const [kind, bucket] of byKind) {
      if (bucket.indices.length === 0) continue;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const position = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bucket.positions), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const depth = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, depth);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bucket.depths), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
      const index = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(bucket.indices), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const ramp = LIQUID_COLORS[kind] ?? LIQUID_COLORS.still;
      this.liquids.push({
        vao,
        position,
        depth,
        index,
        indexCount: bucket.indices.length,
        shallow: ramp[0],
        deep: ramp[1],
      });
    }

    this.buildTouchPads();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  private attribute(location: number, data: Float32Array, size: number): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  private createTexture(width: number, height: number, rgba: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba
    );
    const powerOfTwo = (width & (width - 1)) === 0 && (height & (height - 1)) === 0;
    if (powerOfTwo) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    // Anisotropy keeps a ground plane from smearing at a glancing angle.
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso && powerOfTwo) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(max, 8));
    }
    return texture;
  }

  /** The alpha (RGBA) and shadow (R8) atlases: one 64-texel tile per chunk, no mips. */
  private createAtlas(side: number, bytes: Uint8Array, channels: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      channels === 4 ? gl.RGBA : gl.R8,
      side,
      side,
      0,
      channels === 4 ? gl.RGBA : gl.RED,
      gl.UNSIGNED_BYTE,
      bytes
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private attachControls(): void {
    const canvas = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus();
    });
    const stop = (e: PointerEvent) => {
      dragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.yaw += dx * 0.005;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.005));
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.speed = Math.max(8, Math.min(1200, this.speed * Math.exp(-e.deltaY * 0.0015)));
      },
      { passive: false }
    );
    canvas.tabIndex = 0;

    const down = (e: KeyboardEvent) => {
      // Typing in the page's filter box is not flying.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' || e.code.startsWith('Key') || e.code.startsWith('Arrow')) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    // Listen on the document so the fly keys work with the pointer over the page, but only while
    // this canvas is the one in view: leaving the tile preview stops the movement.
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    this.detachKeys = () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
    };
  }

  private detachKeys: (() => void) | null = null;

  /** Upload the doodads and buildings the worker baked, replacing any already in the view. */
  setProps(payload: PropsPayload): void {
    this.clearProps();
    const gl = this.gl;
    for (const texture of payload.textures) {
      this.propTextures.push(
        texture.rgba.length
          ? this.createTexture(texture.width, texture.height, texture.rgba)
          : this.placeholder
      );
    }
    for (const batch of payload.batches) {
      if (batch.indices.length === 0) continue;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const position = this.attribute(0, batch.positions, 3);
      const normal = this.attribute(1, batch.normals, 3);
      const uv = this.attribute(2, batch.uvs, 2);
      const index = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.props.push({
        vao,
        position,
        normal,
        uv,
        index,
        indexCount: batch.indices.length,
        texture: this.propTextures[batch.texture] ?? this.placeholder,
        blend: batch.blend,
        twoSided: batch.twoSided,
        kind: batch.kind,
      });
    }
    // Opaque and alpha-tested batches first, then the blended ones.
    this.propsOrdered = [...this.props].sort(
      (a, b) => (a.blend === 2 ? 1 : 0) - (b.blend === 2 ? 1 : 0)
    );
  }

  /** Draw or hide one kind of placed model. */
  setPropsVisible(kind: 'doodad' | 'building', visible: boolean): void {
    this.showKind[kind] = visible;
  }

  private clearProps(): void {
    const gl = this.gl;
    for (const prop of this.props) {
      gl.deleteBuffer(prop.position);
      gl.deleteBuffer(prop.normal);
      gl.deleteBuffer(prop.uv);
      gl.deleteBuffer(prop.index);
      gl.deleteVertexArray(prop.vao);
    }
    this.props = [];
    this.propsOrdered = [];
    // The placeholder is shared with the texture slots, so it outlives these.
    for (const texture of this.propTextures) {
      if (texture !== this.placeholder) gl.deleteTexture(texture);
    }
    this.propTextures = [];
  }

  /** Back to the tile's opening view. */
  reset(): void {
    this.eye = [...this.home] as [number, number, number];
    this.yaw = this.homeYaw;
    this.pitch = this.homePitch;
    this.speed = 60;
  }

  /** Hold a fly key from the page's touch controls. */
  setKey(code: string, down: boolean): void {
    if (down) {
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  /** Where the camera is now, for the info line. */
  get altitude(): number {
    return this.eye[2];
  }

  get currentSpeed(): number {
    return this.speed;
  }

  /**
   * Two thumbsticks over the canvas for touch: the left one flies, the right one looks. Buttons
   * beside the left stick work the altitude, which has no axis of its own.
   */
  private buildTouchPads(): void {
    const coarse =
      window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const host = this.canvas.parentElement;
    if (!coarse || !host) {
      return;
    }
    const pad = document.createElement('div');
    pad.className = 'terrain-touchpad';
    pad.append(this.makeStick('move'), this.makeStick('look'));

    const alts = document.createElement('div');
    alts.className = 'stick-alts';
    for (const [label, code] of [['↟', 'Space'], ['↡', 'KeyC']] as [string, string][]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = code === 'Space' ? 'Fly up' : 'Fly down';
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        this.setKey(code, true);
      });
      const release = () => this.setKey(code, false);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', release);
      alts.appendChild(button);
    }
    pad.append(alts);
    host.appendChild(pad);
    this.touchPad = pad;
  }

  private makeStick(kind: 'move' | 'look'): HTMLDivElement {
    const root = document.createElement('div');
    root.className = `stick stick-${kind}`;
    const knob = document.createElement('div');
    knob.className = 'stick-knob';
    root.appendChild(knob);
    // Pixels of travel from the centre to full deflection, i.e. the ring's inner radius.
    const radius = 34;
    let pointer: number | null = null;

    const apply = (dx: number, dy: number) => {
      const length = Math.hypot(dx, dy);
      const scale = length > radius ? radius / length : 1;
      const x = dx * scale;
      const y = dy * scale;
      knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      const nx = x / radius;
      // Screen Y grows downward: pushing up is +forward, and for the look stick pushing down
      // pitches the view down.
      const ny = y / radius;
      if (kind === 'move') {
        this.moveInput.x = nx;
        this.moveInput.y = -ny;
      } else {
        this.lookInput.x = nx;
        this.lookInput.y = ny;
      }
    };
    const release = () => {
      pointer = null;
      knob.style.transform = 'translate(-50%, -50%)';
      if (kind === 'move') {
        this.moveInput = { x: 0, y: 0 };
      } else {
        this.lookInput = { x: 0, y: 0 };
      }
    };
    const offset = (e: PointerEvent) => {
      const box = root.getBoundingClientRect();
      return [e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2)];
    };

    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pointer = e.pointerId;
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer has no capture */
      }
      const [dx, dy] = offset(e);
      apply(dx, dy);
    });
    root.addEventListener('pointermove', (e) => {
      if (pointer !== e.pointerId) return;
      e.preventDefault();
      const [dx, dy] = offset(e);
      apply(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return;
      release();
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('lostpointercapture', end);
    return root;
  }

  private step(dt: number): void {
    const forward = [
      Math.cos(this.pitch) * Math.cos(this.yaw),
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
    ];
    const right = [Math.sin(this.yaw), -Math.cos(this.yaw), 0];
    const keys = this.keys;
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
    const speed = this.speed * boost * dt;
    const move = [0, 0, 0];
    const add = (dir: number[], amount: number) => {
      move[0] += dir[0] * amount;
      move[1] += dir[1] * amount;
      move[2] += dir[2] * amount;
    };
    if (keys.has('KeyW') || keys.has('ArrowUp')) add(forward, speed);
    if (keys.has('KeyS') || keys.has('ArrowDown')) add(forward, -speed);
    if (keys.has('KeyD') || keys.has('ArrowRight')) add(right, speed);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) add(right, -speed);
    if (keys.has('Space')) move[2] += speed;
    if (keys.has('KeyC') || keys.has('KeyZ')) move[2] -= speed;

    // The sticks fly at whatever speed the wheel picked, so a half push is half speed.
    if (this.moveInput.x !== 0 || this.moveInput.y !== 0) {
      add(forward, this.moveInput.y * speed);
      add(right, this.moveInput.x * speed);
    }
    this.eye = [this.eye[0] + move[0], this.eye[1] + move[1], this.eye[2] + move[2]];

    if (this.lookInput.x !== 0 || this.lookInput.y !== 0) {
      this.yaw += this.lookInput.x * 2.2 * dt;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - this.lookInput.y * 1.6 * dt));
    }
  }

  private frame(now: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.step(dt);
    this.draw();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  private resize(): void {
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  private draw(): void {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    const forward: [number, number, number] = [
      Math.cos(this.pitch) * Math.cos(this.yaw),
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
    ];
    const target: [number, number, number] = [
      this.eye[0] + forward[0],
      this.eye[1] + forward[1],
      this.eye[2] + forward[2],
    ];
    const view = mat4LookAt(this.eye, target, [0, 0, 1]);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective((55 * Math.PI) / 180, aspect, 0.5, 2400);
    const viewProj = mat4Multiply(proj, view);

    // Terrain.
    gl.useProgram(this.terrainProgram);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.terrainProgram, 'u_viewProj'),
      false,
      viewProj
    );
    gl.uniform1f(gl.getUniformLocation(this.terrainProgram, 'u_uvScale'), 8);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProgram, 'u_sun'), [0.32, 0.5, 0.8]);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProgram, 'u_eye'), this.eye);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProgram, 'u_fogColor'), SKY);
    gl.uniform2fv(gl.getUniformLocation(this.terrainProgram, 'u_fogRange'), [
      this.extent * 0.9,
      this.extent * 2.2,
    ]);
    const uLayers = gl.getUniformLocation(this.terrainProgram, 'u_layers');
    const uHasAlpha = gl.getUniformLocation(this.terrainProgram, 'u_hasAlpha');
    const uHasShadow = gl.getUniformLocation(this.terrainProgram, 'u_hasShadow');
    const uAlphaTile = gl.getUniformLocation(this.terrainProgram, 'u_alphaTile');
    const uShadowTile = gl.getUniformLocation(this.terrainProgram, 'u_shadowTile');
    const samplers = [0, 1, 2, 3].map((i) =>
      gl.getUniformLocation(this.terrainProgram, `u_tex${i}`)
    );
    gl.uniform1i(gl.getUniformLocation(this.terrainProgram, 'u_alpha'), 4);
    gl.uniform1i(gl.getUniformLocation(this.terrainProgram, 'u_shadow'), 5);
    samplers.forEach((loc, i) => gl.uniform1i(loc, i));

    gl.disable(gl.BLEND);
    for (const chunk of this.chunks) {
      if (chunk.indexCount === 0) continue;
      for (let i = 0; i < 4; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, chunk.textures[i]);
      }
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.alphaTexture);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTexture);
      gl.activeTexture(gl.TEXTURE0);

      gl.uniform1i(uLayers, chunk.layers);
      gl.uniform1f(uHasAlpha, chunk.alphaTile ? 1 : 0);
      gl.uniform1f(uHasShadow, chunk.shadowTile ? 1 : 0);
      gl.uniform4fv(uAlphaTile, chunk.alphaTile ?? [0, 0, 0, 0]);
      gl.uniform4fv(uShadowTile, chunk.shadowTile ?? [0, 0, 0, 0]);
      gl.bindVertexArray(chunk.vao);
      gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
    }

    // Doodads and buildings, over the ground.
    if (this.props.length) {
      gl.useProgram(this.propProgram);
      gl.uniformMatrix4fv(
        gl.getUniformLocation(this.propProgram, 'u_viewProj'),
        false,
        viewProj
      );
      gl.uniform3fv(gl.getUniformLocation(this.propProgram, 'u_sun'), [0.32, 0.5, 0.8]);
      gl.uniform3fv(gl.getUniformLocation(this.propProgram, 'u_eye'), this.eye);
      gl.uniform3fv(gl.getUniformLocation(this.propProgram, 'u_fogColor'), SKY);
      gl.uniform2fv(gl.getUniformLocation(this.propProgram, 'u_fogRange'), [
        this.extent * 0.9,
        this.extent * 2.2,
      ]);
      gl.uniform1i(gl.getUniformLocation(this.propProgram, 'u_tex'), 0);
      const uAlphaTest = gl.getUniformLocation(this.propProgram, 'u_alphaTest');
      for (const prop of this.propsOrdered) {
        if (!this.showKind[prop.kind]) continue;
        if (prop.twoSided) gl.disable(gl.CULL_FACE);
        else gl.enable(gl.CULL_FACE);
        if (prop.blend === 0) {
          gl.disable(gl.BLEND);
          gl.uniform1f(uAlphaTest, 0);
        } else if (prop.blend === 1) {
          gl.disable(gl.BLEND);
          gl.uniform1f(uAlphaTest, 0.5);
        } else {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.uniform1f(uAlphaTest, 0.01);
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prop.texture);
        gl.bindVertexArray(prop.vao);
        gl.drawElements(gl.TRIANGLES, prop.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
    }

    // Liquid, after the ground, without writing depth: it is a translucent top surface.
    if (this.liquids.length) {
      gl.useProgram(this.liquidProgram);
      gl.uniformMatrix4fv(
        gl.getUniformLocation(this.liquidProgram, 'u_viewProj'),
        false,
        viewProj
      );
      gl.uniform3fv(gl.getUniformLocation(this.liquidProgram, 'u_eye'), this.eye);
      gl.uniform3fv(gl.getUniformLocation(this.liquidProgram, 'u_fogColor'), SKY);
      gl.uniform2fv(gl.getUniformLocation(this.liquidProgram, 'u_fogRange'), [
        this.extent * 0.9,
        this.extent * 2.2,
      ]);
      const uShallow = gl.getUniformLocation(this.liquidProgram, 'u_shallow');
      const uDeep = gl.getUniformLocation(this.liquidProgram, 'u_deep');
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const liquid of this.liquids) {
        gl.uniform4fv(uShallow, liquid.shallow);
        gl.uniform4fv(uDeep, liquid.deep);
        gl.bindVertexArray(liquid.vao);
        gl.drawElements(gl.TRIANGLES, liquid.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.depthMask(true);
    }

    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.detachKeys?.();
    this.touchPad?.remove();
    this.touchPad = null;
    const gl = this.gl;
    try {
      for (const chunk of this.chunks) {
        gl.deleteBuffer(chunk.position);
        gl.deleteBuffer(chunk.normal);
        gl.deleteBuffer(chunk.uv);
        gl.deleteBuffer(chunk.index);
        gl.deleteVertexArray(chunk.vao);
      }
      for (const liquid of this.liquids) {
        gl.deleteBuffer(liquid.position);
        gl.deleteBuffer(liquid.depth);
        gl.deleteBuffer(liquid.index);
        gl.deleteVertexArray(liquid.vao);
      }
      this.clearProps();
      for (const texture of this.textures) gl.deleteTexture(texture);
      gl.deleteTexture(this.placeholder);
      gl.deleteTexture(this.alphaTexture);
      gl.deleteTexture(this.shadowTexture);
      gl.deleteProgram(this.terrainProgram);
      gl.deleteProgram(this.liquidProgram);
      gl.deleteProgram(this.propProgram);
    } catch {
      /* context may already be lost */
    }
  }
}
