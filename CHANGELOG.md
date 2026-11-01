# Changelog

## v58 — Modular Svelte + TypeScript rewrite

- Replaced the single-file HTML application with a Vite + Svelte + TypeScript project.
- Split settings, media/archive handling, reader navigation/rendering, OCR, AnkiConnect, texthooker, and app orchestration into dedicated modules.
- Kept the existing browser storage keys and migrated legacy Anki AVIF settings.
- Preserved the existing OwOCR JSON endpoint (7331), MangaOCR text endpoint (7441), texthooker endpoint (6677), AnkiConnect endpoint (8765), and AVIF/JXL helper endpoint (7332).
- Kept the local tmbl-helper.py implementation and HTTP contract unchanged.
- Moved the service worker to public/sw.js so Vite copies it to the hosted app root; it now caches built app assets as well as the navigation shell.
- Added package scripts for development, type checking, production builds, and preview.
- Added a GitHub Pages Actions workflow.
- Multi-file Vite builds require a local web server or hosted origin; direct file:// launch is no longer supported by this architecture.

### Preserved feature set

Folder/file drag-and-drop and selection; ZIP/CBZ/EPUB loading and EPUB spine ordering; natural image sorting; publisher-combined page detection; Japanese RTL/LTR; single, dual, and vertical-scroll modes; zoom, panning, page focus, fullscreen, navigation shortcuts; OwOCR and two-pass OwOCR/MangaOCR; OCR grouping, overlay modes, selectable text regions, copy actions and result caching/preloading; AnkiConnect note updates, deterministic media names and WebP/AVIF/JXL image export; texthooker WebSocket, history, edit/copy/import/export/reverse/align; persistent settings, settings import/export/reset; offline caching and configured app download.
