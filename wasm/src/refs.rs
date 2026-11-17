//! Which shipped tables name a model file.
//!
//! The client reaches a model three ways: a creature's `CreatureModelData.ModelName`, a game
//! object's `GameObjectDisplayInfo.ModelName`, a held item's `ItemDisplayInfo.ModelNameLeft/Right`
//! and a spell effect's `SpellVisualEffectName.FileName`. Rather than trust that list, every table
//! with a schema is read once and every string cell that ends in a model extension is indexed
//! under the name the cache would open it by. A table with no schema carries no types at all, so
//! its cells cannot be read as strings; those tables are reported instead of silently missed.

use std::collections::HashMap;
use std::io::Cursor;

use benilla_dbc::{DbcParser, FieldType, Value};
use benilla_formats::Chain;



/// One cell that spells a model path.
#[derive(Clone)]
pub struct Hit {
    /// The table's own name (`CreatureModelData`), not the file name.
    pub table: String,
    /// The expanded column name, e.g. `ModelName` or `ModelNameLeft`.
    pub column: String,
    /// The row's key field, or its index when the schema names no key.
    pub row: u32,
    /// The cell as the table spells it, which may differ in case, separator or `.mdx`.
    pub spelling: String,
    /// The cell is a bare file name: its loader supplies the folder, so the match is the name.
    pub name_only: bool,
}

/// Every model path a schema-covered table names, keyed by [`model_key`].
pub struct ModelIndex {
    hits: HashMap<String, Vec<Hit>>,
    /// Bare file names, by lowercased name: `ItemDisplayInfo` stores a held model as a file name
    /// and the client reads it under `Item\ObjectComponents\<kind>\`.
    bare: HashMap<String, Vec<Hit>>,
    /// Tables whose records were read, and tables that had to be skipped.
    pub tables: usize,
    pub unreadable: Vec<String>,
}

/// A model path as the cache resolves it: lowercase, backslashes, and `.mdx`/`.mdl` as `.m2`
/// (`benilla_formats::m2_file_name`'s rule). `None` for a cell that names no model.
pub fn model_key(cell: &str) -> Option<String> {
    let lower = cell.trim_start_matches(['\\', '/']).to_ascii_lowercase();
    if lower.ends_with(".wmo") {
        return Some(lower);
    }
    let stem = lower
        .strip_suffix(".mdx")
        .or_else(|| lower.strip_suffix(".mdl"))
        .or_else(|| lower.strip_suffix(".m2"))?;
    Some(format!("{stem}.m2"))
}

/// Read every table in `paths` and index the cells that name a model.
pub fn index(chain: &mut Chain, paths: &[String]) -> ModelIndex {
    let mut hits: HashMap<String, Vec<Hit>> = HashMap::new();
    let mut bare: HashMap<String, Vec<Hit>> = HashMap::new();
    let mut tables = 0usize;
    let mut unreadable: Vec<String> = Vec::new();
    for path in paths {
        let base = path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(path)
            .trim_end_matches(".dbc")
            .trim_end_matches(".DBC");
        let Ok(bytes) = chain.read_file(path) else {
            continue;
        };
        let mut cursor = Cursor::new(bytes.as_slice());
        let Ok(parser) = DbcParser::parse(&mut cursor) else {
            continue;
        };
        let header = *parser.header();
        let Some((schema, _source)) = crate::dbc::schema_for_or_dbd(base, &header) else {
            unreadable.push(base.to_string());
            continue;
        };
        // A table of numbers alone cannot name a model; skip it without reading the records.
        let has_strings = schema
            .fields
            .iter()
            .any(|field| matches!(field.ty, FieldType::String));
        if !has_strings {
            tables += 1;
            continue;
        }
        // Every shipped DBC keys its records on the first column; a schema that names its key
        // still may list it elsewhere, so follow that name when it is there (`dbc::sheet`'s rule).
        let key_index = schema.key_field.as_ref().map_or(0, |key| {
            schema
                .fields
                .iter()
                .position(|field| &field.name == key)
                .unwrap_or(0)
        });
        let Ok(record_set) = parser.with_schema(schema).and_then(|p| p.parse_records()) else {
            continue;
        };
        tables += 1;
        let names = record_set.field_names().to_vec();
        for (index, record) in record_set.records().iter().enumerate() {
            let row = match record.get_value(key_index) {
                Some(Value::UInt32(id)) => *id,
                Some(Value::Int32(id)) => u32::try_from(*id).unwrap_or(index as u32),
                _ => index as u32,
            };
            for (slot, name) in names.iter().enumerate() {
                let Some(Value::StringRef(reference)) = record.get_value(slot).copied() else {
                    continue;
                };
                let spelling = record_set.get_string(reference).unwrap_or_default();
                let Some(key) = model_key(&spelling) else {
                    continue;
                };
                let name_only = !spelling.contains(['\\', '/']);
                let hit = Hit {
                    table: base.to_string(),
                    column: name.clone(),
                    row,
                    spelling: spelling.into_owned(),
                    name_only,
                };
                if hit.name_only {
                    if let Some(file) = key.rsplit('\\').next() {
                        bare.entry(file.to_string()).or_default().push(hit.clone());
                    }
                }
                hits.entry(key).or_default().push(hit);
            }
        }
    }
    for list in hits.values_mut().chain(bare.values_mut()) {
        list.sort_by(|a, b| (&a.table, &a.column, a.row).cmp(&(&b.table, &b.column, b.row)));
    }
    ModelIndex {
        hits,
        bare,
        tables,
        unreadable,
    }
}

impl ModelIndex {
    /// Every cell naming `path`, in table then row order. A held item's model is stored as a file
    /// name alone, so an `Item\ObjectComponents\` path also collects the bare-name cells.
    pub fn hits(&self, path: &str) -> Vec<Hit> {
        let Some(key) = model_key(path) else {
            return Vec::new();
        };
        let mut found = self.hits.get(&key).cloned().unwrap_or_default();
        let held = key.contains("item\\objectcomponents\\");
        if held {
            if let Some(file) = key.rsplit('\\').next() {
                if let Some(list) = self.bare.get(file) {
                    for hit in list {
                        if !found.iter().any(|f| f.table == hit.table && f.row == hit.row && f.column == hit.column) {
                            found.push(hit.clone());
                        }
                    }
                }
            }
        }
        found.sort_by(|a, b| (&a.table, &a.column, a.row).cmp(&(&b.table, &b.column, b.row)));
        found
    }
}
