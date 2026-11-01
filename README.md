# Tumbal Proyek

A local-first manga reader with OwOCR/Yomitan, MangaOCR, AnkiConnect, and texthooker integration.

## Development

Requires Node.js 20 or newer.

    npm install
    npm run dev

Open the local Vite URL printed by the dev server. The app is now a multi-file Svelte/TypeScript project, so it must be served over HTTP/HTTPS; opening index.html directly with the file:// protocol is not supported.

## Validate and build

    npm run check
    npm run build
    npm run preview

The production site is emitted to dist/.

## Local integrations

| Service | Default endpoint | Use |
| --- | --- | --- |
| OwOCR | ws://127.0.0.1:7331 | JSON OCR with coordinates |
| MangaOCR | ws://127.0.0.1:7441 | Text-only second pass |
| Texthooker | ws://127.0.0.1:6677 | Receive extracted text |
| AnkiConnect | http://127.0.0.1:8765 | Update the most recently added note |
| tmbl-helper.py | http://127.0.0.1:7332 | AVIF/JXL image encoding |

The helper is retained as-is. AVIF requires FFmpeg with libaom-av1; JPEG XL requires cjxl or FFmpeg with libjxl. WebP uses the browser encoder.

For AnkiConnect, allow requests from the reader's origin in AnkiConnect's CORS settings. Use the same OwOCR launch configurations as before:

    owocr -r websocket -w websocket -of json -wp 7331
    owocr -r websocket -w websocket -of text -wp 7441

## Reading features

- Load image files, folders, ZIP/CBZ archives, and EPUB books.
- Single-page, dual-page, and continuous-scroll reading; Japanese right-to-left or left-to-right order.
- Automatic publisher-combined page detection, page progress, page focus, zoom, drag panning, and fullscreen.
- OwOCR overlay with selectable text regions for Yomitan, hover/always display, grouping, geometry options, and second-pass MangaOCR.
- Configurable OCR look-ahead cache and automatic OCR.
- AnkiConnect export of the current page or spread, optional image resizing, sentence/misc fields, tags, NSFW tag, and deterministic media reuse.
- WebP, AVIF, and JXL export.
- Texthooker capture, edit, clear, copy, import/export, reverse order, alignment, and font controls.
- Saved settings, JSON import/export, reset, and offline caching.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| A / D or Left / Right | Previous / next (respects Japanese reading order) |
| Shift + A / D | Step one source image in dual-page mode |
| W / S or Up / Down | Scroll vertically in single/scroll mode |
| Z / X | Zoom in / out |
| Shift + Z / X | Smaller zoom step |
| G | Toggle dual-page mode |
| V | Toggle continuous-scroll mode |
| Q | Toggle OCR |
| Shift + Q | Force OCR again |
| Ctrl + Q | Toggle automatic OCR |
| B | Cycle OCR display mode |
| C | Open texthooker |
| E | Open Anki export |
| O | Open options |
| F | Toggle fullscreen |
| Space | Next page |

## GitHub Pages

The build check runs automatically on every push to main. Deployment is kept as a separate manual workflow so the repository can be built and checked even before Pages has been enabled.

To publish:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**.
3. Open **Actions → Deploy GitHub Pages** and select **Run workflow**.

The deployment workflow publishes the Vite dist/ output. Vite uses the repository subpath /jamr-tmbl-pryk/ when running in GitHub Actions.

GitHub Pages is currently not enabled for this repository. Its initial activation must be done in repository Settings. The configure-pages action's automated enablement requires a separate token with repository administration/Pages permissions, not the workflow's built-in GITHUB_TOKEN.
