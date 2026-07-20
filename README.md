# MPQ Browser

A memory-efficient, browser-based viewer for World of Warcraft MPQ archives.
Select a folder containing one or more MPQ archives and see every file path inside every `.mpq` archive — without loading the multi-gigabyte archives into
browser memory.

Click any `.blp` texture file in the list to render a preview of it directly
in the browser. The preview is decoded in the same Web Worker that lists the
archive, so the UI stays responsive.

## How it stays memory-efficient

- Uses the browser **File System Access API** (`showDirectoryPicker`) so the
  files stay on disk.
- The `wow-mpq-web` npm package provides a streaming class,
  `MpqStreamingArchive`, that loads only the MPQ **header** and **index
  tables** required to enumerate file paths. File contents are read on demand
  via a synchronous `FileReaderSync` callback.
- The actual archive parsing runs in a **Web Worker**. The main UI thread stays
  responsive and never sees the large archives.
- BLP texture previews are decoded by `wow-blp-web` in the same Web Worker.
  The decoded PNG is sent back to the main thread as a blob URL and rendered
  in a new table row under the clicked file.

## Requirements

- Node.js 20+ and npm
- A browser (Chrome/Edge) with the File System Access
  API (`showDirectoryPicker`) enabled.

## Setup

```bash
cd ~/dev/mpqbrowser
npm install
```

This also installs the frontend dependencies in `www/`, including the
`wow-mpq-web` and `wow-blp-web` npm packages.

## Run locally

```bash
npm run dev
```

This starts the Vite dev server. Open the printed URL, click **Select Folder**,
and choose your `Data` directory.

## Build for production

```bash
npm run build
```

Output is placed in `www/dist`.

## GitHub Pages

The site is deployed automatically to GitHub Pages on every push to `main` via
`.github/workflows/pages.yml`. The live site is available at:

<https://suprsokr.github.io/mpqbrowser-web/>

The Vite `base` path is set to `/mpqbrowser-web/` only when `GITHUB_PAGES=true`
is set during the build, so local development continues to use `/`.

## License

MIT OR Apache-2.0
