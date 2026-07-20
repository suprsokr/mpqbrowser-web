# MPQ Browser

A memory-efficient, browser-based viewer for World of Warcraft MPQ archives.
Select a folder like `~/Downloads/Client/Data` and see every file path inside
every `.mpq` archive — without loading the multi-gigabyte archives into
browser memory.

## How it stays memory-efficient

- Uses the browser **File System Access API** (`showDirectoryPicker`) so the
  files stay on disk.
- The `wow-mpq-web` npm package provides a streaming class,
  `MpqStreamingArchive`, that loads only the MPQ **header** and **index
  tables** required to enumerate file paths. File contents are read on demand
  via a synchronous `FileReaderSync` callback.
- The actual archive parsing runs in a **Web Worker**. The main UI thread stays
  responsive and never sees the large archives.

## Requirements

- Node.js 20+ and npm
- A Chromium-based browser (Chrome/Edge) or Firefox with the File System Access
  API (`showDirectoryPicker`).

## Setup

```bash
cd ~/dev/mpqbrowser
npm install
```

This also installs the frontend dependencies in `www/`, including the
`wow-mpq-web` npm package.

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

## Why a Web Worker?

The `wow-mpq-web` `MpqStreamingArchive` class requires a synchronous read
source. Browser file access is asynchronous, but inside a Web Worker we can use
`FileReaderSync` to read `Blob` slices synchronously. The worker passes that
synchronous reader to the WebAssembly module, which only requests header and
table ranges. The main UI thread stays responsive and never sees the large
archives.

## Project layout

```
mpqbrowser/
├── package.json            # Root build scripts
├── README.md
└── www/
    ├── package.json        # Frontend dependencies (including wow-mpq-web)
    ├── vite.config.ts
    ├── tsconfig.json
    ├── index.html
    └── src/
        ├── main.ts         # UI + directory picker + aggregation
        ├── worker.ts       # Wasm + FileReaderSync listing worker
        └── types.d.ts      # File System Access API types
```

## License

MIT OR Apache-2.0
