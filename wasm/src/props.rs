//! Doodads (`.m2` props) and buildings (`.wmo`) placed by a terrain tile, baked into world space.
//!
//! Every model comes from `benilla_formats::load_object_model`, the same entry the client's
//! gameobject and doodad paths use, so the geometry, batch split, blend modes and texture names are
//! the client's. Each placement is transformed once here (scale, rotate, translate) and the
//! instances of a model are merged per batch, so a tile with 219 trees costs one draw per tree
//! batch, not 219.

use std::collections::HashMap;

use benilla_formats::{Chain, ModelBlend, RenderSubmesh};
use js_sys::{Array, Float32Array, Object, Reflect, Uint32Array, Uint8Array};
use wasm_bindgen::prelude::*;

/// One placed model: which file, where, and how big.
pub struct Placement {
    pub path: String,
    pub position: [f32; 3],
    /// Euler degrees `(X, Y, Z)`; Y is the heading about the up axis.
    pub rotation: [f32; 3],
    pub scale: f32,
}

/// A 3x3, row-major, acting on column vectors.
type Mat3 = [[f32; 3]; 3];

fn rot_x(deg: f32) -> Mat3 {
    let (s, c) = deg.to_radians().sin_cos();
    [[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]]
}

fn rot_y(deg: f32) -> Mat3 {
    let (s, c) = deg.to_radians().sin_cos();
    [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]]
}

fn rot_z(deg: f32) -> Mat3 {
    let (s, c) = deg.to_radians().sin_cos();
    [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]]
}

fn mul(a: Mat3, b: Mat3) -> Mat3 {
    let mut out = [[0.0f32; 3]; 3];
    for (row, out_row) in out.iter_mut().enumerate() {
        for (col, cell) in out_row.iter_mut().enumerate() {
            *cell = (0..3).map(|k| a[row][k] * b[k][col]).sum();
        }
    }
    out
}

fn apply(m: &Mat3, v: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

/// The placement rotation of an MDDF/MODF entry, in raw WoW axes (+X north, +Y west, +Z up).
///
/// This is `benilla_assets::coords::placement_rotation` before its Bevy conversion: that function
/// returns `to_bevy · in_wow · to_bevy⁻¹`, so the conversion cancels and `in_wow` is what a WoW
/// space vertex sees. The trailing and leading quarter turns take the model's own basis
/// (`rz - 90`) into the file's (`ry`) and back.
fn placement_rotation(rotation_deg: [f32; 3]) -> Mat3 {
    let [rx, ry, rz] = rotation_deg;
    mul(
        mul(
            mul(rot_x(90.0), rot_y(ry - 180.0)),
            rot_z(-rx),
        ),
        rot_x(rz - 90.0),
    )
}

fn blend_code(blend: ModelBlend) -> u32 {
    match blend {
        ModelBlend::Opaque => 0,
        ModelBlend::AlphaTest => 1,
        ModelBlend::Blend => 2,
        ModelBlend::Mod => 3,
        ModelBlend::Mod2x => 4,
    }
}

/// The widest mip a prop texture keeps: beyond this the memory cost stops paying for itself.
const PROP_TEXTURE_SIDE: u32 = 128;

/// One draw: every submesh of every instance that binds the same texture with the same blend and
/// culling state, merged into one buffer. A tile's hundreds of trees become a handful of draws.
struct Batch {
    kind: &'static str,
    texture: Option<u32>,
    blend: u32,
    two_sided: bool,
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    indices: Vec<u32>,
}

fn set(obj: &Object, key: &str, value: JsValue) {
    let _ = Reflect::set(obj, &JsValue::from_str(key), &value);
}

/// Merge one placement of one submesh into the batch that matches its texture and state.
fn append_instance(
    batch: &mut Batch,
    submesh: &RenderSubmesh,
    placement: &Placement,
    rotation: &Mat3,
) {
    let scale = if placement.scale > 0.0 {
        placement.scale
    } else {
        1.0
    };
    let base = (batch.positions.len() / 3) as u32;
    for position in &submesh.positions {
        let local = apply(rotation, *position);
        batch.positions.push(placement.position[0] + local[0] * scale);
        batch.positions.push(placement.position[1] + local[1] * scale);
        batch.positions.push(placement.position[2] + local[2] * scale);
    }
    for normal in &submesh.normals {
        let turned = apply(rotation, *normal);
        batch.normals.extend_from_slice(&turned);
    }
    for uv in &submesh.uvs {
        batch.uvs.extend_from_slice(uv);
    }
    for index in &submesh.indices {
        batch.indices.push(base + index);
    }
}

/// Bake the placements into world-space batches, with each batch's texture decoded once.
///
/// `limit` caps the total vertices, so a tile that places a city-sized WMO several times still
/// returns; whatever was skipped is reported instead of silently missing.
pub fn build(chain: &mut Chain, placements: &[Placement], limit: usize) -> JsValue {
    // One load per distinct model, then every placement of it.
    let mut order: Vec<String> = Vec::new();
    let mut by_path: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, placement) in placements.iter().enumerate() {
        let key = placement.path.to_ascii_lowercase();
        if !by_path.contains_key(&key) {
            order.push(key.clone());
        }
        by_path.entry(key).or_default().push(index);
    }

    let mut texture_names: Vec<String> = Vec::new();
    let mut texture_index: HashMap<String, u32> = HashMap::new();
    let mut batches: Vec<Batch> = Vec::new();
    let mut batch_index: HashMap<(&'static str, Option<u32>, u32, bool), usize> = HashMap::new();
    let mut failed: Vec<(String, String)> = Vec::new();
    let mut skipped: Vec<(String, usize)> = Vec::new();
    let mut vertices = 0usize;

    for key in &order {
        let indexes = &by_path[key];
        let path = &placements[indexes[0]].path;
        let kind = if path.to_ascii_lowercase().ends_with(".wmo") {
            "building"
        } else {
            "doodad"
        };
        let submeshes = match benilla_formats::load_object_model(chain, path) {
            Ok(submeshes) => submeshes,
            Err(error) => {
                failed.push((path.clone(), format!("{error:#}")));
                continue;
            }
        };
        let per_instance = submeshes.iter().map(|s| s.positions.len()).sum::<usize>();
        let wanted = per_instance * indexes.len();
        if vertices + wanted > limit {
            skipped.push((path.clone(), indexes.len()));
            continue;
        }
        vertices += wanted;

        for placement_index in indexes {
            let placement = &placements[*placement_index];
            let rotation = placement_rotation(placement.rotation);
            for submesh in &submeshes {
                if submesh.positions.is_empty() || submesh.indices.is_empty() {
                    continue;
                }
                let texture = submesh.texture.as_ref().map(|name| {
                    if let Some(slot) = texture_index.get(name) {
                        return *slot;
                    }
                    let slot = texture_names.len() as u32;
                    texture_index.insert(name.clone(), slot);
                    texture_names.push(name.clone());
                    slot
                });
                let blend = blend_code(submesh.blend);
                let state = (kind, texture, blend, submesh.two_sided);
                let slot = match batch_index.get(&state) {
                    Some(slot) => *slot,
                    None => {
                        let slot = batches.len();
                        batches.push(Batch {
                            kind,
                            texture,
                            blend,
                            two_sided: submesh.two_sided,
                            positions: Vec::new(),
                            normals: Vec::new(),
                            uvs: Vec::new(),
                            indices: Vec::new(),
                        });
                        batch_index.insert(state, slot);
                        slot
                    }
                };
                append_instance(&mut batches[slot], submesh, placement, &rotation);
            }
        }
    }

    // Decode every texture a batch binds, once, straight through the chain's own BLP reader.
    let mut decoded: Vec<(String, u32, u32, Vec<u8>)> = Vec::with_capacity(texture_names.len());
    let mut missing: Vec<String> = Vec::new();
    for name in &texture_names {
        match chain
            .read_file(name)
            .ok()
            .and_then(|bytes| benilla_formats::blp_bytes_to_mip_chain(&bytes).ok())
        {
            Some(chain_bytes) => {
                let chain_bytes = chain_bytes.into_rgba8();
                // A prop's texture is seen at distance: the largest mip at or under 128 texels is
                // plenty, and a quarter of the memory of the 256-texel one.
                let mut chosen = (chain_bytes.width, chain_bytes.height, None);
                for (level, pixels) in chain_bytes.mips.into_iter().enumerate() {
                    // `BlpMipChain::mip_size` halves per level, floored at 1.
                    let (width, height) = (
                        (chain_bytes.width >> level).max(1),
                        (chain_bytes.height >> level).max(1),
                    );
                    if width > PROP_TEXTURE_SIDE || height > PROP_TEXTURE_SIDE {
                        continue;
                    }
                    chosen = (width, height, Some(pixels));
                    break;
                }
                match chosen.2 {
                    Some(pixels) => decoded.push((name.clone(), chosen.0, chosen.1, pixels)),
                    None => decoded.push((name.clone(), 0, 0, Vec::new())),
                }
            }
            None => {
                missing.push(name.clone());
                decoded.push((name.clone(), 0, 0, Vec::new()));
            }
        }
    }

    let texture_list = Array::new();
    for (name, width, height, rgba) in &decoded {
        let entry = Object::new();
        set(&entry, "name", JsValue::from_str(name));
        set(&entry, "width", JsValue::from_f64(f64::from(*width)));
        set(&entry, "height", JsValue::from_f64(f64::from(*height)));
        set(
            &entry,
            "rgba",
            Uint8Array::from(rgba.as_slice()).into(),
        );
        texture_list.push(&entry);
    }

    let batch_list = Array::new();
    for batch in &batches {
        let entry = Object::new();
        set(&entry, "kind", JsValue::from_str(batch.kind));
        set(
            &entry,
            "texture",
            batch
                .texture
                .map_or(JsValue::from_f64(-1.0), |i| JsValue::from_f64(f64::from(i))),
        );
        set(&entry, "blend", JsValue::from_f64(f64::from(batch.blend)));
        set(&entry, "twoSided", JsValue::from_bool(batch.two_sided));
        set(
            &entry,
            "positions",
            Float32Array::from(batch.positions.as_slice()).into(),
        );
        set(
            &entry,
            "normals",
            Float32Array::from(batch.normals.as_slice()).into(),
        );
        set(
            &entry,
            "uvs",
            Float32Array::from(batch.uvs.as_slice()).into(),
        );
        set(
            &entry,
            "indices",
            Uint32Array::from(batch.indices.as_slice()).into(),
        );
        batch_list.push(&entry);
    }

    let failed_list = Array::new();
    for (path, error) in &failed {
        let entry = Object::new();
        set(&entry, "model", JsValue::from_str(path));
        set(&entry, "error", JsValue::from_str(error));
        failed_list.push(&entry);
    }
    let skipped_list = Array::new();
    for (path, count) in &skipped {
        let entry = Object::new();
        set(&entry, "model", JsValue::from_str(path));
        set(&entry, "count", JsValue::from_f64(*count as f64));
        skipped_list.push(&entry);
    }

    let out = Object::new();
    set(&out, "textures", texture_list.into());
    set(&out, "batches", batch_list.into());
    set(&out, "failed", failed_list.into());
    set(&out, "skipped", skipped_list.into());
    set(
        &out,
        "missingTextures",
        Array::from_iter(missing.iter().map(|name| JsValue::from_str(name))).into(),
    );
    set(&out, "vertexCount", JsValue::from_f64(vertices as f64));
    out.into()
}
