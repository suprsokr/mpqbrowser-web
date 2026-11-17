//! Column names for the tables `benilla-formats` has no schema for, taken from VanillaDBDefs
//! (https://github.com/suprsokr/VanillaDBDefs), the `.dbd` definitions that cover build
//! 1.12.1.5875.
//!
//! Only a table whose `.dbd` column list expands to exactly the slot count the shipped file
//! declares, and whose records are four bytes a slot, is listed here: anything else would put a
//! name on the wrong column. `CharBaseInfo` is the exception the rule excludes: its slots are one
//! byte each, so its `.dbd` names are right but unreadable by the four-byte record reader.
//! benilla's own schemas always win (`dbc::schema_for`); this is the fallback for the tables it
//! does not load, so the page can show `SpellIcon.TextureFilename` instead of `F1`.
//!
//! Generated from the definitions; `tools/dbd-names.py` rebuilds it.

use benilla_dbc::{FieldType, Schema, SchemaField};

/// One named column of a table benilla does not load.
pub struct Column {
    pub name: &'static str,
    pub ty: FieldType,
    /// Array length; the schema expands it to separate slots.
    pub count: usize,
}

const fn col(name: &'static str, ty: FieldType) -> Column {
    Column { name, ty, count: 1 }
}


const TABLES: &[(&str, &[Column])] = &[
    ("AttackAnimTypes", &[
        col("AnimID", FieldType::UInt32),
        col("AnimName", FieldType::String),
    ]),
    ("GameObjectArtKit", &[
        col("ID", FieldType::UInt32),
        Column { name: "TextureVariation", ty: FieldType::String, count: 3 },
        Column { name: "AttachModel", ty: FieldType::String, count: 4 },
    ]),
    ("LightSkybox", &[
        col("ID", FieldType::UInt32),
        col("Name", FieldType::String),
    ]),
    ("LiquidType", &[
        col("ID", FieldType::UInt32),
        col("Name", FieldType::String),
        col("Flags", FieldType::UInt32),
        col("SpellID", FieldType::UInt32),
    ]),
    ("NameGen", &[
        col("ID", FieldType::UInt32),
        col("Name", FieldType::String),
        col("RaceID", FieldType::UInt32),
        col("Sex", FieldType::UInt32),
    ]),
    ("PageTextMaterial", &[
        col("ID", FieldType::UInt32),
        col("Name", FieldType::String),
    ]),
    ("PaperDollItemFrame", &[
        col("ItemButtonName", FieldType::String),
        col("SlotIcon", FieldType::String),
        col("SlotNumber", FieldType::UInt32),
    ]),
    ("SoundSamplePreferences", &[
        col("ID", FieldType::UInt32),
        col("Field_0_6_0_3592_001", FieldType::UInt32),
        col("Field_0_6_0_3592_002", FieldType::UInt32),
        col("EAX2SampleRoom", FieldType::UInt32),
        col("Field_0_6_0_3592_004", FieldType::UInt32),
        col("Field_0_6_0_3592_005", FieldType::UInt32),
        col("Field_0_6_0_3592_006", FieldType::Float32),
        col("Field_0_6_0_3592_007", FieldType::UInt32),
        col("EAX2SampleOcclusionLFRatio", FieldType::Float32),
        col("EAX2SampleOcclusionRoomRatio", FieldType::Float32),
        col("Field_0_6_0_3592_010", FieldType::UInt32),
        col("EAX1EffectLevel", FieldType::Float32),
        col("Field_0_6_0_3592_012", FieldType::UInt32),
        col("Field_0_6_0_3592_013", FieldType::Float32),
        col("EAX3SampleExclusion", FieldType::Float32),
        col("Field_0_6_0_3592_015", FieldType::Float32),
        col("Field_0_6_0_3592_016", FieldType::UInt32),
    ]),
    ("SpellCastTimes", &[
        col("ID", FieldType::UInt32),
        col("Base", FieldType::UInt32),
        col("PerLevel", FieldType::UInt32),
        col("Minimum", FieldType::UInt32),
    ]),
    ("SpellCategory", &[
        col("ID", FieldType::UInt32),
        col("Flags", FieldType::UInt32),
    ]),
    ("SpellDuration", &[
        col("ID", FieldType::UInt32),
        col("Duration", FieldType::UInt32),
        col("DurationPerLevel", FieldType::UInt32),
        col("MaxDuration", FieldType::UInt32),
    ]),
    ("SpellIcon", &[
        col("ID", FieldType::UInt32),
        col("TextureFilename", FieldType::String),
    ]),
    ("SpellRadius", &[
        col("ID", FieldType::UInt32),
        col("Radius", FieldType::Float32),
        col("RadiusPerLevel", FieldType::Float32),
        col("RadiusMax", FieldType::Float32),
    ]),
    ("Stationery", &[
        col("ID", FieldType::UInt32),
        col("ItemID", FieldType::UInt32),
        col("Texture", FieldType::String),
        col("Flags", FieldType::UInt32),
    ]),
    ("StringLookups", &[
        col("ID", FieldType::UInt32),
        col("String", FieldType::String),
    ]),
    ("UISoundLookups", &[
        col("ID", FieldType::UInt32),
        col("SoundID", FieldType::UInt32),
        col("SoundName", FieldType::String),
    ]),
    ("VideoHardware", &[
        col("ID", FieldType::UInt32),
        col("VendorID", FieldType::UInt32),
        col("DeviceID", FieldType::UInt32),
        col("FarclipIdx", FieldType::UInt32),
        col("TerrainLODDistIdx", FieldType::UInt32),
        col("TerrainShadowLOD", FieldType::UInt32),
        col("DetailDoodadDensityIdx", FieldType::UInt32),
        col("DetailDoodadAlpha", FieldType::UInt32),
        col("AnimatingDoodadIdx", FieldType::UInt32),
        col("Trilinear", FieldType::UInt32),
        col("NumLights", FieldType::UInt32),
        col("Specularity", FieldType::UInt32),
        col("WaterLODIdx", FieldType::UInt32),
        col("ParticleDensityIdx", FieldType::UInt32),
        col("UnitDrawDistIdx", FieldType::UInt32),
        col("SmallCullDistIdx", FieldType::UInt32),
        col("ResolutionIdx", FieldType::UInt32),
        col("BaseMipLevel", FieldType::UInt32),
        col("OglOverrides", FieldType::String),
        col("D3dOverrides", FieldType::String),
        col("FixLag", FieldType::UInt32),
        col("Multisample", FieldType::UInt32),
    ]),
];

/// The schema VanillaDBDefs names for `base`, when the slot count it declares matches the file.
pub fn schema(base: &str, field_count: u32) -> Option<Schema> {
    let (name, columns) = TABLES
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(base))?;
    let slots: usize = columns.iter().map(|column| column.count).sum();
    if slots != field_count as usize {
        return None;
    }
    let mut schema = Schema::new(*name);
    for column in *columns {
        schema.add_field(if column.count == 1 {
            SchemaField::new(column.name, column.ty)
        } else {
            SchemaField::new_array(column.name, column.ty, column.count)
        });
    }
    Some(schema)
}

/// How many tables the fallback names, for the page's note.
pub fn table_count() -> usize {
    TABLES.len()
}
