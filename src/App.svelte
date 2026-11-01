<script lang="ts">
  import { onMount } from "svelte";
  import { ReaderController } from "./lib/controller";

  let appRoot: HTMLElement;
  let controller: ReaderController | null = null;

  onMount(() => {
    controller = new ReaderController(appRoot);
    return () => {
      controller?.destroy();
      controller = null;
    };
  });
</script>

<main class="app-shell" bind:this={appRoot}>
  <div id="fileOverlay" class="file-overlay">
    <section class="file-panel" aria-label="Open manga">
      <div class="brand-mark" aria-hidden="true">冊</div>
      <h1 class="file-title">Tumbal Proyek</h1>
      <p class="file-subtitle">A focused reader for manga, OCR, Yomitan and Anki.</p>
      <div id="fileProtocolNotice" class="file-protocol-notice">
        This app needs to run from a local web server or HTTPS. Start it with npm run dev.
      </div>
      <input id="fileInput" class="file-input-hidden" type="file" accept=".zip,.cbz,.epub,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif,.jxl" multiple />
      <input id="folderInput" class="file-input-hidden" type="file" webkitdirectory multiple />
      <div id="dropZone" class="drop-zone" role="button" tabindex="0">
        <div class="drop-zone-icon" aria-hidden="true">▧</div>
        <div class="drop-zone-title">Drop manga files, archives, or a folder</div>
        <div class="drop-zone-formats">ZIP / CBZ / EPUB · JPG / PNG / WEBP / GIF / BMP / AVIF / JXL</div>
      </div>
      <div class="btn-row open-actions">
        <button id="btnSelectFile" class="btn btn-primary" type="button">Select files</button>
        <button id="btnSelectFolder" class="btn" type="button">Select folder</button>
        <button id="btnOpenOptions" class="btn btn-icon" type="button" title="Options" aria-label="Options">⚙</button>
      </div>
      <p class="file-footnote">Your files stay in your browser. No upload or account required.</p>
    </section>
  </div>

  <section id="viewport" class="reader-viewport" aria-label="Manga reader">
    <div id="imageFrame" class="image-frame"></div>
    <canvas id="workCanvas" class="work-canvas"></canvas>
    <div id="pageIndicator" class="indicator indicator-pages"><span id="pageText">0/0</span></div>
    <div id="zoomIndicator" class="indicator indicator-zoom"><span id="zoomText">100%</span></div>
    <div id="ocrStatus" class="ocr-status" role="status" aria-live="polite"></div>
    <div id="keyhint" class="keyhint">
      A/D page · W/S scroll · Z/X zoom · G dual · V scroll · Q OCR · B display · C text · E Anki · O options · F fullscreen
    </div>

    <nav id="sidebar" class="sidebar" aria-label="Reader controls">
      <div class="sidebar-section-title">Navigation</div>
      <button id="btnPrev" class="sidebar-btn" type="button"><span class="sidebar-icon">◀</span><span class="label">Previous (A)</span></button>
      <button id="btnNext" class="sidebar-btn" type="button"><span class="sidebar-icon">▶</span><span class="label">Next (D)</span></button>
      <button id="btnForwardOne" class="sidebar-btn" type="button"><span class="sidebar-icon">↪</span><span class="label">Step +1</span></button>
      <button id="btnBackOne" class="sidebar-btn" type="button"><span class="sidebar-icon">↩</span><span class="label">Step -1</span></button>
      <div class="sidebar-divider"></div>
      <div class="sidebar-section-title">View</div>
      <button id="btnDual" class="sidebar-btn selected" type="button"><span class="sidebar-icon">▣</span><span class="label">Dual page (G)</span></button>
      <button id="btnScroll" class="sidebar-btn" type="button"><span class="sidebar-icon">☷</span><span class="label">Scroll mode (V)</span></button>
      <button id="btnFullscreen" class="sidebar-btn" type="button"><span class="sidebar-icon">⛶</span><span class="label">Fullscreen (F)</span></button>
      <div class="sidebar-divider"></div>
      <div class="sidebar-section-title">Tools</div>
      <button id="btnOcr" class="sidebar-btn" type="button"><span class="sidebar-icon">⌕</span><span class="label">OCR current (Q)</span></button>
      <button id="btnAnki" class="sidebar-btn" type="button"><span class="sidebar-icon">▣</span><span class="label">Anki (E)</span></button>
      <button id="btnTexthooker" class="sidebar-btn" type="button"><span class="sidebar-icon">文</span><span class="label">Texthooker (C)</span></button>
      <button id="btnOptions" class="sidebar-btn" type="button"><span class="sidebar-icon">⚙</span><span class="label">Options (O)</span></button>
    </nav>

    <section id="optionsModal" class="modal-overlay" aria-label="Reader options">
      <div class="modal-panel">
        <header class="modal-header">
          <div class="modal-title"><span>⚙</span> Options</div>
          <p class="modal-subtitle">Tune the reader and its local integrations.</p>
        </header>
        <div class="tabs-bar" role="tablist">
          <button class="tab-btn selected" data-tab="reader" type="button">Reader</button>
          <button class="tab-btn" data-tab="ocr" type="button">OCR</button>
          <button class="tab-btn" data-tab="anki" type="button">Anki</button>
          <button class="tab-btn" data-tab="texthooker" type="button">Texthooker</button>
          <button class="tab-btn" data-tab="advanced" type="button">Advanced</button>
        </div>
        <div class="modal-body">
          <section id="tabReader" class="tab-body selected">
            <div class="opt-section">
              <div class="opt-section-title">Reading</div>
              <div class="opt-row"><span class="opt-label">Japanese mode (RTL)</span><label class="toggle-switch"><input id="optJapaneseMode" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Show page progress</span><label class="toggle-switch"><input id="optShowProgress" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Cover as single page</span><label class="toggle-switch"><input id="optCoverSingle" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Snap double page</span><label class="toggle-switch"><input id="optSnapDouble" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Publisher-combined page detection</span><label class="toggle-switch"><input id="optPublisherCombinedDetect" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <p class="opt-hint">Detects unusually large publisher spreads and keeps them as single pages in dual-page mode.</p>
              <div class="opt-row"><span class="opt-label">Floaty mode (left-drag pan)</span><label class="toggle-switch"><input id="optFloatyMode" type="checkbox" /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><label class="opt-label" for="optPageFocus">New page focus</label><select id="optPageFocus" class="opt-input opt-select"><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option><option value="preserve">Preserve focus</option></select></div>
              <p class="opt-hint">Choose where a newly opened image starts vertically in single-page mode.</p>
            </div>
            <div class="opt-section">
              <div class="opt-section-title">Zoom</div>
              <div class="opt-row"><label class="opt-label" for="optZoomLevel">Default zoom</label><span id="optZoomValue">175%</span></div>
              <input id="optZoomLevel" class="opt-range" type="range" min="50" max="250" step="5" value="175" />
            </div>
          </section>

          <section id="tabOcr" class="tab-body">
            <div class="opt-section">
              <div class="opt-section-title">OwOCR connection</div>
              <div class="opt-row"><label class="opt-label" for="optOcrUrl">WebSocket URL</label><input id="optOcrUrl" class="opt-input opt-wide" value="ws://127.0.0.1:7331" /></div>
              <div class="opt-row"><span class="opt-label">Auto OCR on page load</span><label class="toggle-switch"><input id="optAutoOcr" type="checkbox" /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Remember OCR between pages</span><label class="toggle-switch"><input id="optCacheOcr" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><label class="opt-label" for="optOcrPreloadImages">Auto OCR preload images</label><input id="optOcrPreloadImages" class="opt-input opt-number" type="number" min="0" max="20" step="1" value="3" /></div>
              <p class="opt-hint">Preload count is measured in source images, not displayed pages.</p>
              <div class="opt-row"><label class="opt-label" for="optOcrTwoPass">Two-pass OCR</label><select id="optOcrTwoPass" class="opt-input opt-wide"><option value="off">Off</option><option value="owocr">Two-pass OCR (OwOCR → OwOCR)</option><option value="mangaocr">Two-pass MangaOCR (OwOCR → 7441)</option></select></div>
              <div class="opt-row"><label class="opt-label" for="optMangaOcrUrl">MangaOCR WebSocket URL</label><input id="optMangaOcrUrl" class="opt-input opt-wide" value="ws://127.0.0.1:7441" /></div>
              <p class="opt-hint copy-command" data-copy="owocr -r websocket -w websocket -of json -wp 7331" title="Click to copy">Copy: owocr -r websocket -w websocket -of json -wp 7331</p>
              <p class="opt-hint copy-command" data-copy="owocr -r websocket -w websocket -of text -wp 7441" title="Click to copy">Copy: owocr -r websocket -w websocket -of text -wp 7441</p>
            </div>
            <div class="opt-section">
              <div class="opt-section-title">Overlay</div>
              <div class="opt-row"><span class="opt-label">Display mode</span><span id="optOcrDisplayValue">Hover</span></div>
              <input id="optOcrDisplay" class="opt-range" type="range" min="0" max="2" step="1" value="1" />
              <div class="slider-labels"><span>Hidden</span><span>Hover</span><span>Always</span></div>
              <div class="opt-row"><label class="opt-label" for="optOcrBackground">Overlay background</label><select id="optOcrBackground" class="opt-input opt-select"><option value="transparent">Transparent</option><option value="black">Solid black</option><option value="white">Solid white</option></select></div>
              <div class="opt-row"><span class="opt-label">Group nearby OCR lines</span><label class="toggle-switch"><input id="optOcrGroupLines" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Line grouping distance</span><span id="optOcrGroupGapValue">2%</span></div>
              <input id="optOcrGroupGap" class="opt-range" type="range" min="0.5" max="6" step="0.5" value="2" />
              <div class="opt-row"><span class="opt-label">Debug bounding boxes</span><label class="toggle-switch"><input id="optOcrDebug" type="checkbox" /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Use rotation from OwOCR</span><label class="toggle-switch"><input id="optOcrRotation" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><label class="opt-label" for="optOcrGeometry">Geometry</label><select id="optOcrGeometry" class="opt-input opt-select"><option value="auto">Auto (line → paragraph)</option><option value="paragraph">Paragraph</option><option value="line">Line</option><option value="word">Word</option></select></div>
              <div class="opt-row"><label class="opt-label" for="optOcrFontFamily">OCR font</label><input id="optOcrFontFamily" class="opt-input opt-wide" value="BIZ UDGothic" /></div>
              <p class="opt-hint">Enter a font installed on your PC. The overlay falls back to Japanese sans-serif fonts.</p>
              <div class="opt-row"><span class="opt-label">Font scale</span><span id="optOcrScaleValue">100%</span></div>
              <input id="optOcrScale" class="opt-range" type="range" min="60" max="140" step="5" value="100" />
              <div class="opt-row"><label class="opt-label" for="optOcrMaxFont">Maximum font size</label><input id="optOcrMaxFont" class="opt-input opt-number" type="number" min="12" max="96" value="54" /></div>
            </div>
          </section>

          <section id="tabAnki" class="tab-body">
            <div class="opt-section">
              <div class="opt-section-title">Defaults</div>
              <div class="opt-row"><label class="opt-label" for="optAnkiField">Picture field</label><input id="optAnkiField" class="opt-input opt-field" value="Picture" /></div>
              <div class="opt-row"><label class="opt-label" for="optAnkiMiscField">Misc field</label><input id="optAnkiMiscField" class="opt-input opt-field" value="MiscInfo" /></div>
              <div class="opt-row"><label class="opt-label" for="optAnkiSentenceField">Sentence field</label><input id="optAnkiSentenceField" class="opt-input opt-field" value="" /></div>
              <div class="opt-row"><span class="opt-label">Update sentence from OCR</span><label class="toggle-switch"><input id="optAnkiSentenceEnabled" type="checkbox" /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><label class="opt-label" for="optAnkiTagType">Tag</label><select id="optAnkiTagType" class="opt-input opt-field"><option value="doujinshi">doujinshi</option><option value="同人誌">同人誌</option><option value="manga">manga</option><option value="漫画">漫画</option><option value="__custom__">Custom</option></select></div>
              <div class="opt-row"><label class="opt-label" for="optAnkiTagCustom">Custom tag</label><input id="optAnkiTagCustom" class="opt-input opt-field" placeholder="Custom tag" /></div>
              <div class="opt-row"><span class="opt-label">Enable tag</span><label class="toggle-switch"><input id="optAnkiTagEnabled" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Resize image</span><label class="toggle-switch"><input id="optAnkiResize" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Mark as NSFW</span><label class="toggle-switch"><input id="optNsfwTag" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Update misc info</span><label class="toggle-switch"><input id="optInfoField" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><span class="opt-label">Combine dual pages</span><label class="toggle-switch"><input id="optCombineDual" type="checkbox" checked /><span class="toggle-slider"></span></label></div>
              <div class="opt-row"><label class="opt-label" for="optAnkiFormat">Anki image format</label><select id="optAnkiFormat" class="opt-input opt-wide"><option value="webp">WebP (browser encoder)</option><option value="avif">AVIF (FFmpeg)</option><option value="jxl">JPEG XL (JXL)</option></select></div>
              <p class="opt-hint">WebP uses Chrome's built-in encoder. AVIF and JXL use tmbl-helper.py at 127.0.0.1:7332.</p>
            </div>
            <div class="opt-section">
              <div class="opt-section-title">Quality</div>
              <div class="opt-row"><label class="opt-label" for="optWebpQuality">WebP quality</label><input id="optWebpQuality" class="opt-input opt-number" type="number" min="1" max="100" value="80" /></div>
              <div class="opt-row"><label class="opt-label" for="optAvifCrf">AVIF CRF</label><input id="optAvifCrf" class="opt-input opt-number" type="number" min="1" max="63" value="42" /></div>
              <div class="opt-row"><label class="opt-label" for="optAvifSpeed">AVIF CPU-used</label><input id="optAvifSpeed" class="opt-input opt-number" type="number" min="0" max="8" value="4" /></div>
              <div class="opt-row"><label class="opt-label" for="optJxlQuality">JXL quality</label><input id="optJxlQuality" class="opt-input opt-number" type="number" min="1" max="100" value="90" /></div>
              <div class="opt-row"><label class="opt-label" for="optJxlEffort">JXL effort</label><input id="optJxlEffort" class="opt-input opt-number" type="number" min="1" max="9" value="7" /></div>
              <p class="opt-hint">AVIF lower CRF produces higher quality and larger files. CPU-used 0 is slowest and 8 is fastest. JXL effort 1 is faster and 9 spends more time compressing.</p>
            </div>
          </section>

          <section id="tabTexthooker" class="tab-body">
            <div class="opt-section">
              <div class="opt-section-title">Connection</div>
              <div class="opt-row"><label class="opt-label" for="optTxWsUrl">WebSocket URL</label><input id="optTxWsUrl" class="opt-input opt-wide" value="ws://127.0.0.1:6677" /></div>
            </div>
            <div class="opt-section">
              <div class="opt-section-title">Display</div>
              <div class="opt-row"><label class="opt-label" for="optTxFontSize">Font size</label><input id="optTxFontSize" class="opt-input opt-number" type="number" min="8" max="72" value="50" /></div>
              <div class="opt-row"><label class="opt-label" for="optTxAlign">Text align</label><select id="optTxAlign" class="opt-input opt-select"><option value="center">Center</option><option value="left">Left</option><option value="right">Right</option></select></div>
              <div class="opt-row"><label class="opt-label" for="optTxFontFamily">Font</label><input id="optTxFontFamily" class="opt-input opt-wide" value="BIZ UDGothic" /></div>
              <p class="opt-hint">Enter a font installed on your PC. Japanese sans-serif fonts are used as fallbacks.</p>
            </div>
          </section>

          <section id="tabAdvanced" class="tab-body">
            <div class="opt-section">
              <div class="opt-section-title">Settings</div>
              <div class="opt-row"><span class="opt-label">Import / export settings</span><div class="btn-row compact-row"><button id="btnExportSettings" class="btn" type="button">Export JSON</button><button id="btnImportSettings" class="btn" type="button">Import JSON</button><input id="settingsImportFile" class="file-input-hidden" type="file" accept=".json" /></div></div>
              <p class="opt-hint">Importing settings replaces saved values. Newer settings keys keep their defaults.</p>
            </div>
            <div class="opt-section">
              <div class="opt-section-title">Offline and portable copy</div>
              <div class="opt-row"><span class="opt-label">Offline cache</span><button id="btnOfflineCache" class="btn btn-primary" type="button">Enable / refresh cache</button></div>
              <p id="offlineCacheStatus" class="opt-hint">Checking offline cache…</p>
              <p class="opt-hint">The service worker caches the built application shell and static assets for offline navigation after the app has been opened online.</p>
              <div class="opt-row"><span class="opt-label">Download current app and settings</span><button id="btnDownloadConfiguredIndex" class="btn" type="button">Download configured app (.zip)</button></div>
              <p class="opt-hint">Packages the hosted app assets with a copy of your current settings.</p>
            </div>
            <div class="opt-section">
              <div class="opt-section-title">Reset</div>
              <div class="opt-row"><span class="opt-label">Reset all reader settings</span><button id="btnResetSettings" class="btn btn-danger" type="button">Reset to defaults</button></div>
            </div>
          </section>

          <footer class="modal-actions">
            <button id="btnCloseOptions" class="btn" type="button">Close</button>
            <button id="btnSaveOptions" class="btn btn-primary" type="button">Apply changes</button>
          </footer>
        </div>
      </div>
    </section>

    <div id="ankiJobStatus" class="anki-job-status" role="status" aria-live="polite"></div>
    <section id="ankiModal" class="modal-overlay" aria-label="Update Anki card">
      <div class="modal-panel anki-panel">
        <header class="modal-header">
          <div class="modal-title">▣ Update Anki card</div>
          <p class="modal-subtitle">The most recently added note is captured before encoding starts.</p>
        </header>
        <div class="modal-body">
          <div id="ankiPreview" class="anki-preview"></div>
          <div class="btn-row anki-submit"><button id="btnUpdateAnki" class="btn btn-primary" type="button">Update card</button></div>
          <div class="anki-toggles">
            <div class="anki-toggle-item"><label class="opt-label" for="ankiFieldInput">Picture field</label><input id="ankiFieldInput" class="opt-input opt-field" /></div>
            <div class="anki-toggle-item"><label class="opt-label" for="ankiMiscFieldInput">Misc field</label><input id="ankiMiscFieldInput" class="opt-input opt-field" /></div>
            <div class="anki-toggle-item anki-sentence-row"><label class="opt-label" for="ankiSentenceInput">Sentence</label><textarea id="ankiSentenceInput" class="opt-input" rows="3"></textarea></div>
            <div class="anki-toggle-item"><label class="opt-label" for="ankiTagTypeInput">Tag</label><select id="ankiTagTypeInput" class="opt-input opt-field"><option value="doujinshi">doujinshi</option><option value="同人誌">同人誌</option><option value="manga">manga</option><option value="漫画">漫画</option><option value="__custom__">Custom</option></select></div>
            <div class="anki-toggle-item"><label class="opt-label" for="ankiTagCustomInput">Custom tag</label><input id="ankiTagCustomInput" class="opt-input opt-field" /></div>
            <div class="anki-toggle-item"><span class="opt-label">Enable tag</span><label class="toggle-switch"><input id="ankiTagEnabledInput" type="checkbox" /><span class="toggle-slider"></span></label></div>
            <div class="anki-toggle-item"><span class="opt-label">Resize image</span><label class="toggle-switch"><input id="ankiResizeInput" type="checkbox" /><span class="toggle-slider"></span></label></div>
            <div class="anki-toggle-item"><span class="opt-label">Mark as NSFW</span><label class="toggle-switch"><input id="ankiNsfwInput" type="checkbox" /><span class="toggle-slider"></span></label></div>
          </div>
          <p id="ankiMiscContent" class="anki-info"></p>
          <p id="ankiError" class="anki-error"></p>
          <div class="btn-row"><button id="btnCloseAnki" class="btn" type="button">Cancel</button></div>
        </div>
      </div>
    </section>

    <section id="txOverlay" class="tx-overlay" aria-label="Texthooker">
      <header class="tx-header">
        <div class="tx-top-row">
          <div class="tx-title"><span class="tx-mark">文</span><span>Texthooker</span><span id="txStatus" class="tx-status" title="Connection status"></span></div>
          <div class="tx-view-controls">
            <input id="txFontSize" class="opt-input tx-font-size" type="number" min="8" max="72" value="50" aria-label="Texthooker font size" />
            <button id="txAlignBtn" class="tx-btn" type="button" title="Toggle alignment">☷</button>
            <button id="txReverseBtn" class="tx-btn" type="button" title="Reverse line order">↕</button>
          </div>
        </div>
        <div class="tx-controls">
          <button id="txEdit" class="tx-btn" type="button">Edit</button>
          <button id="txClear" class="tx-btn" type="button">Clear</button>
          <button id="txCopy" class="tx-btn" type="button">Copy</button>
          <button id="txExport" class="tx-btn" type="button">Export</button>
          <button id="txImport" class="tx-btn" type="button">Import</button>
          <input id="txImportFile" class="file-input-hidden" type="file" accept=".json" />
          <button id="txReconnect" class="tx-btn" type="button">Reconnect</button>
          <button id="txClose" class="tx-btn tx-close" type="button">Close</button>
        </div>
      </header>
      <div class="tx-body"><div id="txContent" class="tx-content" contenteditable="false" spellcheck="false"></div></div>
    </section>
  </section>
</main>
