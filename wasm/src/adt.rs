//! A terrain tile as the page draws it: one entry per MCNK with its geometry, its layer textures,
//! the alpha map that blends them and the MCSH shadow map, plus the tile's texture names and the
//! doodads and buildings it places.
//!
//! The geometry, the layer order, the alpha map and the liquids are `benilla_formats`' own
//! (`adt_to_tile_mesh`, the same call the client's terrain streamer makes); this module only
//! reshapes them into JS values and builds the atlases the preview shader samples.

use std::collections::HashMap;

use js_sys::{Array, Float32Array, Object, Reflect, Uint32Array, Uint8Array};
use wasm_bindgen::prelude::*;

/// texels per alpha (`ALPHA_MAP_SIZE`) and shadow (`SHADOW_MAP_SIZE`) map side.
const MAP_SIDE: u32 = 64;
/// Splitting a square into 16 x 16 tiles of 64 texels gives a 1024-texel atlas, one texture.
const MAP_SIDE_TILES: u32 = MAP_SIDE * 16;
/// The layer slots a chunk can use (MCLY's four).
const LAYERS: usize = 4;

fn set(obj: &Object, key: &str, value: JsValue) {
    let _ = Reflect::set(obj, &JsValue::from_str(key), &value);
}

fn flatten3(points: &[[f32; 3]]) -> Vec<f32> {
    let mut out = Vec::with_capacity(points.len() * 3);
    for p in points {
        out.extend_from_slice(p);
    }
    out
}

fn flatten2(points: &[[f32; 2]]) -> Vec<f32> {
    let mut out = Vec::with_capacity(points.len() * 2);
    for p in points {
        out.extend_from_slice(p);
    }
    out
}

/// One MCLQ block as a drawable surface: its grid geometry, its wet cells and what fills it.
fn liquid_object(liquid: &benilla_formats::LiquidMesh) -> JsValue {
    let out = Object::new();
    set(
        &out,
        "positions",
        Float32Array::from(flatten3(&liquid.positions).as_slice()).into(),
    );
    set(
        &out,
        "indices",
        Uint32Array::from(liquid.indices.as_slice()).into(),
    );
    // The depth swatch coordinate (0 shallow, 1 the ramp's saturation) drives the water's colour
    // and opacity, as the reference's `ocean0`/`lake_a` fills do; magma carries zeros.
    set(
        &out,
        "depths",
        Float32Array::from(liquid.depths.as_slice()).into(),
    );
    set(&out, "kind", JsValue::from_str(liquid_kind_name(liquid.kind)));
    out.into()
}

/// What fills a liquid surface, as the page colours it.
fn liquid_kind_name(kind: benilla_formats::LiquidKind) -> &'static str {
    match kind {
        benilla_formats::LiquidKind::Still => "still",
        benilla_formats::LiquidKind::Ocean => "ocean",
        benilla_formats::LiquidKind::Magma => "magma",
        benilla_formats::LiquidKind::Slime => "slime",
        benilla_formats::LiquidKind::Rapids => "rapids",
    }
}

/// A chunk's atlas corner, in texel units, when it has the map.
fn atlas_origin(index: u32) -> (f32, f32) {
    (
        (index % 16) as f32 * MAP_SIDE as f32,
        (index / 16) as f32 * MAP_SIDE as f32,
    )
}

/// A placed model, with every placement: `{ model, count, placements: [[x,y,z, rx,ry,rz, scale]] }`.
fn placements_object<'a>(
    names: impl Iterator<Item = (&'a str, [f32; 3], [f32; 3], f32)>,
) -> Array {
    let mut order: Vec<String> = Vec::new();
    let mut buckets: HashMap<String, Vec<[f32; 7]>> = HashMap::new();
    for (name, position, rotation, scale) in names {
        if !buckets.contains_key(name) {
            order.push(name.to_owned());
        }
        buckets.entry(name.to_owned()).or_default().push([
            position[0], position[1], position[2], rotation[0], rotation[1], rotation[2], scale,
        ]);
    }
    order.sort_by_key(|name| std::cmp::Reverse(buckets[name].len()));
    let out = Array::new();
    for name in order {
        let list = &buckets[&name];
        let entry = Object::new();
        set(&entry, "model", JsValue::from_str(&name));
        set(&entry, "count", JsValue::from_f64(list.len() as f64));
        let placements = Array::new();
        for placement in list {
            let flat = Float32Array::from(placement.as_slice());
            placements.push(&flat);
        }
        set(&entry, "placements", placements.into());
        out.push(&entry);
    }
    out
}

fn chunk_object(
    chunk: &benilla_formats::ChunkMesh,
    layer_index: &HashMap<String, u32>,
    alpha_slot: Option<u32>,
    shadow_slot: Option<u32>,
) -> JsValue {
    let out = Object::new();
    set(
        &out,
        "positions",
        Float32Array::from(flatten3(&chunk.positions).as_slice()).into(),
    );
    set(
        &out,
        "normals",
        Float32Array::from(flatten3(&chunk.normals).as_slice()).into(),
    );
    set(
        &out,
        "uvs",
        Float32Array::from(flatten2(&chunk.uvs).as_slice()).into(),
    );
    set(
        &out,
        "indices",
        Uint32Array::from(chunk.indices.as_slice()).into(),
    );

    // Layer slots: the texture-array index, or -1 for a slot the chunk does not use. An unused
    // slot repeats slot 0 in the client and never shows, because its alpha weight is 0.
    let mut layers = [0i32; LAYERS];
    for (slot, name) in chunk.layer_textures.iter().take(LAYERS).enumerate() {
        layers[slot] = layer_index.get(name).map_or(-1, |i| *i as i32);
    }
    for slot in chunk.layer_textures.len().min(LAYERS)..LAYERS {
        layers[slot] = -1;
    }
    set(
        &out,
        "layers",
        Uint32Array::from(layers.map(|v| v as u32).as_slice()).into(),
    );

    match alpha_slot.map(atlas_origin) {
        Some((x, y)) => set(&out, "alphaAtlas", Float32Array::from([x, y].as_slice()).into()),
        None => set(&out, "alphaAtlas", JsValue::NULL),
    }
    match shadow_slot.map(atlas_origin) {
        Some((x, y)) => set(&out, "shadowAtlas", Float32Array::from([x, y].as_slice()).into()),
        None => set(&out, "shadowAtlas", JsValue::NULL),
    }

    let liquids = Array::new();
    for liquid in &chunk.liquids {
        liquids.push(&liquid_object(liquid));
    }
    set(&out, "liquids", liquids.into());

    // A holed cell is already missing from `indices`, and an impassable chunk is only a mover's
    // wall: neither changes what the preview draws.
    set(&out, "areaId", JsValue::from_f64(chunk.area_id as f64));
    out.into()
}

/// A tile's textures, geometry, atlases and placements, ready for the page's terrain viewer.
///
/// `bytes` is the root ADT. The atlases come back as raw RGBA / R8 buffers of
/// `MAP_SIDE_TILES`², one 64-texel tile per chunk in `chunks` order, so a chunk's corner in
/// `alphaAtlas` / `shadowAtlas` is all the shader needs.
pub fn tile_payload(bytes: &[u8]) -> Result<JsValue, JsError> {
    let tile = benilla_formats::adt_to_tile_mesh(bytes)
        .map_err(|e| JsError::new(&format!("ADT: {e}")))?;

    // MTEX order, with how many chunks draw each entry: the list the page shows.
    let mut texture_index: HashMap<String, u32> = HashMap::new();
    let mut texture_names: Vec<String> = Vec::new();
    let mut texture_chunks: Vec<u32> = Vec::new();
    for chunk in &tile.chunks {
        for name in &chunk.layer_textures {
            match texture_index.get(name) {
                Some(i) => texture_chunks[*i as usize] += 1,
                None => {
                    texture_index.insert(name.clone(), texture_names.len() as u32);
                    texture_names.push(name.clone());
                    texture_chunks.push(1);
                }
            }
        }
    }

    let alpha_size = (MAP_SIDE_TILES * MAP_SIDE_TILES * 4) as usize;
    let shadow_size = (MAP_SIDE_TILES * MAP_SIDE_TILES) as usize;
    let mut alpha_atlas = vec![0u8; alpha_size];
    let mut shadow_atlas = vec![0u8; shadow_size];
    let mut alpha_slots: Vec<Option<u32>> = Vec::with_capacity(tile.chunks.len());
    let mut shadow_slots: Vec<Option<u32>> = Vec::with_capacity(tile.chunks.len());
    let mut next_alpha = 0u32;
    let mut next_shadow = 0u32;
    for chunk in &tile.chunks {
        // An alpha map is only needed from the second layer on; a single-layer chunk samples
        // nothing, so it takes no atlas slot and the shader skips the blend.
        alpha_slots.push(if chunk.layer_textures.len() > 1 && chunk.alpha_map.is_some() {
            let slot = next_alpha;
            next_alpha += 1;
            if let Some(map) = chunk.alpha_map.as_ref() {
                blit(&mut alpha_atlas, MAP_SIDE_TILES, slot, map, MAP_SIDE, 4);
            }
            Some(slot)
        } else {
            None
        });
        shadow_slots.push(match chunk.shadow.as_ref() {
            Some(map) => {
                let slot = next_shadow;
                next_shadow += 1;
                blit(&mut shadow_atlas, MAP_SIDE_TILES, slot, map, MAP_SIDE, 1);
                Some(slot)
            }
            None => None,
        });
    }

    let chunks = Array::new();
    for (i, chunk) in tile.chunks.iter().enumerate() {
        chunks.push(&chunk_object(
            chunk,
            &texture_index,
            alpha_slots[i],
            shadow_slots[i],
        ));
    }

    let textures = Array::new();
    for (i, name) in texture_names.iter().enumerate() {
        let entry = Object::new();
        set(&entry, "name", JsValue::from_str(name));
        set(&entry, "chunks", JsValue::from_f64(texture_chunks[i] as f64));
        textures.push(&entry);
    }

    let doodads = placements_object(
        tile.doodads
            .iter()
            .map(|d| (d.model.as_str(), d.position, d.rotation, d.scale)),
    );
    let wmos = placements_object(
        tile.wmos
            .iter()
            .map(|w| (w.model.as_str(), w.position, w.rotation, 1.0)),
    );

    let mut areas: Vec<u32> = tile.chunks.iter().map(|c| c.area_id).collect();
    areas.sort_unstable();
    areas.dedup();
    let area_list = Array::new();
    for area in &areas {
        area_list.push(&JsValue::from_f64(*area as f64));
    }

    let out = Object::new();
    set(&out, "textures", textures.into());
    set(&out, "chunks", chunks.into());
    set(&out, "doodads", doodads.into());
    set(&out, "wmos", wmos.into());
    set(&out, "areas", area_list.into());
    set(
        &out,
        "alphaAtlas",
        Uint8Array::from(alpha_atlas.as_slice()).into(),
    );
    set(&out, "alphaAtlasSide", JsValue::from_f64(MAP_SIDE_TILES as f64));
    set(
        &out,
        "shadowAtlas",
        Uint8Array::from(shadow_atlas.as_slice()).into(),
    );
    set(
        &out,
        "shadowAtlasSide",
        JsValue::from_f64(MAP_SIDE_TILES as f64),
    );
    set(
        &out,
        "vertexCount",
        JsValue::from_f64(tile.vertex_count() as f64),
    );
    set(
        &out,
        "triangleCount",
        JsValue::from_f64(
            tile.chunks.iter().map(|c| c.indices.len() / 3).sum::<usize>() as f64
        ),
    );
    Ok(out.into())
}

/// Place `len`² texels of `bpp` bytes into an atlas tile.
fn blit(atlas: &mut [u8], atlas_side: u32, slot: u32, map: &[u8], side: u32, bpp: usize) {
    let (x0, y0) = atlas_origin(slot);
    let (x0, y0) = (x0 as usize, y0 as usize);
    let row_bytes = side as usize * bpp;
    if map.len() < row_bytes * side as usize {
        return;
    }
    for row in 0..side as usize {
        let dst = ((y0 + row) * atlas_side as usize + x0) * bpp;
        let src = row * row_bytes;
        atlas[dst..dst + row_bytes].copy_from_slice(&map[src..src + row_bytes]);
    }
}
