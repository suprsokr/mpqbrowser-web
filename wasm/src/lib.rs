//! The client's readers, compiled to WebAssembly for the MPQ browser.
//!
//! Everything below the JS surface is the client's own code: `benilla-mpq` reads and decompresses
//! the archives, `benilla-blp` decodes the textures, `benilla-formats` builds the M2 submeshes,
//! skeleton and per-sequence keyframes, and `benilla-mpq`/`benilla-formats` supply the DBC tables
//! the character composite reads, and `benilla_formats::adt_to_tile_mesh` lays out a terrain tile.
//! The page only moves bytes and draws.

mod adt;
mod client;
mod dbc;
mod dbd_names;
mod m2;
mod props;
mod refs;
mod source;

use wasm_bindgen::prelude::*;

pub use client::Client;
pub use m2::M2;

/// Install the panic hook so a reader panic shows up in the page's console with its message.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}
