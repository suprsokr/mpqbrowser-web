//! The M2 viewer's model: the client's mesh builder, skeleton and baked animations, plus a CPU
//! skinner the WebGL page drives one frame at a time.
//!
//! Geometry comes from [`benilla_formats::parse_m2_render_submeshes`] (the same submeshes the
//! client draws), per-sequence keyframes from [`benilla_formats::parse_m2_animations`] (already cut
//! to each sequence's band by the reference's key-window rules), and the rest skeleton from
//! [`benilla_formats::parse_m2_skeleton`]. Everything below is raw WoW model space; each array the
//! page reads is converted to the renderer's Y-up frame at the edge.

use benilla_formats::{
    parse_m2_animations, parse_m2_skeleton, parse_m2_render_submeshes, BoneKeys, CharSkinSlot,
    ModelAnimation, ModelBlend, RenderSubmesh,
};
use wasm_bindgen::prelude::*;

/// 4×4 matrices, column-major: `m[col * 4 + row]`.
type Mat4 = [f32; 16];

fn identity() -> Mat4 {
    let mut m = [0.0f32; 16];
    m[0] = 1.0;
    m[5] = 1.0;
    m[10] = 1.0;
    m[15] = 1.0;
    m
}

/// `a * b`, so a point is placed by `a` and then by `b`'s parent frame.
fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [0.0f32; 16];
    for c in 0..4 {
        for r in 0..4 {
            let mut sum = 0.0;
            for k in 0..4 {
                sum += a[k * 4 + r] * b[c * 4 + k];
            }
            out[c * 4 + r] = sum;
        }
    }
    out
}

/// Translation `t` × rotation `q` (`[x, y, z, w]`) × scale `s`.
fn trs(t: [f32; 3], q: [f32; 4], s: [f32; 3]) -> Mat4 {
    let [x, y, z, w] = q;
    let (xx, yy, zz) = (x * x, y * y, z * z);
    let (xy, xz, yz) = (x * y, x * z, y * z);
    let (wx, wy, wz) = (w * x, w * y, w * z);
    let mut m = [
        1.0 - 2.0 * (yy + zz),
        2.0 * (xy + wz),
        2.0 * (xz - wy),
        0.0,
        2.0 * (xy - wz),
        1.0 - 2.0 * (xx + zz),
        2.0 * (yz + wx),
        0.0,
        2.0 * (xz + wy),
        2.0 * (yz - wx),
        1.0 - 2.0 * (xx + yy),
        0.0,
        t[0],
        t[1],
        t[2],
        1.0,
    ];
    for c in 0..3 {
        for r in 0..3 {
            m[c * 4 + r] *= s[r];
        }
    }
    m
}

fn transform_point(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
    [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ]
}

fn transform_normal(m: &Mat4, n: [f32; 3]) -> [f32; 3] {
    let v = [
        m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
        m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
        m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
    ];
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len > 1e-8 {
        [v[0] / len, v[1] / len, v[2] / len]
    } else {
        [0.0, 1.0, 0.0]
    }
}

/// WoW is Z-up and the page's camera is Y-up: `(x, y, z) -> (x, z, -y)`.
fn to_renderer(v: [f32; 3]) -> [f32; 3] {
    [v[0], v[2], -v[1]]
}

fn slerp(a: [f32; 4], b: [f32; 4], f: f32) -> [f32; 4] {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let (b, dot) = if dot < 0.0 {
        ([-b[0], -b[1], -b[2], -b[3]], -dot)
    } else {
        (b, dot)
    };
    if dot > 0.9995 {
        let v = [
            a[0] + (b[0] - a[0]) * f,
            a[1] + (b[1] - a[1]) * f,
            a[2] + (b[2] - a[2]) * f,
            a[3] + (b[3] - a[3]) * f,
        ];
        return normalize_quat(v);
    }
    let theta = dot.clamp(-1.0, 1.0).acos();
    let sin = theta.sin();
    let (wa, wb) = ((1.0 - f) * theta, f * theta);
    let (sa, sb) = (wa.sin() / sin, wb.sin() / sin);
    [
        a[0] * sa + b[0] * sb,
        a[1] * sa + b[1] * sb,
        a[2] * sa + b[2] * sb,
        a[3] * sa + b[3] * sb,
    ]
}

fn normalize_quat(q: [f32; 4]) -> [f32; 4] {
    let len = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if len > 1e-8 {
        [q[0] / len, q[1] / len, q[2] / len, q[3] / len]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

/// The two keys around `t` and the fraction between them.
fn bracket<T: Copy>(keys: &[(f32, T)], t: f32) -> Option<(T, T, f32)> {
    let (first, last) = (keys.first()?, keys.last()?);
    if t <= first.0 {
        return Some((first.1, first.1, 0.0));
    }
    if t >= last.0 {
        return Some((last.1, last.1, 0.0));
    }
    let i = keys.partition_point(|(k, _)| *k <= t);
    let (t0, v0) = keys[i - 1];
    let (t1, v1) = keys[i];
    let span = (t1 - t0).max(1e-6);
    Some((v0, v1, (t - t0) / span))
}

fn sample_vec3(keys: &[(f32, [f32; 3])], t: f32) -> Option<[f32; 3]> {
    let (a, b, f) = bracket(keys, t)?;
    Some([
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
    ])
}

fn sample_quat(keys: &[(f32, [f32; 4])], t: f32) -> Option<[f32; 4]> {
    let (a, b, f) = bracket(keys, t)?;
    Some(slerp(a, b, f))
}

/// One section's draw state, as the page's WebGL batches read it.
struct Batch {
    index_start: u32,
    index_count: u32,
    submesh: u32,
    geoset_id: u16,
    texture: i32,
    texture_type: u32,
    blend: u8,
    two_sided: bool,
    unlit: bool,
    depth_write: bool,
}

/// One texture a batch binds: a file in the chain, or a slot the page fills at runtime.
struct Texture {
    filename: Option<String>,
    /// 0 a file, 1 the composited body atlas, 6 hair, 8 the extra skin.
    kind: u32,
}

/// A bone's rest pose: its parent and its pivot, the point its rotations turn about.
struct Bone {
    parent: i32,
    /// The bone's pivot in model space. Vertices are authored in model space and vanilla M2 has no
    /// inverse bind matrices, so a bone's transform is `T(pivot + translation) · R · S · T(-pivot)`
    /// composed down the hierarchy: at rest every bone lands on the identity.
    pivot: [f32; 3],
}

/// A playable sequence and, per bone, its keys in seconds from the sequence's start.
struct Anim {
    id: u16,
    duration: f32,
    looping: bool,
    /// The keyed bones, in file order.
    bones: Vec<BoneKeys>,
    /// Bone id → index into [`Self::bones`], `u16::MAX` for a bone the sequence leaves at rest.
    slot: Vec<u16>,
}

#[wasm_bindgen]
pub struct M2 {
    bones: Vec<Bone>,
    anims: Vec<Anim>,
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
    joints: Vec<[u16; 4]>,
    weights: Vec<[f32; 4]>,
    batches: Vec<Batch>,
    textures: Vec<Texture>,
    bbox: [f32; 6],
    anim: usize,
    time: f32,
    world: Vec<Mat4>,
    skinned_positions: Vec<f32>,
    skinned_normals: Vec<f32>,
    resolved: Vec<bool>,
}

#[wasm_bindgen]
impl M2 {
    /// `dir` is the model's folder and `skins` its `Monster1/2/3` texture variations (bare names),
    /// which the creature tables supply; a character model passes its folder and no skins.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], dir: &str, skins: JsValue) -> Result<M2, JsError> {
        let skins: Vec<Option<String>> = if skins.is_null() || skins.is_undefined() {
            Vec::new()
        } else {
            let arr = js_sys::Array::from(&skins);
            arr.iter()
                .map(|v| v.as_string().filter(|s| !s.is_empty()))
                .collect()
        };
        let subs = parse_m2_render_submeshes(bytes, dir, &skins)
            .map_err(|e| JsError::new(&format!("M2: {e:#}")))?;
        M2::assemble(bytes, subs).map_err(|e| JsError::new(&e))
    }

    /// Leaves an embedded-skin model unskinned: the geometry without the rig.
    fn assemble(bytes: &[u8], subs: Vec<RenderSubmesh>) -> Result<M2, String> {
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut uvs = Vec::new();
        let mut indices = Vec::new();
        let mut joints = Vec::new();
        let mut weights = Vec::new();
        let mut batches = Vec::new();
        let mut textures: Vec<Texture> = Vec::new();
        let mut bbox = [f32::MAX, f32::MAX, f32::MAX, f32::MIN, f32::MIN, f32::MIN];

        for (sub_index, sub) in subs.iter().enumerate() {
            let base = positions.len() as u32;
            for (i, p) in sub.positions.iter().enumerate() {
                positions.push(*p);
                let r = to_renderer(*p);
                bbox[0] = bbox[0].min(r[0]);
                bbox[1] = bbox[1].min(r[1]);
                bbox[2] = bbox[2].min(r[2]);
                bbox[3] = bbox[3].max(r[0]);
                bbox[4] = bbox[4].max(r[1]);
                bbox[5] = bbox[5].max(r[2]);
                normals.push(sub.normals.get(i).copied().unwrap_or([0.0, 1.0, 0.0]));
                let uv = sub.uvs.get(i).copied().unwrap_or([0.0, 0.0]);
                uvs.push(uv[0]);
                uvs.push(uv[1]);
                joints.push(sub.joints.get(i).copied().unwrap_or([0, 0, 0, 0]));
                weights.push(sub.weights.get(i).copied().unwrap_or([1.0, 0.0, 0.0, 0.0]));
            }
            let index_start = indices.len() as u32;
            indices.extend(sub.indices.iter().filter_map(|&i| {
                let v = i + base;
                (v < positions.len() as u32).then_some(v)
            }));
            let index_count = indices.len() as u32 - index_start;

            // The runtime slot a character model asks the page to composite, else the file it names.
            let (kind, filename) = match sub.char_slot {
                Some(CharSkinSlot::Body) => (1, None),
                Some(CharSkinSlot::Hair) => (6, sub.texture.clone()),
                Some(CharSkinSlot::SkinExtra) => (8, None),
                Some(CharSkinSlot::Object) => (2, sub.texture.clone()),
                None => (0, sub.texture.clone()),
            };
            let texture = textures
                .iter()
                .position(|t| t.kind == kind && t.filename == filename)
                .unwrap_or_else(|| {
                    textures.push(Texture { filename, kind });
                    textures.len() - 1
                }) as i32;

            let blend = match sub.blend {
                ModelBlend::Opaque => 0,
                ModelBlend::AlphaTest => 1,
                ModelBlend::Blend if sub.additive => 4,
                ModelBlend::Blend => 2,
                ModelBlend::Mod => 5,
                ModelBlend::Mod2x => 6,
            };
            batches.push(Batch {
                index_start,
                index_count,
                submesh: sub_index as u32,
                geoset_id: sub.geoset_id,
                texture,
                texture_type: kind,
                blend,
                two_sided: sub.two_sided,
                unlit: sub.emissive,
                depth_write: !sub.no_depth_write,
            });
        }
        if positions.is_empty() {
            bbox = [0.0; 6];
        }

        let skeleton = parse_m2_skeleton(bytes).map_err(|e| format!("M2 skeleton: {e:#}"))?;
        let bones: Vec<Bone> = skeleton
            .bones
            .iter()
            .map(|b| Bone {
                parent: i32::from(b.parent),
                pivot: b.pivot,
            })
            .collect();

        let anims: Vec<Anim> = parse_m2_animations(bytes)
            .into_iter()
            .map(|a: ModelAnimation| {
                let mut slot = vec![u16::MAX; bones.len()];
                for (i, keys) in a.bones.iter().enumerate() {
                    if let Some(s) = slot.get_mut(usize::from(keys.bone)) {
                        *s = i as u16;
                    }
                }
                Anim {
                    id: a.anim_id,
                    duration: a.duration,
                    looping: a.looping,
                    bones: a.bones,
                    slot,
                }
            })
            .collect();

        let world = vec![identity(); bones.len()];
        let skinned_positions = vec![0.0; positions.len() * 3];
        let skinned_normals = vec![0.0; normals.len() * 3];
        let resolved = vec![false; bones.len()];
        let mut model = M2 {
            bones,
            anims,
            positions,
            normals,
            uvs,
            indices,
            joints,
            weights,
            batches,
            textures,
            bbox,
            anim: 0,
            time: 0.0,
            world,
            skinned_positions,
            skinned_normals,
            resolved,
        };
        model.set_pose();
        Ok(model)
    }

    /// The textures the model binds, one entry per distinct slot.
    pub fn textures(&self) -> Result<JsValue, JsError> {
        let out = js_sys::Array::new();
        for (i, t) in self.textures.iter().enumerate() {
            let o = js_sys::Object::new();
            let set = |k: &str, v: &JsValue| {
                let _ = js_sys::Reflect::set(&o, &JsValue::from_str(k), v);
            };
            set("index", &JsValue::from_f64(i as f64));
            set(
                "filename",
                &t.filename
                    .as_ref()
                    .map_or(JsValue::NULL, |f| JsValue::from_str(f)),
            );
            set("textureType", &JsValue::from_f64(f64::from(t.kind)));
            out.push(&o);
        }
        Ok(out.into())
    }

    /// Every playable sequence, in file order: `{ index, id, duration, looping }`.
    pub fn animations(&self) -> Result<JsValue, JsError> {
        let out = js_sys::Array::new();
        for (i, a) in self.anims.iter().enumerate() {
            let o = js_sys::Object::new();
            let set = |k: &str, v: &JsValue| {
                let _ = js_sys::Reflect::set(&o, &JsValue::from_str(k), v);
            };
            set("index", &JsValue::from_f64(i as f64));
            set("id", &JsValue::from_f64(f64::from(a.id)));
            set("duration", &JsValue::from_f64(f64::from(a.duration)));
            set("looping", &JsValue::from_bool(a.looping));
            out.push(&o);
        }
        Ok(out.into())
    }

    /// One entry per draw batch: its index range and the state the page's WebGL sets.
    pub fn batches(&self) -> Result<JsValue, JsError> {
        let out = js_sys::Array::new();
        for (i, b) in self.batches.iter().enumerate() {
            let o = js_sys::Object::new();
            let set = |k: &str, v: &JsValue| {
                let _ = js_sys::Reflect::set(&o, &JsValue::from_str(k), v);
            };
            set("index", &JsValue::from_f64(i as f64));
            set("indexStart", &JsValue::from_f64(f64::from(b.index_start)));
            set("indexCount", &JsValue::from_f64(f64::from(b.index_count)));
            set("submesh", &JsValue::from_f64(f64::from(b.submesh)));
            set("submeshId", &JsValue::from_f64(f64::from(b.geoset_id)));
            set("textureIndex", &JsValue::from_f64(f64::from(b.texture)));
            set("textureType", &JsValue::from_f64(f64::from(b.texture_type)));
            set("blendMode", &JsValue::from_f64(f64::from(b.blend)));
            set("twoSided", &JsValue::from_bool(b.two_sided));
            set("unlit", &JsValue::from_bool(b.unlit));
            set("noDepthWrite", &JsValue::from_bool(!b.depth_write));
            out.push(&o);
        }
        Ok(out.into())
    }

    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }

    #[wasm_bindgen(js_name = texCoords)]
    pub fn tex_coords(&self) -> Vec<f32> {
        self.uvs.clone()
    }

    #[wasm_bindgen(js_name = vertexCount)]
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// `[min x, min y, min z, max x, max y, max z]`, renderer axes.
    #[wasm_bindgen(js_name = boundingBox)]
    pub fn bounding_box(&self) -> Vec<f32> {
        self.bbox.to_vec()
    }

    /// Select a sequence by its index in [`Self::animations`], and rewind it.
    #[wasm_bindgen(js_name = setAnimation)]
    pub fn set_animation(&mut self, index: usize) {
        self.anim = index.min(self.anims.len().saturating_sub(1));
        self.time = 0.0;
        self.set_pose();
    }

    /// Advance the clip by `dt_ms` and pose the model.
    pub fn update(&mut self, dt_ms: f64) {
        if let Some(a) = self.anims.get(self.anim) {
            self.time += (dt_ms.max(0.0) as f32) / 1000.0;
            if a.duration > 0.0 {
                self.time = if a.looping {
                    self.time.rem_euclid(a.duration)
                } else {
                    self.time.min(a.duration)
                };
            }
        }
        self.set_pose();
    }

    /// Skinned positions, `x, y, z` per vertex, renderer axes.
    #[wasm_bindgen(js_name = skinnedVertices)]
    pub fn skinned_vertices(&self) -> Vec<f32> {
        self.skinned_positions.clone()
    }

    /// Skinned normals, `x, y, z` per vertex, renderer axes.
    #[wasm_bindgen(js_name = skinnedNormals)]
    pub fn skinned_normals(&self) -> Vec<f32> {
        self.skinned_normals.clone()
    }
}

impl M2 {
    /// Compose each bone's world matrix at the current time, then skin every vertex.
    fn set_pose(&mut self) {
        self.resolved.iter_mut().for_each(|r| *r = false);
        for i in 0..self.bones.len() {
            self.resolve(i);
        }

        for (v, (pos, nrm)) in self.positions.iter().zip(self.normals.iter()).enumerate() {
            let joints = self.joints[v];
            let weights = self.weights[v];
            let mut p = [0.0f32; 3];
            let mut n = [0.0f32; 3];
            let mut total = 0.0f32;
            for k in 0..4 {
                let w = weights[k];
                if w <= 0.0 {
                    continue;
                }
                let Some(m) = self.world.get(usize::from(joints[k])) else {
                    continue;
                };
                let tp = transform_point(m, *pos);
                let tn = transform_normal(m, *nrm);
                p[0] += tp[0] * w;
                p[1] += tp[1] * w;
                p[2] += tp[2] * w;
                n[0] += tn[0] * w;
                n[1] += tn[1] * w;
                n[2] += tn[2] * w;
                total += w;
            }
            if total <= 0.0 {
                p = *pos;
                n = *nrm;
            } else if (total - 1.0).abs() > 1e-4 {
                p = [p[0] / total, p[1] / total, p[2] / total];
            }
            let rp = to_renderer(p);
            let rn = to_renderer(n);
            let len = (rn[0] * rn[0] + rn[1] * rn[1] + rn[2] * rn[2]).sqrt();
            let rn = if len > 1e-8 {
                [rn[0] / len, rn[1] / len, rn[2] / len]
            } else {
                [0.0, 1.0, 0.0]
            };
            self.skinned_positions[v * 3] = rp[0];
            self.skinned_positions[v * 3 + 1] = rp[1];
            self.skinned_positions[v * 3 + 2] = rp[2];
            self.skinned_normals[v * 3] = rn[0];
            self.skinned_normals[v * 3 + 1] = rn[1];
            self.skinned_normals[v * 3 + 2] = rn[2];
        }
    }

    /// `bone`'s world matrix, after its parents. A malformed cycle stops at its own parent.
    fn resolve(&mut self, bone: usize) {
        if bone >= self.bones.len() || self.resolved[bone] {
            return;
        }
        self.resolved[bone] = true;
        let parent = self.bones[bone].parent;
        let parent_world = if parent >= 0 {
            let p = parent as usize;
            self.resolve(p);
            self.world.get(p).copied().unwrap_or_else(identity)
        } else {
            identity()
        };

        let anim = self.anim.min(self.anims.len().saturating_sub(1));
        let (mut translation, mut rotation, mut scale) =
            ([0.0f32; 3], [0.0f32, 0.0, 0.0, 1.0], [1.0f32; 3]);
        if let Some(a) = self.anims.get(anim) {
            let time = self.time;
            if let Some(slot) = a.slot.get(bone) {
                if let Some(keys) = a.bones.get(usize::from(*slot)) {
                    if let Some(t) = sample_vec3(&keys.translation, time) {
                        translation = t;
                    }
                    if let Some(q) = sample_quat(&keys.rotation, time) {
                        rotation = q;
                    }
                    if let Some(s) = sample_vec3(&keys.scale, time) {
                        scale = s;
                    }
                }
            }
        }

        // `T(pivot + translation) · R · S · T(-pivot)`: build the rotation and scale about the
        // pivot, then place it, so the pivot is the one point the transform holds still.
        let pivot = self.bones[bone].pivot;
        let mut local = trs([0.0, 0.0, 0.0], rotation, scale);
        for row in 0..3 {
            let turned = local[row] * pivot[0]
                + local[4 + row] * pivot[1]
                + local[8 + row] * pivot[2];
            local[12 + row] = pivot[row] + translation[row] - turned;
        }
        self.world[bone] = mul(&parent_world, &local);
    }
}
