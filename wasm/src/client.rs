//! The archive chain over the page's files: the client's own mount order, listing, reads and the
//! character composite, all through `benilla_formats` and `benilla_mpq`.

use std::collections::HashMap;
use std::sync::Arc;

use benilla_formats::{
    blp_bytes_to_mip_chain, mount_order, CharCreateCatalog, CharSections, Chain, CharacterGeosets,
    EquipGeosets,
};
use benilla_mpq::Archive;
use wasm_bindgen::prelude::*;

use crate::source::JsSource;

/// One listed path: the archive that wins it, its sizes and raw block flags.
struct Row {
    name: String,
    archive: u16,
    size: u32,
    compressed: u32,
    flags: u32,
    /// A patch's delete marker: the path is gone from the composite, so the row is dropped.
    deleted: bool,
}

/// A set of MPQ archives read through the page, mounted in the client's own priority order.
#[wasm_bindgen]
pub struct Client {
    /// Ascending priority, the order [`Chain`] resolves through.
    archives: Vec<Archive>,
    /// Archive file names, parallel to `archives`.
    labels: Vec<String>,
    chain: Chain,
    /// Lazily loaded on the first character request; each load reads the DBCs from the chain.
    sections: Option<CharSections>,
    geosets: Option<CharacterGeosets>,
    catalog: Option<CharCreateCatalog>,
    creatures: Option<benilla_formats::CreatureCatalog>,
    /// `AreaTable`, loaded on the first terrain request: the chunks carry area ids, and a zone
    /// name is what the page can show for them.
    areas: Option<benilla_formats::AreaTableCatalog>,
    /// `SoundEntries` kits, loaded on the first sound request: their files name the MPQ paths a
    /// `.wav` click can be traced back to.
    sounds: Option<benilla_formats::SoundKitCatalog>,
    listing: Option<Vec<Row>>,
    /// `lowercased basename -> full path` over the listing, for texture records that name a file
    /// relative to their own folder.
    basenames: Option<HashMap<String, String>>,
    /// Which tables name which model file, built on the first reference request.
    refs: Option<crate::refs::ModelIndex>,
    /// `SpellVisualKit` / `SpellVisualEffectName`, loaded on the first reference request: a kit
    /// names an effect model by id, which no string scan can see.
    visuals: Option<benilla_formats::SpellVisualCatalog>,
    /// `CreatureSoundData` joined to its displays and models, loaded on the first voice request.
    voices: Option<benilla_formats::CreatureVoiceCatalog>,
}

#[wasm_bindgen]
impl Client {
    /// `names` and `sizes` describe the archives; `read(id, offset, length)` returns a
    /// `Uint8Array` of one archive's bytes. Mount order is the client's: the base archives, then
    /// `patch.MPQ`, then `patch-?.MPQ` by name, then `speech2.MPQ`.
    #[wasm_bindgen(constructor)]
    pub fn new(names: Vec<String>, sizes: Vec<f64>, read: js_sys::Function) -> Result<Client, JsError> {
        let order = match mount_order(&names) {
            Ok(order) => order,
            // A partial set (one archive, or a mod's folder) has no full base chain to mount: read
            // patches last by name so a patch still wins its base.
            Err(_) => {
                let mut v = names.clone();
                v.sort_by_key(|n| {
                    let lower = n.to_ascii_lowercase();
                    (lower.starts_with("patch"), lower)
                });
                v
            }
        };
        let mut archives = Vec::with_capacity(order.len());
        let mut labels = Vec::with_capacity(order.len());
        for name in &order {
            let Some(i) = names.iter().position(|n| n == name) else {
                continue;
            };
            let size = sizes.get(i).copied().unwrap_or(0.0);
            let source = Arc::new(JsSource::new(
                i as u32,
                size.max(0.0) as u64,
                name.clone(),
                read.clone(),
            ));
            let archive = Archive::from_source(source)
                .map_err(|e| JsError::new(&format!("{name}: {e}")))?;
            archives.push(archive);
            labels.push(name.clone());
        }
        let chain = Chain::from_archives(archives.clone());
        Ok(Client {
            archives,
            labels,
            chain,
            sections: None,
            geosets: None,
            catalog: None,
            creatures: None,
            areas: None,
            sounds: None,
            listing: None,
            basenames: None,
            refs: None,
            visuals: None,
            voices: None,
        })
    }

    /// The mounted archives, in ascending priority.
    pub fn archives(&self) -> Vec<String> {
        self.labels.clone()
    }

    /// Every listed path as column arrays: `{ names, archive, size, compressed, flags }`, where
    /// `archive` indexes [`Self::archives`]. A patch's copy wins its lower archive's, and a delete
    /// marker removes the path instead of listing it empty.
    pub fn list(&mut self) -> Result<JsValue, JsError> {
        if self.listing.is_none() {
            self.listing = Some(build_listing(&self.archives));
        }
        let rows = self.listing.as_ref().map(Vec::as_slice).unwrap_or_default();
        let names = js_sys::Array::new_with_length(rows.len() as u32);
        let mut archive = Vec::with_capacity(rows.len());
        let mut size = Vec::with_capacity(rows.len());
        let mut compressed = Vec::with_capacity(rows.len());
        let mut flags = Vec::with_capacity(rows.len());
        for (i, row) in rows.iter().enumerate() {
            names.set(i as u32, JsValue::from_str(&row.name));
            archive.push(row.archive);
            size.push(row.size);
            compressed.push(row.compressed);
            flags.push(row.flags);
        }
        let out = js_sys::Object::new();
        let set = |k: &str, v: &JsValue| {
            let _ = js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
        };
        set("names", &names.into());
        set("archive", &js_sys::Uint16Array::from(archive.as_slice()).into());
        set("size", &js_sys::Uint32Array::from(size.as_slice()).into());
        set(
            "compressed",
            &js_sys::Uint32Array::from(compressed.as_slice()).into(),
        );
        set("flags", &js_sys::Uint32Array::from(flags.as_slice()).into());
        Ok(out.into())
    }

    /// One file from the chain by MPQ path, `/` or `\`, any case.
    #[wasm_bindgen(js_name = readFile)]
    pub fn read_file(&mut self, name: &str) -> Result<Vec<u8>, JsError> {
        self.read_any(name).map_err(|e| JsError::new(&e))
    }

    /// The `Monster1/2/3` skins the creature tables give a model path, as three entries (bare
    /// file names, `null` for a slot the data leaves empty); an empty array when no display names
    /// the model, which is then drawn the way the client draws it: no texture at all.
    #[wasm_bindgen(js_name = creatureSkins)]
    pub fn creature_skins(&mut self, model_path: &str) -> Result<JsValue, JsError> {
        if self.creatures.is_none() {
            let catalog = benilla_formats::load_creature_catalog(&mut self.chain)
                .map_err(|e| JsError::new(&format!("creature catalog: {e:#}")))?;
            self.creatures = Some(catalog);
        }
        let skins = self
            .creatures
            .as_ref()
            .and_then(|catalog| catalog.skins_for_model(model_path));
        let out = js_sys::Array::new();
        if let Some(skins) = skins {
            for skin in skins {
                out.push(&skin
                    .as_ref()
                    .map_or(JsValue::NULL, |name| JsValue::from_str(name)));
            }
        }
        Ok(out.into())
    }

    /// The creature side of a model: its `CreatureDisplayInfo` voice rows with the `SoundEntries`
    /// kits each event plays, and the `CreatureDisplayInfoExtra` rows its displays point at.
    /// `{ displays, voices, extras, extraTotal }`; `voices` is deduplicated by row, since 14
    /// kobold displays share one voice set, and each event carries the kit's files to play.
    #[wasm_bindgen(js_name = creatureVoice)]
    pub fn creature_voice(&mut self, model_path: &str) -> Result<JsValue, JsError> {
        let displays = self.model_displays(model_path)?;
        let catalog = self.creatures.as_ref().expect("loaded by model_displays");
        let mut extras: Vec<(u32, Vec<u32>)> = Vec::new();
        let mut extra_signature: Vec<Option<String>> = Vec::new();
        let mut extra_total = 0usize;
        for &display_id in &displays {
            let Some(model) = catalog.model(display_id) else {
                continue;
            };
            let Some(appearance) = model.npc_appearance else {
                continue;
            };
            extra_total += 1;
            // A display's extra id is not kept on `NpcAppearance`: group by what the row says, so
            // two displays with the same look list together.
            let signature = format!(
                "{}/{}/{}/{}/{}/{}/{}",
                appearance.race,
                appearance.sex,
                appearance.skin,
                appearance.face,
                appearance.hair_style,
                appearance.hair_color,
                appearance.facial_hair
            );
            match extra_signature.iter().position(|s| s.as_deref() == Some(&signature)) {
                Some(index) => extras[index].1.push(display_id),
                None => {
                    extra_signature.push(Some(signature));
                    extras.push((display_id, vec![display_id]));
                }
            }
        }
        if self.voices.is_none() {
            self.voices = Some(
                benilla_formats::load_creature_voice_catalog(&mut self.chain)
                    .map_err(|e| JsError::new(&format!("creature voices: {e:#}")))?,
            );
        }
        if self.sounds.is_none() {
            self.sounds = Some(
                benilla_formats::load_sound_kit_catalog(&mut self.chain)
                    .map_err(|e| JsError::new(&format!("sound kits: {e:#}")))?,
            );
        }
        let voice_catalog = self.voices.as_ref().expect("loaded above");
        let kits = self.sounds.as_ref().expect("loaded above");

        // One entry per `CreatureSoundData` row, with the displays that resolve to it.
        let mut voices: Vec<(u32, Vec<u32>, Vec<(&'static str, u32)>)> = Vec::new();
        for &display_id in &displays {
            let Some(row) = voice_catalog.row_for_display(display_id) else {
                continue;
            };
            let events = voice_catalog
                .for_display(display_id)
                .map(|voice| voice.kits())
                .unwrap_or_default();
            match voices.iter_mut().find(|(id, _, _)| *id == row) {
                Some(entry) => entry.1.push(display_id),
                None => voices.push((row, vec![display_id], events)),
            }
        }

        let voices_js = js_sys::Array::new();
        for (row, display_ids, events) in &voices {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("row"), &JsValue::from_f64(f64::from(*row)));
            let used = js_sys::Array::new();
            for id in display_ids {
                used.push(&JsValue::from_f64(f64::from(*id)));
            }
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("displays"), &used);
            let events_js = js_sys::Array::new();
            for (event, kit_id) in events {
                let event_obj = js_sys::Object::new();
                let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("event"), &JsValue::from_str(event));
                let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("kit"), &JsValue::from_f64(f64::from(*kit_id)));
                match kits.get(*kit_id) {
                    Some(kit) => {
                        let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("name"), &JsValue::from_str(&kit.name));
                        let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("volume"), &JsValue::from_f64(f64::from(kit.volume)));
                        let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("cutoff"), &JsValue::from_f64(f64::from(kit.distance_cutoff)));
                        let files = js_sys::Array::new();
                        for (path, _weight) in &kit.files {
                            files.push(&JsValue::from_str(path));
                        }
                        let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("files"), &files);
                    }
                    None => {
                        let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("name"), &JsValue::NULL);
                        let _ = js_sys::Reflect::set(&event_obj, &JsValue::from_str("files"), &js_sys::Array::new());
                    }
                }
                events_js.push(&event_obj);
            }
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("events"), &events_js);
            voices_js.push(&obj);
        }

        let extras_js = js_sys::Array::new();
        for (display_id, group) in extras.iter().take(40) {
            let Some(appearance) = catalog
                .model(*display_id)
                .and_then(|model| model.npc_appearance)
            else {
                continue;
            };
            let obj = js_sys::Object::new();
            let extra_id = catalog.extended_id(*display_id).unwrap_or(0);
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("id"), &JsValue::from_f64(f64::from(extra_id)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("race"), &JsValue::from_f64(f64::from(appearance.race)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("sex"), &JsValue::from_f64(f64::from(appearance.sex)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("skin"), &JsValue::from_f64(f64::from(appearance.skin)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("face"), &JsValue::from_f64(f64::from(appearance.face)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("hairStyle"), &JsValue::from_f64(f64::from(appearance.hair_style)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("hairColor"), &JsValue::from_f64(f64::from(appearance.hair_color)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("facialHair"), &JsValue::from_f64(f64::from(appearance.facial_hair)));
            let _ = js_sys::Reflect::set(
                &obj,
                &JsValue::from_str("baked"),
                &appearance.bake_name.as_ref().map_or(JsValue::NULL, |name| JsValue::from_str(name)),
            );
            let equipment = js_sys::Array::new();
            for id in appearance.equipment {
                equipment.push(&JsValue::from_f64(f64::from(id)));
            }
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("equipment"), &equipment);
            let used = js_sys::Array::new();
            for id in group {
                used.push(&JsValue::from_f64(f64::from(*id)));
            }
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("displays"), &used);
            extras_js.push(&obj);
        }

        let out = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("displays"), &JsValue::from_f64(displays.len() as f64));
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("voices"), &voices_js);
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("extras"), &extras_js);
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("extraTotal"), &JsValue::from_f64(extra_total as f64));
        Ok(out.into())
    }

    /// The display ids naming `model_path`, loading the creature catalog on first use.
    fn model_displays(&mut self, model_path: &str) -> Result<Vec<u32>, JsError> {
        if self.creatures.is_none() {
            self.creatures = Some(
                benilla_formats::load_creature_catalog(&mut self.chain)
                    .map_err(|e| JsError::new(&format!("creature catalog: {e:#}")))?,
            );
        }
        let catalog = self.creatures.as_ref().expect("loaded above");
        let want = benilla_formats::m2_file_name(model_path);
        let mut displays: Vec<u32> = Vec::new();
        for (display_id, _) in catalog.display_models() {
            let Some(model) = catalog.model(display_id) else {
                continue;
            };
            if benilla_formats::m2_file_name(&model.model_path) == want {
                displays.push(display_id);
            }
        }
        displays.sort_unstable();
        Ok(displays)
    }

    /// Every schema the crate ships, as `name/slots`, for the page's diagnostics.
    pub fn schemas(&self) -> Vec<String> {
        benilla_formats::all_schemas()
            .into_iter()
            .map(|(_, schema)| {
                let slots: usize = schema.fields.iter().map(|f| f.count).sum();
                format!("{}/{slots}", schema.name)
            })
            .collect()
    }

    /// Every shipped table that names `model_path`, plus the rows that reach those rows by id:
    /// a `CreatureModelData.ModelName` hit yields its `CreatureDisplayInfo` rows (with the skins,
    /// scale and alpha that make one model look like a dozen creatures), and a
    /// `SpellVisualEffectName.FileName` hit yields the `SpellVisualKit` slots that fire it.
    /// `{ model, hits, tables, unreadable, displays, kits }`; a model no table names is unused art.
    #[wasm_bindgen(js_name = modelReferences)]
    pub fn model_references(&mut self, model_path: &str) -> Result<JsValue, JsError> {
        if self.refs.is_none() {
            self.index_basenames();
            let mut paths: Vec<String> = self
                .listing
                .as_ref()
                .map(Vec::as_slice)
                .unwrap_or_default()
                .iter()
                .filter(|row| !row.deleted && row.name.to_ascii_lowercase().ends_with(".dbc"))
                .map(|row| row.name.clone())
                .collect();
            paths.sort();
            self.refs = Some(crate::refs::index(&mut self.chain, &paths));
        }
        let index = self.refs.as_ref().expect("built above");
        let hits = index.hits(model_path);
        let model_ids: Vec<u32> = hits
            .iter()
            .filter(|hit| hit.table == "CreatureModelData")
            .map(|hit| hit.row)
            .collect();
        let effect_ids: Vec<u32> = hits
            .iter()
            .filter(|hit| hit.table == "SpellVisualEffectName")
            .map(|hit| hit.row)
            .collect();
        let (tables, unreadable) = (index.tables, index.unreadable.clone());

        // `CreatureDisplayInfo` rows pointing at the model rows: the display id is what a creature
        // template names, and it is the only per-creature variation an M2 model has (skins, scale,
        // alpha; the mesh itself never changes).
        let mut displays: Vec<(u32, f32, f32, [Option<String>; 3], Option<(u8, u8)>)> = Vec::new();
        if !model_ids.is_empty() {
            if self.creatures.is_none() {
                self.creatures = Some(
                    benilla_formats::load_creature_catalog(&mut self.chain)
                        .map_err(|e| JsError::new(&format!("creature catalog: {e:#}")))?,
                );
            }
            if let Some(catalog) = self.creatures.as_ref() {
                let mut rows: Vec<(u32, u32)> = catalog.display_models().collect();
                rows.sort_unstable();
                for (display_id, model_id) in rows {
                    if !model_ids.contains(&model_id) {
                        continue;
                    }
                    let Some(model) = catalog.model(display_id) else {
                        continue;
                    };
                    displays.push((
                        display_id,
                        model.scale,
                        catalog.display_base_alpha(display_id).unwrap_or(1.0),
                        model.textures.clone(),
                        catalog.display_race_sex(display_id),
                    ));
                }
            }
        }

        // `SpellVisualKit` slots naming the effect row: `SpellVisualKit.effectSlots` and its world
        // effect hold `SpellVisualEffectName` ids, which the string scan cannot see.
        let mut kits: Vec<(u32, u32, String)> = Vec::new();
        if !effect_ids.is_empty() {
            if self.visuals.is_none() {
                self.visuals = Some(
                    benilla_formats::load_spell_visual_catalog(&mut self.chain)
                        .map_err(|e| JsError::new(&format!("spell visuals: {e:#}")))?,
                );
            }
            if let Some(catalog) = self.visuals.as_ref() {
                for kit_id in catalog.kit_ids() {
                    let Some(kit) = catalog.kit(kit_id) else {
                        continue;
                    };
                    for (tag, effect) in kit.effects() {
                        if effect_ids.contains(&effect) {
                            kits.push((kit_id, effect, slot_name(tag)));
                        }
                    }
                }
                kits.sort();
            }
        }

        let hits_js = js_sys::Array::new();
        for hit in &hits {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("table"), &JsValue::from_str(&hit.table));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("column"), &JsValue::from_str(&hit.column));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("row"), &JsValue::from_f64(f64::from(hit.row)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("spelling"), &JsValue::from_str(&hit.spelling));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("nameOnly"), &JsValue::from_bool(hit.name_only));
            hits_js.push(&obj);
        }
        let displays_js = js_sys::Array::new();
        for (id, scale, alpha, skins, race_sex) in &displays {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("id"), &JsValue::from_f64(f64::from(*id)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("scale"), &JsValue::from_f64(f64::from(*scale)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("alpha"), &JsValue::from_f64(f64::from(*alpha)));
            let slots = js_sys::Array::new();
            for skin in skins {
                slots.push(&skin.as_ref().map_or(JsValue::NULL, |name| JsValue::from_str(name)));
            }
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("skins"), &slots);
            // A character-model display composites its body from `CharSections`; the race and sex
            // are what that composite keys on, and its skin slots are empty by design.
            let (race, sex) = race_sex.map_or((JsValue::NULL, JsValue::NULL), |(race, sex)| {
                (JsValue::from_f64(f64::from(race)), JsValue::from_f64(f64::from(sex)))
            });
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("race"), &race);
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("sex"), &sex);
            displays_js.push(&obj);
        }
        let kits_js = js_sys::Array::new();
        for (kit, effect, slot) in &kits {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("kit"), &JsValue::from_f64(f64::from(*kit)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("effect"), &JsValue::from_f64(f64::from(*effect)));
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("slot"), &JsValue::from_str(slot));
            kits_js.push(&obj);
        }
        let unreadable_js = js_sys::Array::new();
        for name in &unreadable {
            unreadable_js.push(&JsValue::from_str(name));
        }

        let out = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("model"),
            &JsValue::from_str(&crate::refs::model_key(model_path).unwrap_or_default()),
        );
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("hits"), &hits_js);
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("tables"), &JsValue::from_f64(tables as f64));
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("unreadable"), &unreadable_js);
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("displays"), &displays_js);
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("kits"), &kits_js);
        Ok(out.into())
    }

    /// One page of a DBC: `{ path, columns, rows, total, matched, offset, schema, keyIndex,
    /// recordCount, fieldCount, types }`, `limit` rows from `offset` after `filter` matched a
    /// cell. Column names come from benilla's own schemas; a table no schema covers shows its raw
    /// `u32` slots as `field0`, `field1`, ...
    pub fn dbc(
        &mut self,
        path: &str,
        offset: u32,
        limit: u32,
        filter: &str,
    ) -> Result<JsValue, JsError> {
        let bytes = self
            .read_any(path)
            .map_err(|e| JsError::new(&format!("{path}: {e}")))?;
        crate::dbc::sheet(&bytes, path, offset, limit.min(5000), filter)
    }

    /// Doodads and buildings placed by a tile, baked into world space: `items` is an array of
    /// `{ path, position: [x, y, z], rotation: [rx, ry, rz] (degrees), scale }`. Returns
    /// `{ textures, batches, failed, skipped, missingTextures, vertexCount }`.
    pub fn props(&mut self, items: JsValue) -> Result<JsValue, JsError> {
        let mut placements = Vec::new();
        let array = items
            .dyn_into::<js_sys::Array>()
            .map_err(|_| JsError::new("props expects an array of placements"))?;
        for value in array.iter() {
            let path = js_sys::Reflect::get(&value, &JsValue::from_str("path"))
                .ok()
                .and_then(|v| v.as_string())
                .ok_or_else(|| JsError::new("a placement has no path"))?;
            let vec3 = |key: &str| -> [f32; 3] {
                js_sys::Reflect::get(&value, &JsValue::from_str(key))
                    .ok()
                    .and_then(|v| v.dyn_into::<js_sys::Array>().ok())
                    .map(|a| {
                        [
                            a.get(0).as_f64().unwrap_or(0.0) as f32,
                            a.get(1).as_f64().unwrap_or(0.0) as f32,
                            a.get(2).as_f64().unwrap_or(0.0) as f32,
                        ]
                    })
                    .unwrap_or([0.0; 3])
            };
            let scale = js_sys::Reflect::get(&value, &JsValue::from_str("scale"))
                .ok()
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0) as f32;
            placements.push(crate::props::Placement {
                path,
                position: vec3("position"),
                rotation: vec3("rotation"),
                scale,
            });
        }
        // 1.5M vertices is a tile's worth of scenery, a whole city included; past it the caller
        // gets the models it could not fit instead of a stalled page.
        Ok(crate::props::build(&mut self.chain, &placements, 1_500_000))
    }

    /// Whether the chain holds a path, without reading it.
    pub fn exists(&self, path: &str) -> bool {
        self.chain.contains(path)
    }

    /// A terrain tile through `adt_to_tile_mesh`: its geometry, layer textures, alpha and shadow
    /// atlases, liquids, doodads and buildings, as the page's terrain viewer draws them.
    pub fn adt(&mut self, name: &str) -> Result<JsValue, JsError> {
        let bytes = self
            .read_any(name)
            .map_err(|e| JsError::new(&format!("{name}: {e}")))?;
        let payload = crate::adt::tile_payload(&bytes)?;
        // The tile's `AreaTable` ids become names: `areas: [{ id, name }]`.
        if self.areas.is_none() {
            let catalog = benilla_formats::load_area_table_catalog(&mut self.chain)
                .map_err(|e| JsError::new(&format!("AreaTable: {e:#}")))?;
            self.areas = Some(catalog);
        }
        let ids = js_sys::Reflect::get(&payload, &JsValue::from_str("areas"))
            .ok()
            .and_then(|value| value.dyn_into::<js_sys::Array>().ok())
            .unwrap_or_else(js_sys::Array::new);
        let named = js_sys::Array::new();
        for index in 0..ids.length() {
            let id = ids.get(index).as_f64().unwrap_or(0.0) as u32;
            let entry = js_sys::Object::new();
            let set = |key: &str, value: JsValue| {
                let _ = js_sys::Reflect::set(&entry, &JsValue::from_str(key), &value);
            };
            set("id", JsValue::from_f64(f64::from(id)));
            let name = self
                .areas
                .as_ref()
                .and_then(|catalog| catalog.name(id))
                .unwrap_or("")
                .to_owned();
            set("name", JsValue::from_str(&name));
            named.push(&entry);
        }
        let _ = js_sys::Reflect::set(&payload, &JsValue::from_str("areas"), &named);
        Ok(payload)
    }

    /// The `SoundEntries` kits that play a file, by the file's MPQ path (any of a kit's variations
    /// matching, case-insensitively): `{ id, soundType, name, volume, minDistance, distanceCutoff }`
    /// per kit, by id. Empty for a file no kit names.
    #[wasm_bindgen(js_name = soundKits)]
    pub fn sound_kits(&mut self, path: &str) -> Result<JsValue, JsError> {
        if self.sounds.is_none() {
            let catalog = benilla_formats::load_sound_kit_catalog(&mut self.chain)
                .map_err(|e| JsError::new(&format!("SoundEntries: {e:#}")))?;
            self.sounds = Some(catalog);
        }
        let wanted = path.replace('/', "\\").to_ascii_lowercase();
        let mut kits: Vec<&benilla_formats::SoundKit> = self
            .sounds
            .as_ref()
            .map(|catalog| {
                catalog
                    .kits()
                    .filter(|kit| {
                        kit.files
                            .iter()
                            .any(|(file, _)| file.replace('/', "\\").to_ascii_lowercase() == wanted)
                    })
                    .collect()
            })
            .unwrap_or_default();
        kits.sort_by_key(|kit| kit.id);
        let out = js_sys::Array::new();
        for kit in kits.iter().take(16) {
            let entry = js_sys::Object::new();
            let set = |k: &str, v: JsValue| {
                let _ = js_sys::Reflect::set(&entry, &JsValue::from_str(k), &v);
            };
            set("id", JsValue::from_f64(kit.id as f64));
            set("soundType", JsValue::from_f64(kit.sound_type as f64));
            set("name", JsValue::from_str(&kit.name));
            set("volume", JsValue::from_f64(kit.volume as f64));
            set("minDistance", JsValue::from_f64(kit.min_distance as f64));
            set("distanceCutoff", JsValue::from_f64(kit.distance_cutoff as f64));
            out.push(&entry);
        }
        Ok(out.into())
    }

    /// One BLP decoded to `{ width, height, rgba }`, without going through the chain.
    #[wasm_bindgen(js_name = decodeBlp)]
    pub fn decode_blp(&self, bytes: &[u8]) -> Result<JsValue, JsError> {
        let pixels = decode(bytes).map_err(|e| JsError::new(&e))?;
        Ok(pixels)
    }

    /// The appearance dials a race and sex offer: `{ skins, faces, hairStyles, hairColors,
    /// facialStyles }`, each a run of variation indices.
    #[wasm_bindgen(js_name = characterOptions)]
    pub fn character_options(&mut self, race: u8, sex: u8) -> Result<JsValue, JsError> {
        let catalog = self.catalog()?;
        let ranges = catalog
            .ranges(race, sex)
            .ok_or_else(|| JsError::new(&format!("race {race} sex {sex} has no customization dials")))?;
        let out = js_sys::Object::new();
        let run = |n: u8| {
            let arr = js_sys::Array::new_with_length(u32::from(n));
            for i in 0..u32::from(n) {
                arr.set(i, JsValue::from_f64(f64::from(i)));
            }
            JsValue::from(arr)
        };
        let set = |k: &str, v: &JsValue| {
            let _ = js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
        };
        set("skins", &run(ranges.skin));
        set("faces", &run(ranges.face));
        set("hairStyles", &run(ranges.hair_style));
        set("hairColors", &run(ranges.hair_color));
        set("facialStyles", &run(ranges.facial_hair));
        Ok(out.into())
    }

    /// Compose one look: the 256² body atlas, the hair and extra-skin textures, and the geosets
    /// the appearance shows. `choice` carries `{ skin, face, hairStyle, hairColor, facialStyle }`.
    pub fn character(&mut self, race: u8, sex: u8, choice: JsValue) -> Result<JsValue, JsError> {
        let field = |k: &str| -> u8 {
            js_sys::Reflect::get(&choice, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
                .max(0.0) as u8
        };
        let (skin, face, hair_style, hair_color, facial_hair) = (
            field("skin"),
            field("face"),
            field("hairStyle"),
            field("hairColor"),
            field("facialStyle"),
        );

        let sections = match self.sections.take() {
            Some(s) => s,
            None => CharSections::load(&mut self.chain)
                .map_err(|e| JsError::new(&format!("CharSections: {e:#}")))?,
        };
        // Everything the composite needs from the tables, read before the chain is borrowed again.
        let hair = sections
            .hair_mesh_texture(race, sex, hair_style, hair_color)
            .map(str::to_owned);
        let extra = sections
            .skin_extra_texture(race, sex, skin)
            .map(str::to_owned);
        let body = sections.composite_body(
            &mut self.chain,
            race,
            sex,
            skin,
            face,
            facial_hair,
            hair_style,
            hair_color,
            [None; 8],
            None,
            false,
        );
        self.sections = Some(sections);
        let body = body.map_err(|e| JsError::new(&format!("body composite: {e:#}")))?;

        let body = match body {
            Some(chain) => Some(mip_chain_to_pixels(chain)),
            None => None,
        };
        let hair_pixels = hair
            .as_ref()
            .and_then(|path| self.texture_pixels(path));
        let extra_pixels = extra
            .as_ref()
            .and_then(|path| self.texture_pixels(path));

        let geosets = match self.geosets.take() {
            Some(g) => g,
            None => CharacterGeosets::load(&mut self.chain)
                .map_err(|e| JsError::new(&format!("geosets: {e:#}")))?,
        };
        let visible = geosets.visible_geosets(race, sex, hair_style, facial_hair, &EquipGeosets::default());
        self.geosets = Some(geosets);
        let ids = js_sys::Uint16Array::from(visible.ids());

        let out = js_sys::Object::new();
        let set = |k: &str, v: &JsValue| {
            let _ = js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
        };
        let chosen = js_sys::Object::new();
        for (k, v) in [
            ("skin", skin),
            ("face", face),
            ("hairStyle", hair_style),
            ("hairColor", hair_color),
            ("facialStyle", facial_hair),
            ("facialColor", hair_color),
        ] {
            let _ = js_sys::Reflect::set(&chosen, &JsValue::from_str(k), &JsValue::from_f64(f64::from(v)));
        }
        set("choice", &chosen);
        set("visibleGeosets", &ids.into());
        set(
            "body",
            &match body {
                Some((w, h, rgba)) => pixels(w, h, &rgba),
                None => JsValue::NULL,
            },
        );
        set(
            "hair",
            &match hair_pixels {
                Some((path, w, h, rgba)) => named_pixels(&path, w, h, &rgba),
                None => JsValue::NULL,
            },
        );
        set(
            "skinExtra",
            &match extra_pixels {
                Some((path, w, h, rgba)) => named_pixels(&path, w, h, &rgba),
                None => JsValue::NULL,
            },
        );
        Ok(out.into())
    }
}

impl Client {
    /// The catalog, read from the chain once.
    fn catalog(&mut self) -> Result<&CharCreateCatalog, JsError> {
        if self.catalog.is_none() {
            let catalog = CharCreateCatalog::load(&mut self.chain)
                .map_err(|e| JsError::new(&format!("character catalog: {e:#}")))?;
            self.catalog = Some(catalog);
        }
        self.catalog
            .as_ref()
            .ok_or_else(|| JsError::new("character catalog missing"))
    }

    /// A chain read by exact path, else by the one listed file with a matching basename: a model's
    /// texture record can name a file relative to its own folder.
    fn read_any(&mut self, name: &str) -> Result<Vec<u8>, String> {
        match self.chain.read(name) {
            Ok(bytes) => return Ok(bytes),
            Err(exact) => {
                let key = basename(name);
                self.index_basenames();
                let full = self
                    .basenames
                    .as_ref()
                    .and_then(|m| m.get(&key))
                    .cloned();
                match full {
                    Some(full) => self
                        .chain
                        .read(&full)
                        .map_err(|e| format!("{exact:#}; basename fallback {full}: {e:#}")),
                    None => Err(format!("{exact:#}")),
                }
            }
        }
    }

    /// The chain-listed path for a texture record, read and decoded.
    fn texture_pixels(&mut self, path: &str) -> Option<(String, u32, u32, Vec<u8>)> {
        let full = match self.read_any(path) {
            Ok(bytes) => {
                let (w, h, rgba) = decode_chain(&bytes)?;
                return Some((path.to_owned(), w, h, rgba));
            }
            Err(_) => self
                .basenames
                .as_ref()
                .and_then(|m| m.get(&basename(path)))
                .cloned()?,
        };
        let bytes = self.chain.read(&full).ok()?;
        let (w, h, rgba) = decode_chain(&bytes)?;
        Some((full, w, h, rgba))
    }

    fn index_basenames(&mut self) {
        if self.basenames.is_some() {
            return;
        }
        if self.listing.is_none() {
            self.listing = Some(build_listing(&self.archives));
        }
        let mut map = HashMap::new();
        for row in self.listing.as_ref().map(Vec::as_slice).unwrap_or_default() {
            map.entry(basename(&row.name)).or_insert(row.name.clone());
        }
        self.basenames = Some(map);
    }
}

/// The lowercased file name of an MPQ or OS path.
fn basename(name: &str) -> String {
    name.rsplit(['\\', '/'])
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase()
}

/// Union every archive's `(listfile)`, resolving each name to the highest-priority archive that
/// holds it, a delete marker removing the path rather than listing it.
fn build_listing(archives: &[Archive]) -> Vec<Row> {
    let mut rows: Vec<Row> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for (i, archive) in archives.iter().enumerate() {
        let Ok(listfile) = archive.read_file("(listfile)") else {
            continue;
        };
        let text = String::from_utf8_lossy(&listfile);
        for raw in text.split([';', '\r', '\n']) {
            let name = raw.trim();
            if name.is_empty() {
                continue;
            }
            let key = name.replace('/', "\\").to_ascii_lowercase();
            if let Some(&slot) = at.get(&key) {
                // A later archive wins its lower copy; a delete marker removes it. Either way the
                // record is already placed, so re-read this archive's flags into it.
                if let Some(info) = archive.file_info(name) {
                    rows[slot].archive = i as u16;
                    rows[slot].size = info.file_size;
                    rows[slot].compressed = info.compressed_size;
                    rows[slot].flags = info.flags;
                    rows[slot].deleted = info.flags & 0x0200_0000 != 0;
                }
                continue;
            }
            let Some(info) = archive.file_info(name) else {
                continue;
            };
            if info.flags & 0x0200_0000 != 0 {
                continue; // a patch's delete marker: not a file
            }
            at.insert(key, rows.len());
            rows.push(Row {
                name: name.to_owned(),
                archive: i as u16,
                size: info.file_size,
                compressed: info.compressed_size,
                flags: info.flags,
                deleted: false,
            });
        }
    }
    rows.retain(|row| !row.deleted);
    rows.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    rows
}

fn mip_chain_to_pixels(chain: benilla_formats::BlpMipChain) -> (u32, u32, Vec<u8>) {
    let chain = chain.into_rgba8();
    let (w, h) = (chain.width, chain.height);
    let rgba = chain.mips.into_iter().next().unwrap_or_default();
    (w, h, rgba)
}

fn decode_chain(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let chain = blp_bytes_to_mip_chain(bytes).ok()?;
    Some(mip_chain_to_pixels(chain))
}

fn decode(bytes: &[u8]) -> Result<JsValue, String> {
    let (w, h, rgba) = decode_chain(bytes).ok_or_else(|| "decoding BLP failed".to_owned())?;
    Ok(pixels(w, h, &rgba))
}

/// `{ width, height, rgba }`, RGBA8 level 0.
fn pixels(width: u32, height: u32, rgba: &[u8]) -> JsValue {
    object_pixels(width, height, rgba, None)
}

/// [`pixels`] plus the file it came from, which the page shows in the character controls.
fn named_pixels(name: &str, width: u32, height: u32, rgba: &[u8]) -> JsValue {
    object_pixels(width, height, rgba, Some(name))
}

fn object_pixels(width: u32, height: u32, rgba: &[u8], name: Option<&str>) -> JsValue {
    let out = js_sys::Object::new();
    let set = |k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
    };
    set("width", &JsValue::from_f64(f64::from(width)));
    set("height", &JsValue::from_f64(f64::from(height)));
    set("rgba", &js_sys::Uint8Array::from(rgba));
    if let Some(name) = name {
        set("filename", &JsValue::from_str(name));
    }
    out.into()
}

/// A `SpellVisualKit` slot's name, in the order [`benilla_formats::KIT_SLOT_TAGS`] lists them.
fn slot_name(tag: u16) -> String {
    if tag == benilla_formats::WORLD_EFFECT_TAG {
        return "world plant".to_string();
    }
    const NAMES: [&str; 9] = [
        "head",
        "chest",
        "base",
        "left hand",
        "right hand",
        "breath",
        "special 1",
        "special 2",
        "special 3",
    ];
    benilla_formats::KIT_SLOT_TAGS
        .iter()
        .position(|&t| t == tag)
        .map(|i| NAMES[i].to_string())
        .unwrap_or_else(|| format!("attachment 0x{tag:x}"))
}
