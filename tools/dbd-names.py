#!/usr/bin/env python3
"""Rebuild `wasm/src/dbd_names.rs` from VanillaDBDefs and the shipped DBC headers.

`benilla-formats` builds a schema for 120 of the 154 tables in the 1.12 archives. The page still
wants names for the rest, so this reads the `.dbd` definitions that cover build 1.12.1.5875 and
emits a fallback schema for every table that is not just missing from benilla but also described
exactly: the `.dbd` column list, arrays expanded, has to equal the slot count the shipped file
declares, and the records have to be four bytes a slot. Anything looser would put a name on the
wrong column, which is worse than `field3`.

Usage:
    git clone --depth 1 https://github.com/suprsokr/VanillaDBDefs /tmp/VanillaDBDefs
    node tools/dump-dbc-headers.mjs ~/Downloads/vwow/Data /tmp/tables.json
    python3 tools/dbd-names.py /tmp/VanillaDBDefs/definitions /tmp/tables.json wasm/src/dbd_names.rs

`tables.json` holds `headers` (table base name to `[field count, record stride]`) and `benilla`
(the table names the crate already names).
"""

import json
import os
import re
import sys

TARGET = (1, 12, 1, 5875)
COLUMN_RE = re.compile(r"^([a-z]+)(?:<[^>]*>)?(?:\[(\d+)\])?\s+(\S+?)\??$")

HEADER = '''//! Column names for the tables `benilla-formats` has no schema for, taken from VanillaDBDefs
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
'''

TAIL = '''
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
'''


def parse_builds(text):
    out = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            low, high = part.split("-")
            out.append(
                (
                    tuple(int(x) for x in low.split(".")),
                    tuple(int(x) for x in high.split(".")),
                )
            )
        else:
            build = tuple(int(x) for x in part.split("."))
            out.append((build, build))
    return out


def covers_target(ranges):
    return any(low <= TARGET <= high for low, high in ranges)


def parse_def(line):
    line = re.sub(r"^\$[a-z]+\$", "", line.strip()).rstrip("?")
    count = 1
    match = re.search(r"\[(\d+)\]", line)
    if match:
        count = int(match.group(1))
        line = line[: match.start()] + line[match.end() :]
    return re.sub(r"<[^>]*>", "", line).strip(), count


def parse_dbd(path):
    lines = open(path).read().split("\n")
    index = 0
    while index < len(lines) and lines[index].strip() != "COLUMNS":
        index += 1
    index += 1
    columns = []
    while index < len(lines) and lines[index].strip() != "":
        match = COLUMN_RE.match(lines[index].strip())
        if match:
            columns.append(
                (match.group(3), match.group(1), int(match.group(2)) if match.group(2) else 1)
            )
        index += 1

    blocks, current = [], None
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line:
            if current:
                blocks.append(current)
            current = None
            continue
        if current is None:
            current = {"builds": [], "defs": [], "has_build": False}
        if line.startswith("BUILD "):
            current["builds"].extend(parse_builds(line[6:]))
            current["has_build"] = True
        elif line.startswith(("LAYOUT ", "COMMENT ")):
            continue
        elif line.startswith("$") or re.match(r"^[A-Za-z]", line):
            current["defs"].append(parse_def(line))
    if current:
        blocks.append(current)
    return columns, blocks


def table_columns(defs_dir, base, fields):
    path = os.path.join(defs_dir, base + ".dbd")
    if not os.path.exists(path):
        return None
    columns, blocks = parse_dbd(path)
    types = {name: ty for name, ty, _ in columns}
    for block in blocks:
        if block["has_build"] and not covers_target(block["builds"]):
            continue
        # A block with no column list describes the whole COLUMNS block in order.
        defs = block["defs"] or [(name, count) for name, _ty, count in columns]
        if sum(count for _, count in defs) != fields:
            continue
        if not all(name in types for name, _ in defs):
            continue
        return [
            (
                name,
                {"float": "F32", "string": "Str", "locstring": "Str"}.get(types[name], "U32"),
                count,
            )
            for name, count in defs
        ]
    return None


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        return 1
    defs_dir, headers_path, out_path = sys.argv[1:]
    dumped = json.load(open(headers_path))
    headers = dumped["headers"]
    benilla = set(dumped["benilla"])

    tables = {}
    for base, (fields, stride) in sorted(headers.items()):
        if base.lower() in benilla or stride != 4 * fields:
            continue
        columns = table_columns(defs_dir, base, fields)
        if columns:
            tables[base] = columns

    out = [HEADER, "\nconst TABLES: &[(&str, &[Column])] = &["]
    for base, columns in tables.items():
        out.append(f'    ("{base}", &[')
        for name, kind, count in columns:
            ty = {"U32": "FieldType::UInt32", "F32": "FieldType::Float32", "Str": "FieldType::String"}[kind]
            if count == 1:
                out.append(f'        col("{name}", {ty}),')
            else:
                out.append(f'        Column {{ name: "{name}", ty: {ty}, count: {count} }},')
        out.append("    ]),")
    out.append("];")
    open(out_path, "w").write("\n".join(out) + "\n" + TAIL)
    print(f"{len(tables)} table(s) written to {out_path}")
    for base in tables:
        print(f"  {base}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
