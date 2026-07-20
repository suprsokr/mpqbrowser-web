/**
 * WebGL2 preview renderer for World of Warcraft M2 models.
 *
 * The heavy lifting (parsing, animation, CPU vertex skinning, texture
 * lookup resolution) is done by the `wow-m2-web` wasm package via the
 * `M2Renderer` class. This module owns the WebGL plumbing: an orbit
 * camera, per-batch textured draw calls with the right blend/cull state,
 * and a `requestAnimationFrame` loop that advances the animation.
 */
import initM2, { M2Renderer } from 'wow-m2-web';

/** A decoded texture as produced by the worker. */
export interface DecodedTexture {
  index: number;
  filename: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** Everything needed to build a viewer, produced by the worker. */
export interface M2Payload {
  m2Bytes: Uint8Array;
  skinBytes: Uint8Array | null;
  textures: DecodedTexture[];
}

interface BatchInfo {
  submesh: number;
  submeshId: number;
  textureIndex: number;
  textureComboIndex: number;
  blendMode: number;
  twoSided: boolean;
  unlit: boolean;
  noDepthWrite: boolean;
  indexStart: number;
  indexCount: number;
}

export interface AnimationInfo {
  index: number;
  id: number;
  subId: number;
  duration: number;
  flags: number;
}

let m2InitPromise: Promise<unknown> | null = null;
function ensureM2Init(): Promise<unknown> {
  if (!m2InitPromise) {
    m2InitPromise = Promise.resolve(initM2());
  }
  return m2InitPromise;
}

// --- tiny column-major mat4 helpers (no external deps) ---

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

/** Build a view matrix from eye/target/up (right-handed, like gluLookAt). */
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

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_normal;
out vec2 v_uv;
void main() {
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(a_position, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alphaTest;   // discard threshold (alpha-key)
uniform float u_unlit;       // 1.0 = full bright
uniform float u_wireframe;   // 1.0 = flat white overlay
out vec4 fragColor;
void main() {
  vec4 tex = texture(u_tex, v_uv);
  if (tex.a < u_alphaTest) discard;
  // Simple two-sided headlight so the mesh is readable from any angle.
  vec3 n = normalize(v_normal);
  vec3 lightDir = normalize(vec3(0.3, 0.7, 0.6));
  float diff = max(abs(dot(n, lightDir)), 0.0);
  float shade = mix(0.35 + 0.65 * diff, 1.0, u_unlit);
  vec3 rgb = tex.rgb * shade;
  if (u_wireframe > 0.5) {
    fragColor = vec4(0.6, 0.9, 1.0, 1.0);
  } else {
    fragColor = vec4(rgb, tex.a);
  }
}`;

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

function linkProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error('failed to create program');
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
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

/** WoW blend mode ids (from `M2BlendMode`). */
const BLEND_OPAQUE = 0;
const BLEND_ALPHA_KEY = 1;
const BLEND_ALPHA = 2;
const BLEND_NO_ALPHA_ADD = 3;
const BLEND_ADD = 4;
const BLEND_MOD = 5;
const BLEND_MOD2X = 6;

/**
 * A self-contained WebGL2 viewer for a single M2 model. Construct it,
 * `await ready`, then it renders and animates on its own until `dispose`.
 */
export class M2Viewer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private renderer!: M2Renderer;
  private vao!: WebGLVertexArrayObject;
  private posBuffer!: WebGLBuffer;
  private normalBuffer!: WebGLBuffer;
  private uvBuffer!: WebGLBuffer;
  private indexBuffer!: WebGLBuffer;
  private batches: BatchInfo[] = [];
  private glTextures = new Map<number, WebGLTexture>();
  private whiteTexture!: WebGLTexture;

  private uMvp: WebGLUniformLocation | null;
  private uModel: WebGLUniformLocation | null;
  private uTex: WebGLUniformLocation | null;
  private uAlphaTest: WebGLUniformLocation | null;
  private uUnlit: WebGLUniformLocation | null;
  private uWireframe: WebGLUniformLocation | null;

  // Orbit camera state.
  private yaw = 0.6;
  private pitch = 0.3;
  private distance = 3;
  private center: [number, number, number] = [0, 0, 0];

  private playing = true;
  private wireframe = false;
  private lastTime = 0;
  private rafId = 0;
  private disposed = false;

  /** Resolves once wasm is initialized and the model is uploaded. */
  readonly ready: Promise<void>;
  animations: AnimationInfo[] = [];

  constructor(private canvas: HTMLCanvasElement, private payload: M2Payload) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!gl) {
      throw new Error('WebGL2 is not available in this browser');
    }
    this.gl = gl;
    this.program = linkProgram(gl);
    this.uMvp = gl.getUniformLocation(this.program, 'u_mvp');
    this.uModel = gl.getUniformLocation(this.program, 'u_model');
    this.uTex = gl.getUniformLocation(this.program, 'u_tex');
    this.uAlphaTest = gl.getUniformLocation(this.program, 'u_alphaTest');
    this.uUnlit = gl.getUniformLocation(this.program, 'u_unlit');
    this.uWireframe = gl.getUniformLocation(this.program, 'u_wireframe');

    this.attachControls();
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await ensureM2Init();
    const gl = this.gl;

    this.renderer = new M2Renderer(
      this.payload.m2Bytes,
      this.payload.skinBytes ?? undefined
    );
    this.batches = this.renderer.batches() as BatchInfo[];
    this.animations = this.renderer.animations() as AnimationInfo[];

    // Static buffers.
    const indices = this.renderer.indices();
    const uvs = this.renderer.texCoords();

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    this.posBuffer = gl.createBuffer()!;
    this.normalBuffer = gl.createBuffer()!;
    this.uvBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;

    // Position (dynamic — updated each frame from CPU skinning).
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.renderer.vertexCount() * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Normal (dynamic).
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.renderer.vertexCount() * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    // UV (static).
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    // Textures.
    this.whiteTexture = this.createSolidTexture([200, 200, 200, 255]);
    for (const tex of this.payload.textures) {
      this.glTextures.set(tex.index, this.createTexture(tex));
    }

    // Frame the model with the camera.
    this.frameModel();

    // Default animation.
    if (this.animations.length > 0) {
      this.renderer.setAnimation(this.animations[0].index);
    }

    // Prime the first skinned frame.
    this.renderer.update(0);

    gl.clearColor(0.07, 0.07, 0.08, 1);
    gl.enable(gl.DEPTH_TEST);

    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private createSolidTexture(rgba: [number, number, number, number]): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(rgba)
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private createTexture(tex: DecodedTexture): WebGLTexture {
    const gl = this.gl;
    const glTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, tex.width, tex.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, tex.rgba
    );
    // WoW textures generally wrap; mipmaps improve minification.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (isPowerOfTwo(tex.width) && isPowerOfTwo(tex.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return glTex;
  }

  /** Position the orbit camera to frame the whole model. */
  private frameModel(): void {
    const bb = this.renderer.boundingBox();
    const min = [bb[0], bb[1], bb[2]];
    const max = [bb[3], bb[4], bb[5]];
    this.center = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ];
    const radius = Math.max(
      0.1,
      0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2])
    );
    this.distance = radius * 2.6;
  }

  private cameraEye(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      this.center[0] + this.distance * cp * Math.sin(this.yaw),
      this.center[1] + this.distance * Math.sin(this.pitch),
      this.center[2] + this.distance * cp * Math.cos(this.yaw),
    ];
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
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.yaw -= dx * 0.01;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.01));
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.001);
        this.distance = Math.max(0.05, Math.min(1000, this.distance * factor));
      },
      { passive: false }
    );
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
    this.gl.viewport(0, 0, canvas.width, canvas.height);
  }

  private applyBlendState(batch: BatchInfo): number {
    const gl = this.gl;
    let alphaTest = 0;

    switch (batch.blendMode) {
      case BLEND_OPAQUE:
        gl.disable(gl.BLEND);
        break;
      case BLEND_ALPHA_KEY:
        gl.disable(gl.BLEND);
        alphaTest = 0.5;
        break;
      case BLEND_ALPHA:
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case BLEND_ADD:
      case BLEND_NO_ALPHA_ADD:
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        break;
      case BLEND_MOD:
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        break;
      case BLEND_MOD2X:
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);
        break;
      default:
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        break;
    }

    if (batch.twoSided) {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    gl.depthMask(batch.noDepthWrite ? false : true);
    return alphaTest;
  }

  private loop = (time: number): void => {
    if (this.disposed) return;
    const dt = time - this.lastTime;
    this.lastTime = time;

    if (this.playing) {
      this.renderer.update(dt);
    }
    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(): void {
    const gl = this.gl;
    this.resize();

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Upload the current skinned frame.
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.renderer.skinnedVertices());
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.renderer.skinnedNormals());

    // Camera.
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const proj = mat4Perspective((50 * Math.PI) / 180, aspect, 0.01, 5000);
    const view = mat4LookAt(this.cameraEye(), this.center, [0, 1, 0]);
    const model = mat4Identity();
    const mvp = mat4Multiply(proj, view);
    gl.uniformMatrix4fv(this.uMvp, false, mvp);
    gl.uniformMatrix4fv(this.uModel, false, model);
    gl.uniform1i(this.uTex, 0);
    gl.uniform1f(this.uWireframe, this.wireframe ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);

    // Draw opaque batches first, then transparent ones.
    const opaque: BatchInfo[] = [];
    const transparent: BatchInfo[] = [];
    for (const b of this.batches) {
      if (b.blendMode === BLEND_OPAQUE || b.blendMode === BLEND_ALPHA_KEY) {
        opaque.push(b);
      } else {
        transparent.push(b);
      }
    }

    for (const b of [...opaque, ...transparent]) {
      const alphaTest = this.applyBlendState(b);
      gl.uniform1f(this.uAlphaTest, alphaTest);
      gl.uniform1f(this.uUnlit, b.unlit || this.wireframe ? 1 : 0);

      const glTex = this.glTextures.get(b.textureIndex) ?? this.whiteTexture;
      gl.bindTexture(gl.TEXTURE_2D, glTex);

      gl.drawElements(
        this.wireframe ? gl.LINE_STRIP : gl.TRIANGLES,
        b.indexCount,
        gl.UNSIGNED_INT,
        b.indexStart * 4
      );
    }

    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  // --- public control API used by the UI ---

  setAnimation(index: number): void {
    this.renderer?.setAnimation(index);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  setWireframe(on: boolean): void {
    this.wireframe = on;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    const gl = this.gl;
    try {
      gl.deleteBuffer(this.posBuffer);
      gl.deleteBuffer(this.normalBuffer);
      gl.deleteBuffer(this.uvBuffer);
      gl.deleteBuffer(this.indexBuffer);
      gl.deleteVertexArray(this.vao);
      for (const t of this.glTextures.values()) gl.deleteTexture(t);
      gl.deleteTexture(this.whiteTexture);
      gl.deleteProgram(this.program);
    } catch {
      /* context may already be lost */
    }
    this.renderer?.free();
  }
}

function isPowerOfTwo(n: number): boolean {
  return (n & (n - 1)) === 0 && n > 0;
}

