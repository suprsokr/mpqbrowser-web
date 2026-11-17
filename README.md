# MPQ Browser

A browser viewer for World of Warcraft MPQ archives, backed by the benilla client's own readers.

Live: <https://suprsokr.github.io/mpqbrowser-web/>. GitHub Pages has no server, so there click
**Select Folder** and pick your client's `Data` folder; everything runs on the files it reads.

List every file path the archives hold, preview a `.blp` texture, open an `.m2` model in a WebGL2
viewer with its animations and textures, fly over an `.adt` terrain tile with its ground textures
listed, read a `.dbc` table with its column names, or play a `.wav` / `.mp3` sound. A model preview also lists every texture slot it
binds: the file, its size, how many draw batches use it, and a note when a slot has nothing to bind
(the body before compositing, an item skin, a record that names no file). A `Monster1/2/3` slot is
filled from `CreatureDisplayInfo`, so a model no display names (unused art such as
`Creature\Zombie\ZombieSword.m2`) has nothing to bind and draws untextured, as the client draws
it. Nothing is copied into browser memory: the server streams byte ranges and the wasm reader asks for exactly what it needs.
A terrain tile draws the same 256 `MCNK` chunks the client's streamer meshes: its four `MCLY`
layers blended by the chunk's `MCAL` alpha map, the `MCSH` shadow multiply, and its `MCLQ` liquid
surfaces. The panel lists every `MTEX` file with how many chunks draw it. Doodads and buildings
load on demand behind two toggles (`Doodads (219)`, `Buildings (3)`), inside a panel that starts
collapsed like every other one, so the tile itself gets the space: each model comes from
`benilla_formats::load_object_model`, every placement is baked into world space, and the instances
merge per texture and blend state, so a forest costs one draw per material rather than per tree.
Drag to look, `WASD` to fly, `Space`/`C` up and down, `Shift` to hurry, the wheel to change speed.

A DBC opens as a table: column names and types from the schemas benilla's loaders build (120 of the
154 tables in this data have one), one page of rows at a time, and a filter that matches any cell.
For 17 more, `wasm/src/dbd_names.rs` supplies the names from
[VanillaDBDefs](https://github.com/suprsokr/VanillaDBDefs), whose `.dbd` definitions cover build
1.12.1.5875; those rows say where their names came from. Only a `.dbd` column list that expands to
exactly the slot count the shipped file declares is used, so a table can never get a name on the
wrong column. The 17 tables left over have `.dbd` blocks that disagree with their headers
(`SpellRange` 3 columns against 22 slots, `CharStartOutfit` 10 against 41); they still open as raw
slots at whatever width the record layout implies. `tools/dump-dbc-headers.mjs` and
`tools/dbd-names.py` rebuild the generated file.

Each preview has one `DBCs (n)` panel: the tables it read, the ones the panel opens on demand, and
for a model the rows those tables reach by id. Clicking a table opens it. A character lists the
eight tables behind the composite; a creature lists its display and model rows plus
`CreatureDisplayInfoExtra`, `CreatureSoundData` and `SoundEntries`; a terrain tile lists
`AreaTable`, which names the zones underfoot (`Elwynn Forest (12)`), and says which tables the
client reads for a tile that this preview does not. Every panel starts collapsed, so the model or
tile keeps the space.

A sound plays in place, with the file's sample rate and length and the `SoundEntries` kits that
name it (id, name, type, volume, distance cutoff).

On a phone the file list stacks into cards, with the path on its own line.

## What reads the files

Nothing is re-implemented in the page. `wasm/` is a small crate (`benilla-web`) over the client's
readers, compiled to WebAssembly:

- `benilla-mpq` finds each archive's header, mounts the client's patch order (`base`, `dbc`,
  `fonts`, `interface`, `misc`, `model`, `sound`, `speech`, `terrain`, `texture`, `wmo`,
  `patch.MPQ`, `patch-?.MPQ`, `speech2.MPQ`), unions every `(listfile)`, and decompresses files
  sector by sector.
- `benilla-blp` decodes BLP2 textures to RGBA8.
- `benilla-formats` builds the M2 submeshes, skeleton and per-sequence animation keys, drives the
  character body composite from `CharSections.dbc`, lays out a terrain tile (`adt_to_tile_mesh`:
  geometry, layer order, alpha map, liquids), and loads a tile's placed models as drawable
  submeshes (`load_object_model`: M2 doodads and WMO buildings).
- `benilla-adt` parses the tile's IFF records and its `MCNK` chunks.
- `benilla-dbc` reads the tables those need, and the page's table view decodes any DBC with the
  schema its loader uses (`benilla_formats::all_schemas`).

`benilla-mpq` reads through a `Source` trait, so the same code paths run against a file on disk and
against the page's range requests. The worker answers those ranges synchronously (a `File` for the
folder picker, a synchronous range request for the local server), which keeps the reader's
`Read + Seek` shape intact.

## Requirements

- Node.js 20+ and npm, Rust with `wasm32-unknown-unknown`, and `wasm-pack`
- The benilla checkout, beside this one: `~/dev/benilla`, because `wasm/Cargo.toml` takes its
  readers from `../../benilla/crates/`
- A browser with WebGL2 and Web Workers; the folder picker additionally needs the File System
  Access API (Chrome/Edge)

## Build

```bash
npm install          # also installs www/
npm run wasm         # wasm-pack build -> www/vendor/benilla-web
npm run build        # wasm + tsc + vite build -> www/dist
npm run build:web    # tsc + vite build only, using the committed wasm bundle
```

`www/vendor/benilla-web/` is the compiled wasm reader, committed because building it needs a
`benilla` checkout beside this repo. `npm run wasm` regenerates it.

## Run

`server.mjs` serves `www/dist` and the archives in `DATA_DIR`. There is no default: point it at
your own client's data folder.

```bash
DATA_DIR=/path/to/WoW/Data PORT=8088 npm run serve
```

Open `http://localhost:8088/`. The page mounts every `.mpq` in the folder on load and lists them.

For the dev server instead, run `npm run serve` in one terminal and `npm run dev` in another; Vite
proxies `/api` to port 8088.

### Endpoints

- `GET /api/archives` — the mounted archives with their sizes
- `GET /api/archive/<name>?offset=&length=` — one byte range of an archive (`Range:` also works)

## Without a server

**Select Folder** uses `showDirectoryPicker`, reads the picked `File`s with `FileReaderSync` in the
worker, and needs no server. The parsers are the same.

## License

MIT OR Apache-2.0
