//! A DBC table as the page shows it: column names from the schemas benilla ships, one row per
//! record, and a filter that the page's paging applies on the way through.
//!
//! The header, the records and the string block are `benilla-dbc`'s own reader, and the column
//! names are the ones its loaders use (`benilla_formats::all_schemas`). A table no schema covers
//! still opens: its slots are then raw `u32` columns named `field0`, `field1`, ... because the
//! file carries no column types at all.

use std::io::Cursor;

use benilla_dbc::{DbcParser, FieldType, Schema, Value};
use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::*;

fn set(obj: &Object, key: &str, value: JsValue) {
    let _ = Reflect::set(obj, &JsValue::from_str(key), &value);
}

/// A schema's expanded slot count, arrays counted per element.
fn expanded_len(schema: &Schema) -> usize {
    schema.fields.iter().map(|f| f.count).sum()
}

/// The schema the crate ships for this table, when its shape fits the file's header. Matching is
/// the loader's own rule: the base file name, and a slot count the record layout agrees with.
/// The schema the crate ships for a table, or the one VanillaDBDefs names when benilla has none
/// and the records are four bytes a slot: `(schema, "a note for the page")`.
pub(crate) fn schema_for_or_dbd(base: &str, header: &benilla_dbc::Header) -> Option<(Schema, &'static str)> {
    if let Some(schema) = schema_for(base, header.field_count) {
        return Some((schema, ""));
    }
    let four_byte_slots = header.record_size as usize == 4 * header.field_count as usize;
    if !four_byte_slots {
        return None;
    }
    crate::dbd_names::schema(base, header.field_count)
        .map(|schema| (schema, "column names from VanillaDBDefs: benilla has no schema for this table"))
}

pub(crate) fn schema_for(base: &str, field_count: u32) -> Option<Schema> {
    benilla_formats::all_schemas()
        .into_iter()
        .map(|(_, schema)| schema)
        .find(|schema| {
            schema.name.eq_ignore_ascii_case(base) && expanded_len(schema) == field_count as usize
        })
}

/// `Value` as JS: numbers stay numbers, string references resolve through the string block.
fn cell_value(set: &benilla_dbc::RecordSet, value: &Value) -> JsValue {
    match value {
        Value::UInt32(x) => JsValue::from_f64(f64::from(*x)),
        Value::Int32(x) => JsValue::from_f64(f64::from(*x)),
        Value::Float32(x) => JsValue::from_f64(f64::from(*x)),
        Value::StringRef(reference) => {
            JsValue::from_str(&set.get_string(*reference).unwrap_or_default())
        }
    }
}

/// The same cell as text, for the filter to look through.
fn cell_text(set: &benilla_dbc::RecordSet, value: &Value) -> String {
    match value {
        Value::UInt32(x) => x.to_string(),
        Value::Int32(x) => x.to_string(),
        Value::Float32(x) => {
            // `1.0000` reads better than `1` when the column is a factor; trim to what it needs.
            let mut text = format!("{x:.4}");
            while text.ends_with('0') && text.contains('.') {
                text.pop();
            }
            if text.ends_with('.') {
                text.pop();
            }
            text
        }
        Value::StringRef(reference) => set.get_string(*reference).unwrap_or_default().into_owned(),
    }
}

fn row_object(set: &benilla_dbc::RecordSet, record: &benilla_dbc::Record) -> JsValue {
    let row = Array::new();
    for index in 0..set.field_names().len() {
        let cell = match record.get_value(index) {
            Some(value) => cell_value(set, value),
            None => JsValue::NULL,
        };
        row.push(&cell);
    }
    row.into()
}

/// Raw `u32` slots for a table no schema covers, as `record_size / 4` columns.
fn raw_sheet(
    bytes: &[u8],
    path: &str,
    offset: u32,
    limit: u32,
    filter: &str,
) -> Result<JsValue, JsError> {
    let mut cursor = Cursor::new(bytes);
    let parser = DbcParser::parse(&mut cursor).map_err(|e| JsError::new(&format!("{path}: {e}")))?;
    let header = *parser.header();
    let fields = header.field_count as usize;
    let stride = header.record_size as usize;
    // A record is `field_count` slots wide: 4 bytes each, or 2 for `CharBaseInfo`'s packed
    // (race, class) pairs, which the typed reader refuses for exactly that reason.
    // `CharBaseInfo` packs (race, class) as two bytes, one a slot; everything else is 4.
    let slot_bytes = if fields > 0 && stride % fields == 0 && matches!(stride / fields, 1 | 2 | 4) {
        stride / fields
    } else {
        return Err(JsError::new(&format!(
            "{path}: {fields} fields over {stride}-byte records — no schema, and no slot width that fits"
        )));
    };
    let slots = fields;
    let count = header.record_count as usize;
    let needle = filter.to_ascii_lowercase();
    let (mut matched, mut emitted) = (0u32, 0u32);
    let rows = Array::new();
    for record in 0..count {
        let start = 20 + record * stride;
        let Some(record_bytes) = bytes.get(start..start + stride) else {
            break;
        };
        let values: Vec<u32> = record_bytes
            .chunks_exact(slot_bytes)
            .map(|slot| match slot_bytes {
                1 => u32::from(slot[0]),
                2 => u32::from(u16::from_le_bytes([slot[0], slot[1]])),
                _ => u32::from_le_bytes([slot[0], slot[1], slot[2], slot[3]]),
            })
            .collect();
        if !needle.is_empty()
            && !values
                .iter()
                .any(|value| value.to_string().to_ascii_lowercase().contains(&needle))
        {
            continue;
        }
        matched += 1;
        if matched > offset && emitted < limit {
            let row = Array::new();
            for value in &values {
                row.push(&JsValue::from_f64(f64::from(*value)));
            }
            rows.push(&row);
            emitted += 1;
        }
    }

    let columns = Array::new();
    for slot in 0..slots {
        columns.push(&JsValue::from_str(&format!("field{slot}")));
    }
    let out = Object::new();
    set(&out, "path", JsValue::from_str(path));
    set(&out, "columns", columns.into());
    set(&out, "rows", rows.into());
    set(&out, "total", JsValue::from_f64(count as f64));
    set(&out, "matched", JsValue::from_f64(f64::from(matched)));
    set(&out, "offset", JsValue::from_f64(f64::from(offset)));
    set(&out, "schema", JsValue::NULL);
    set(
        &out,
        "note",
        JsValue::from_str(&format!(
            "no schema for this table: values are the raw u{} slots",
            slot_bytes * 8
        )),
    );
    set(&out, "recordCount", JsValue::from_f64(count as f64));
    set(
        &out,
        "fieldCount",
        JsValue::from_f64(f64::from(header.field_count)),
    );
    Ok(out.into())
}

/// One page of a DBC, `limit` rows from `offset` after `filter` (a case-insensitive substring
/// over every cell).
pub fn sheet(
    bytes: &[u8],
    path: &str,
    offset: u32,
    limit: u32,
    filter: &str,
) -> Result<JsValue, JsError> {
    let base = path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .trim_end_matches(".dbc")
        .trim_end_matches(".DBC");
    let mut cursor = Cursor::new(bytes);
    let parser = DbcParser::parse(&mut cursor).map_err(|e| JsError::new(&format!("{path}: {e}")))?;
    let header = *parser.header();
    let Some((schema, source)) = schema_for_or_dbd(base, &header) else {
        return raw_sheet(bytes, path, offset, limit, filter);
    };
    let key = schema.key_field.clone();
    let key_index = key.as_ref().map(|key| {
        schema
            .fields
            .iter()
            .position(|field| &field.name == key)
            .unwrap_or(0)
    });
    let record_set = parser
        .with_schema(schema.clone())
        .and_then(|parser| parser.parse_records())
        .map_err(|e| JsError::new(&format!("{path}: {e}")))?;

    let needle = filter.to_ascii_lowercase();
    let (mut matched, mut emitted) = (0u32, 0u32);
    let rows = Array::new();
    for record in record_set.records() {
        if !needle.is_empty() {
            let mut hit = false;
            for index in 0..record_set.field_names().len() {
                if let Some(value) = record.get_value(index) {
                    if cell_text(&record_set, value)
                        .to_ascii_lowercase()
                        .contains(&needle)
                    {
                        hit = true;
                        break;
                    }
                }
            }
            if !hit {
                continue;
            }
        }
        matched += 1;
        if matched > offset && emitted < limit {
            rows.push(&row_object(&record_set, record));
            emitted += 1;
        }
    }

    let columns = Array::new();
    for name in record_set.field_names() {
        columns.push(&JsValue::from_str(name));
    }
    let out = Object::new();
    set(&out, "path", JsValue::from_str(path));
    set(&out, "columns", columns.into());
    set(&out, "rows", rows.into());
    set(&out, "total", JsValue::from_f64(header.record_count as f64));
    set(&out, "matched", JsValue::from_f64(f64::from(matched)));
    set(&out, "offset", JsValue::from_f64(f64::from(offset)));
    set(&out, "schema", JsValue::from_str(&schema.name));
    if !source.is_empty() {
        set(&out, "note", JsValue::from_str(source));
    }
    set(
        &out,
        "keyIndex",
        key_index.map_or(JsValue::NULL, |i| JsValue::from_f64(i as f64)),
    );
    set(
        &out,
        "recordCount",
        JsValue::from_f64(header.record_count as f64),
    );
    set(
        &out,
        "fieldCount",
        JsValue::from_f64(f64::from(header.field_count)),
    );
    set(
        &out,
        "types",
        {
            let types = Array::new();
            for field in &schema.fields {
                for _ in 0..field.count {
                    types.push(&JsValue::from_str(match field.ty {
                        FieldType::UInt32 => "u32",
                        FieldType::Int32 => "i32",
                        FieldType::Float32 => "f32",
                        FieldType::String => "string",
                    }));
                }
            }
            types.into()
        },
    );
    Ok(out.into())
}
