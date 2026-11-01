import JSZip from "jszip";
import { SettingsStore, DEFAULT_SETTINGS, type AppSettings } from "./settings";
import { MediaLibrary, ARCHIVE_RE, IMAGE_RE, tagFile } from "./media";
import { PageNavigation, ReaderRenderer } from "./reader";
import { OcrManager, OCR_LABELS } from "./ocr";
import { AnkiConnector } from "./anki";
import { Texthooker } from "./texthooker";

type FormKind = "b" | "s" | "i" | "n";
type FormEntry = [keyof AppSettings, string, FormKind];

const FORM_MAP: FormEntry[] = [
  ["japaneseMode", "optJapaneseMode", "b"], ["showProgress", "optShowProgress", "b"],
  ["coverSingle", "optCoverSingle", "b"], ["snapDouble", "optSnapDouble", "b"],
  ["publisherCombinedDetect", "optPublisherCombinedDetect", "b"], ["floatyMode", "optFloatyMode", "b"],
  ["pageFocus", "optPageFocus", "s"], ["zoomLevel", "optZoomLevel", "i"],
  ["ankiField", "optAnkiField", "s"], ["ankiMiscField", "optAnkiMiscField", "s"],
  ["ankiSentenceField", "optAnkiSentenceField", "s"], ["ankiSentenceEnabled", "optAnkiSentenceEnabled", "b"],
  ["ankiTagType", "optAnkiTagType", "s"], ["ankiTagCustom", "optAnkiTagCustom", "s"],
  ["ankiTagEnabled", "optAnkiTagEnabled", "b"], ["ankiResize", "optAnkiResize", "b"],
  ["nsfwTag", "optNsfwTag", "b"], ["infoField", "optInfoField", "b"], ["combineDual", "optCombineDual", "b"],
  ["ankiFormat", "optAnkiFormat", "s"], ["webpQuality", "optWebpQuality", "i"],
  ["avifCrf", "optAvifCrf", "i"], ["avifSpeed", "optAvifSpeed", "i"],
  ["jxlQuality", "optJxlQuality", "i"], ["jxlEffort", "optJxlEffort", "i"],
  ["ocrUrl", "optOcrUrl", "s"], ["ocrFontFamily", "optOcrFontFamily", "s"],
  ["mangaOcrUrl", "optMangaOcrUrl", "s"], ["ocrTwoPass", "optOcrTwoPass", "s"],
  ["autoOcr", "optAutoOcr", "b"], ["cacheOcr", "optCacheOcr", "b"],
  ["ocrPreloadImages", "optOcrPreloadImages", "i"], ["ocrDisplay", "optOcrDisplay", "i"],
  ["ocrDebug", "optOcrDebug", "b"], ["ocrBackground", "optOcrBackground", "s"],
  ["ocrGroupLines", "optOcrGroupLines", "b"], ["ocrGroupGap", "optOcrGroupGap", "n"],
  ["ocrRotation", "optOcrRotation", "b"], ["ocrGeometry", "optOcrGeometry", "s"],
  ["ocrScale", "optOcrScale", "i"], ["ocrMaxFont", "optOcrMaxFont", "i"],
  ["txWsUrl", "optTxWsUrl", "s"], ["txFontSize", "optTxFontSize", "i"],
  ["txAlign", "optTxAlign", "s"], ["txFontFamily", "optTxFontFamily", "s"]
];

const ANKI_INPUTS: Array<[keyof AppSettings, string, "s" | "b"]> = [
  ["ankiField", "ankiFieldInput", "s"], ["ankiMiscField", "ankiMiscFieldInput", "s"],
  ["ankiTagType", "ankiTagTypeInput", "s"], ["ankiTagCustom", "ankiTagCustomInput", "s"],
  ["ankiTagEnabled", "ankiTagEnabledInput", "b"], ["ankiResize", "ankiResizeInput", "b"],
  ["nsfwTag", "ankiNsfwInput", "b"]
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

class DropHandler {
  private depth = 0;
  constructor(
    private target: HTMLElement,
    private onFiles: (files: File[]) => void,
    private onFail: () => void,
    private visual: HTMLElement = target
  ) {
    target.addEventListener("dragenter", this.dragEnter);
    target.addEventListener("dragover", this.stop);
    target.addEventListener("dragleave", this.dragLeave);
    target.addEventListener("drop", this.drop);
  }

  private stop = (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); };
  private dragEnter = (event: DragEvent) => {
    this.stop(event); this.depth++; this.visual.classList.add("drag-active");
  };
  private dragLeave = (event: DragEvent) => {
    this.stop(event); this.depth--;
    if (this.depth <= 0) { this.depth = 0; this.visual.classList.remove("drag-active"); }
  };
  private drop = (event: DragEvent) => {
    this.stop(event); this.depth = 0; this.visual.classList.remove("drag-active");
    if (event.dataTransfer) void this.collect(event.dataTransfer);
  };

  private async collect(transfer: DataTransfer): Promise<void> {
    const output: File[] = [];
    if (transfer.files?.length) {
      for (const file of Array.from(transfer.files)) {
        if (IMAGE_RE.test(file.name) || ARCHIVE_RE.test(file.name)) output.push(file);
      }
    }
    const directories: any[] = [];
    for (const item of Array.from(transfer.items || [])) {
      if (item.kind !== "file") continue;
      try {
        const entry = (item as any).webkitGetAsEntry?.();
        if (entry?.isDirectory) directories.push(entry);
      } catch { /* Browser does not expose directory entries. */ }
    }
    for (const directory of directories) {
      const found: File[] = [];
      await this.walk(directory, directory.name + "/", found);
      output.push(...found);
    }
    if (output.length) this.onFiles(output);
    else if (directories.length) this.onFail();
    else ReaderController.toast("No supported files found");
  }

  private async walk(directory: any, base: string, output: File[]): Promise<void> {
    let entries: any[];
    try { entries = await this.read(directory.createReader()); } catch { return; }
    for (const entry of entries) {
      const path = base + entry.name;
      if (entry.isFile) {
        const file = await new Promise<File | null>((resolve) => entry.file(
          (value: File) => resolve(value), () => resolve(null)
        ));
        if (file && IMAGE_RE.test(file.name)) output.push(tagFile(file, path));
      } else if (entry.isDirectory) {
        await this.walk(entry, path + "/", output);
      }
    }
  }

  private read(reader: any): Promise<any[]> {
    return new Promise((resolve) => {
      const all: any[] = [];
      const next = () => reader.readEntries((batch: any[]) => {
        if (batch.length) { all.push(...batch); next(); }
        else resolve(all);
      }, () => resolve(all));
      next();
    });
  }

  destroy(): void {
    this.target.removeEventListener("dragenter", this.dragEnter);
    this.target.removeEventListener("dragover", this.stop);
    this.target.removeEventListener("dragleave", this.dragLeave);
    this.target.removeEventListener("drop", this.drop);
  }
}

export class ReaderController {
  readonly settings = new SettingsStore();
  readonly library = new MediaLibrary();
  readonly navigation = new PageNavigation(this.settings, this.library);
  readonly renderer: ReaderRenderer;
  readonly ocr: OcrManager;
  readonly anki: AnkiConnector;
  readonly texthooker: Texthooker;

  private _dualEntryIndex: number | null = null;
  private _ankiJobSequence = 0;
  private resizeTimer = 0;
  private drag = { active: false, x: 0, y: 0 };
  private dropHandler: DropHandler;
  private destroyed = false;

  private onKeyDown = (event: KeyboardEvent) => this.handleKey(event);
  private onOcrStatus = (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const status = this.$<HTMLDivElement>("ocrStatus");
    status.className = "ocr-status show " + detail.type;
    status.textContent = detail.message || "";
    if (detail.type !== "loading") window.setTimeout(() => status.classList.remove("show"), 1800);
  };
  private onToast = (event: Event) => ReaderController.toast(String((event as CustomEvent).detail || ""));
  private onFullscreenChange = () => this.syncFullscreen();

  constructor(private root: HTMLElement) {
    this.renderer = new ReaderRenderer(this.$("imageFrame"), this.$("workCanvas"), this.settings);
    this.ocr = new OcrManager(this.$("imageFrame"), this.settings, this.library, this.navigation);
    this.anki = new AnkiConnector(this.renderer, this.settings);
    this.texthooker = new Texthooker(
      this.$("txContent"), this.$("txStatus"), this.$("txReverseBtn"), this.$("txAlignBtn"), this.settings
    );
    this.dropHandler = new DropHandler(
      this.$("fileOverlay"),
      (files) => { ReaderController.toast("Loading " + files.length + " item" + (files.length === 1 ? "" : "s") + "…"); void this.load(files); },
      () => this.$<HTMLInputElement>("folderInput").click(),
      this.$("dropZone")
    );
    this.renderer.onRendered = () => this.onRendered();
    this.bindAll();
    this.syncUI();
    this.refreshOfflineStatus();
    if (location.protocol === "file:") this.$("fileProtocolNotice").style.display = "block";
  }

  private $<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = this.root.querySelector<T>("#" + id);
    if (!element) throw new Error("Missing app element #" + id);
    return element;
  }

  static toast(message: string, duration = 1800): void {
    if (!message) return;
    const element = document.createElement("div");
    element.className = "toast-message";
    element.textContent = message;
    document.body.appendChild(element);
    window.setTimeout(() => element.remove(), duration);
  }

  private bindAll(): void {
    const on = (id: string, type: string, callback: EventListener) => this.$(id).addEventListener(type, callback);
    on("dropZone", "click", () => this.$<HTMLInputElement>("fileInput").click());
    on("btnSelectFile", "click", () => this.$<HTMLInputElement>("fileInput").click());
    on("btnSelectFolder", "click", () => this.$<HTMLInputElement>("folderInput").click());
    on("btnOpenOptions", "click", () => this.show("optionsModal"));
    on("fileInput", "change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.files) void this.load(Array.from(input.files));
      input.value = "";
    });
    on("folderInput", "change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.files) void this.load(Array.from(input.files));
      input.value = "";
    });

    on("btnPrev", "click", () => this.prev());
    on("btnNext", "click", () => this.next());
    on("btnForwardOne", "click", () => this.stepForward());
    on("btnBackOne", "click", () => this.stepBackward());
    on("btnDual", "click", () => this.toggleDual());
    on("btnScroll", "click", () => this.toggleScroll());
    on("btnFullscreen", "click", () => this.toggleFullscreen());
    on("btnOcr", "click", () => this.ocr.toggle());
    on("btnAnki", "click", () => this.openAnki());
    on("btnTexthooker", "click", () => this.$("txOverlay").classList.toggle("active"));
    on("btnOptions", "click", () => this.show("optionsModal"));

    this.root.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => {
        this.root.querySelectorAll(".tab-btn").forEach((node) => node.classList.remove("selected"));
        this.root.querySelectorAll(".tab-body").forEach((node) => node.classList.remove("selected"));
        button.classList.add("selected");
        const tab = button.dataset.tab || "";
        this.$("tab" + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add("selected");
      });
    });

    on("btnCloseOptions", "click", () => this.hide("optionsModal"));
    on("btnSaveOptions", "click", () => this.saveOptions());
    on("btnExportSettings", "click", () => this.exportSettings());
    on("btnImportSettings", "click", () => this.$<HTMLInputElement>("settingsImportFile").click());
    on("settingsImportFile", "change", (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) void this.importSettings(file);
      input.value = "";
    });
    on("btnOfflineCache", "click", () => void this.enableOfflineCache());
    on("btnDownloadConfiguredIndex", "click", () => void this.downloadConfiguredApp());
    on("btnResetSettings", "click", () => this.resetSettings());
    on("optZoomLevel", "input", () => {
      this.$("optZoomValue").textContent = this.$<HTMLInputElement>("optZoomLevel").value + "%";
    });
    on("optOcrDisplay", "input", () => {
      this.$("optOcrDisplayValue").textContent = OCR_LABELS[Number(this.$<HTMLInputElement>("optOcrDisplay").value)];
    });
    on("optOcrScale", "input", () => {
      this.$("optOcrScaleValue").textContent = this.$<HTMLInputElement>("optOcrScale").value + "%";
    });
    on("optOcrGroupGap", "input", () => {
      this.$("optOcrGroupGapValue").textContent = this.$<HTMLInputElement>("optOcrGroupGap").value + "%";
    });

    on("btnCloseAnki", "click", () => this.hide("ankiModal"));
    on("btnUpdateAnki", "click", () => void this.updateAnki());
    this.bindAnkiInputs();

    on("txEdit", "click", () => {
      this.$("txEdit").classList.toggle("selected", this.texthooker.toggleEdit());
    });
    on("txClear", "click", () => this.texthooker.clear());
    on("txCopy", "click", () => void this.texthooker.copy().catch((error) => ReaderController.toast("Copy failed: " + error.message)));
    on("txExport", "click", () => this.texthooker.export());
    on("txImport", "click", () => this.$<HTMLInputElement>("txImportFile").click());
    on("txImportFile", "change", (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) void this.texthooker.import(file);
      input.value = "";
    });
    on("txReconnect", "click", () => this.texthooker.reconnect());
    on("txClose", "click", () => {
      this.$("txOverlay").classList.remove("active");
      this.texthooker.close();
    });
    on("txReverseBtn", "click", () => this.texthooker.toggleReverse());
    on("txAlignBtn", "click", () => this.texthooker.toggleAlign());
    on("txFontSize", "input", () => {
      const value = clamp(parseInt(this.$<HTMLInputElement>("txFontSize").value, 10) || 20, 8, 72);
      this.settings.set("txFontSize", value); this.texthooker.apply();
    });

    this.root.querySelectorAll<HTMLElement>(".copy-command").forEach((element) => {
      element.addEventListener("click", () => void this.copyCommand(element));
    });
    this.$("sidebar").addEventListener("mouseenter", () => {
      if (this.library.count) this.$("keyhint").classList.add("visible");
    });
    this.$("sidebar").addEventListener("mouseleave", () => this.$("keyhint").classList.remove("visible"));
    window.addEventListener("resize", this.syncZoomIndicator);
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    window.addEventListener("reader-ocr-status", this.onOcrStatus);
    window.addEventListener("reader-toast", this.onToast);
    this.bindDrag();
  }

  private bindAnkiInputs(): void {
    for (const [key, id, type] of ANKI_INPUTS) {
      this.$(id).addEventListener(type === "b" ? "change" : "input", (event) => {
        const target = event.target as HTMLInputElement;
        (this.settings as any).set(key, type === "b" ? target.checked : target.value);
        this.syncAnkiOptions();
      });
    }
  }

  private bindDrag(): void {
    const frame = this.$("imageFrame");
    frame.addEventListener("mousedown", (event) => {
      const mouse = event as MouseEvent;
      if (mouse.button !== 0 || !this.settings.get("floatyMode") || !this.library.count) return;
      mouse.preventDefault();
      this.drag = { active: true, x: mouse.clientX, y: mouse.clientY };
    });
    window.addEventListener("mousemove", (event) => {
      if (!this.drag.active) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      this.renderer.panBy(dx, dy);
      this.drag.x = event.clientX; this.drag.y = event.clientY;
    });
    window.addEventListener("mouseup", (event) => { if (event.button === 0) this.drag.active = false; });
    window.addEventListener("blur", () => { this.drag.active = false; });
  }

  async load(files: File[]): Promise<void> {
    if (!files?.length) return;
    try {
      if (files.length === 1 && ARCHIVE_RE.test(files[0].name)) await this.library.loadArchive(files[0]);
      else await this.library.loadFiles(files);
      if (!this.library.count) throw new Error("No images found");
      this.navigation.setTotal(this.library.count);
      this.navigation.idx = 0;
      this.ocr.reset(true);
      this.$("fileOverlay").classList.add("hidden");
      document.title = this.library.title + " — Tumbal Proyek";
      this.render();
      const combined = this.library.publisherCombined.size;
      ReaderController.toast("Loaded " + this.library.title + " · " + this.library.count + " pages" +
        (combined ? " · " + combined + " publisher-combined" : ""), 2600);
    } catch (error) {
      console.error(error);
      ReaderController.toast("Error: " + (error instanceof Error ? error.message : String(error)), 3000);
    }
  }

  private render(focusRatio: number | null = null): void {
    this.ocr.reset();
    this.renderer.render(this.library, this.navigation.idx, focusRatio);
    this.indicators();
  }

  private capturePageFocus(): number | null {
    return (!this.settings.get("dualMode") && !this.settings.get("scrollMode") && this.settings.get("pageFocus") === "preserve")
      ? this.renderer.captureSingleFocus() : null;
  }

  private onRendered(): void {
    if (this.settings.get("scrollMode")) {
      const strip = this.$("imageFrame").querySelector<HTMLElement>(".scroll-strip");
      if (strip) {
        let timer = 0;
        strip.addEventListener("scroll", () => {
          window.clearTimeout(timer);
          if (this.settings.get("autoOcr")) timer = window.setTimeout(() => void this.ocr.processCurrent(), 180);
        }, { passive: true });
      }
    }
    if (this.settings.get("autoOcr")) window.setTimeout(() => void this.ocr.processCurrent(), 80);
  }

  private prev(): void {
    const focus = this.capturePageFocus();
    if (this.navigation.prev()) this.render(focus);
  }
  private next(): void {
    const focus = this.capturePageFocus();
    if (this.navigation.next()) this.render(focus);
  }
  private stepForward(): void {
    const focus = this.capturePageFocus();
    this.navigation.stepForward(); this.render(focus);
  }
  private stepBackward(): void {
    const focus = this.capturePageFocus();
    this.navigation.stepBackward(); this.render(focus);
  }

  private indicators(): void {
    const total = this.library.count, index = this.navigation.idx;
    let progress = "0/0";
    if (total) {
      if (this.settings.get("scrollMode") || !this.settings.get("dualMode")) progress = (index + 1) + "/" + total;
      else {
        const cover = this.settings.get("coverSingle") && index === 0;
        const combined = this.settings.get("publisherCombinedDetect") ? this.library.publisherCombined : new Set<number>();
        const single = cover || index === total - 1 || combined.has(index) || combined.has(index + 1);
        progress = cover ? "Cover / " + total
          : index === total - 1 ? total + "/" + total + " · End"
          : single ? (index + 1) + "/" + total + " · Single"
          : (index + 1) + "-" + Math.min(index + 2, total) + "/" + total;
      }
    }
    this.$("pageText").textContent = progress;
    this.$("pageIndicator").classList.toggle("visible", this.settings.get("showProgress"));
    this.syncZoomIndicator();
  }

  private syncZoomIndicator = (): void => {
    const zoom = this.renderer?.zoom || 1;
    this.$("zoomText").textContent = Math.round(zoom * 100) + "%";
    this.$("zoomIndicator").classList.toggle("visible", zoom !== 1);
  };

  private toggleDual(): void {
    if (this.settings.get("scrollMode")) { ReaderController.toast("Disable scroll mode first"); return; }
    const wasDual = this.settings.get("dualMode");
    if (!wasDual) {
      this._dualEntryIndex = this.navigation.idx;
      this.settings.set("dualMode", true);
      if (this.settings.get("snapDouble")) {
        const index = this.navigation.idx;
        if (this.settings.get("coverSingle")) {
          if (index > 0 && index % 2 === 0) this.navigation.idx = index - 1;
        } else if (index % 2 !== 0) this.navigation.idx = index - 1;
      }
      this.render(); this.syncUI(); ReaderController.toast("Dual Page"); return;
    }
    const entry = this._dualEntryIndex ?? this.navigation.idx;
    const current = this.navigation.idx;
    const special = this.settings.get("publisherCombinedDetect") ? this.library.publisherCombined : new Set<number>();
    const isSingle = (this.settings.get("coverSingle") && current === 0) ||
      current === this.library.count - 1 || special.has(current) || special.has(current + 1);
    this.settings.set("dualMode", false);
    let target = current;
    if (current === entry) target = entry;
    else if (current > entry) target = current;
    else target = Math.min(current + 1, this.library.count - 1);
    if (isSingle && current === this.library.count - 1) target = current;
    this.navigation.idx = clamp(target, 0, Math.max(0, this.library.count - 1));
    this._dualEntryIndex = null;
    this.render(); this.syncUI(); ReaderController.toast("Single Page");
  }

  private toggleScroll(): void {
    const enabled = !this.settings.get("scrollMode");
    this.settings.set("scrollMode", enabled);
    if (enabled) this.settings.set("dualMode", false);
    this.render(); this.syncUI();
  }

  private toggleFullscreen(): void {
    const element = this.$("viewport");
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    } else {
      void element.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);
    }
  }

  private syncFullscreen(): void {
    this.$("btnFullscreen").classList.toggle("selected", !!document.fullscreenElement);
  }

  private handleKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    const target = event.target as HTMLElement;
    const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
    if (key === "escape") {
      if (this.$("txOverlay").classList.contains("active")) { this.$("txOverlay").classList.remove("active"); return; }
      for (const id of ["optionsModal", "ankiModal"]) {
        if (this.$(id).style.display === "grid") { this.$(id).style.display = "none"; return; }
      }
      return;
    }
    if (isInput || event.altKey || event.metaKey) return;
    if (key === "q" && event.ctrlKey) {
      event.preventDefault();
      const enabled = !this.settings.get("autoOcr");
      this.settings.set("autoOcr", enabled);
      this.$<HTMLInputElement>("optAutoOcr").checked = enabled;
      ReaderController.toast(enabled ? "Auto OCR enabled" : "Auto OCR disabled"); return;
    }
    if (key === "q") {
      event.preventDefault();
      if (event.shiftKey) void this.ocr.processCurrent(true);
      else this.ocr.toggle();
      return;
    }
    if (key === "b") { event.preventDefault(); this.ocr.cycleDisplay(); return; }
    if (key === "c") { this.$("txOverlay").classList.toggle("active"); return; }
    if (key === "o") { this.show("optionsModal"); return; }
    if (key === "e") { this.openAnki(); return; }
    if (key === "f") { this.toggleFullscreen(); return; }
    if (key === "g" && !this.settings.get("scrollMode")) { this.toggleDual(); return; }
    if (key === "v") { this.toggleScroll(); return; }
    if (!this.library.count) return;
    const single = !this.settings.get("dualMode") || this.settings.get("scrollMode");
    if (single && ["w", "s", "arrowup", "arrowdown"].includes(key)) {
      const element = this.$("imageFrame").querySelector<HTMLElement>(".zoom-wrapper, .scroll-strip");
      if (element) element.scrollTop += (key === "s" || key === "arrowdown") ? 80 : -80;
      return;
    }
    if (single && !this.settings.get("scrollMode") && (key === "z" || key === "x")) {
      const step = event.shiftKey ? 0.1 : 0.25;
      let zoom = this.renderer.zoom || 1;
      zoom = clamp(zoom + (key === "z" ? step : -step), 0.5, 2.5);
      zoom = Math.round(zoom * 100) / 100;
      this.renderer.setZoom(zoom);
      this.settings.set("zoomLevel", Math.round(zoom * 100));
      this.$<HTMLInputElement>("optZoomLevel").value = String(Math.round(zoom * 100));
      this.$("optZoomValue").textContent = Math.round(zoom * 100) + "%";
      this.syncZoomIndicator(); return;
    }
    if (key === " ") { event.preventDefault(); this.next(); return; }
    if (this.settings.get("dualMode") && event.shiftKey &&
        ["a", "arrowleft", "d", "arrowright"].includes(key)) {
      event.preventDefault();
      if (key === "a" || key === "arrowleft") this.stepForward();
      else this.stepBackward();
      return;
    }
    if (key === "a" || key === "arrowleft") {
      this.settings.get("japaneseMode") ? this.next() : this.prev(); return;
    }
    if (key === "d" || key === "arrowright") {
      this.settings.get("japaneseMode") ? this.prev() : this.next(); return;
    }
  }

  private show(id: string): void { this.$(id).style.display = "grid"; }
  private hide(id: string): void { this.$(id).style.display = "none"; }

  private async copyCommand(element: HTMLElement): Promise<void> {
    const command = element.dataset.copy || element.textContent?.trim() || "";
    try { await navigator.clipboard.writeText(command); }
    catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = command; textarea.style.position = "fixed"; textarea.style.opacity = "0";
        document.body.appendChild(textarea); textarea.select(); document.execCommand("copy"); textarea.remove();
      } catch { ReaderController.toast("Copy failed", 2200); return; }
    }
    const previous = element.textContent;
    element.textContent = "Copied";
    window.setTimeout(() => { element.textContent = previous; }, 900);
  }

  private resetSettings(): void {
    const oldOcr = this.settings.get("ocrUrl"), oldManga = this.settings.get("mangaOcrUrl");
    const oldTx = this.settings.get("txWsUrl");
    this.settings.reset();
    if (oldOcr !== this.settings.get("ocrUrl")) this.ocr.client.close();
    if (oldManga !== this.settings.get("mangaOcrUrl")) this.ocr.secondClient.close();
    if (oldTx !== this.settings.get("txWsUrl")) this.texthooker.reconnect();
    this.texthooker.apply(); this.syncUI();
    if (this.library.count) this.render();
    ReaderController.toast("Settings reset to defaults", 2200);
  }

  private refreshOfflineStatus(): void {
    const status = this.$("offlineCacheStatus");
    if (location.protocol === "file:" || !window.isSecureContext ||
        !("serviceWorker" in navigator) || !("caches" in window)) {
      status.textContent = "Offline cache requires the hosted HTTPS version of the app."; return;
    }
    caches.open("jamr-tmbl-pryk-app-v2")
      .then((cache) => cache.match(new URL("./index.html", location.href).href))
      .then((cached) => { status.textContent = cached ? "Offline app shell is cached." : "Offline cache not yet saved."; })
      .catch(() => { status.textContent = "Offline cache status unavailable."; });
  }

  private exportSettings(): void {
    try {
      const blob = new Blob([JSON.stringify(this.settings.exportObject(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "jamr-tmbl-pryk-settings.json"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      ReaderController.toast("Settings exported");
    } catch (error) {
      console.error(error); ReaderController.toast("Could not export settings", 2600);
    }
  }

  private async importSettings(file: File): Promise<void> {
    try {
      const data = JSON.parse(await file.text());
      const oldOcr = this.settings.get("ocrUrl"), oldManga = this.settings.get("mangaOcrUrl");
      const oldTx = this.settings.get("txWsUrl");
      this.settings.importObject(data);
      this.syncUI();
      if (oldOcr !== this.settings.get("ocrUrl")) this.ocr.client.close();
      if (oldManga !== this.settings.get("mangaOcrUrl")) this.ocr.secondClient.close();
      if (this.ocr.has()) this.ocr.overlay.refreshModes(this.$("imageFrame"));
      if (oldTx !== this.settings.get("txWsUrl")) this.texthooker.reconnect();
      this.texthooker.apply();
      ReaderController.toast("Settings imported");
    } catch (error) {
      console.error(error);
      ReaderController.toast("Invalid settings file: " + (error instanceof Error ? error.message : String(error)), 3200);
    }
  }

  private async enableOfflineCache(): Promise<void> {
    const status = this.$("offlineCacheStatus");
    try {
      if (location.protocol === "file:" || !window.isSecureContext ||
          !("serviceWorker" in navigator) || !("caches" in window)) {
        throw new Error("Open the hosted HTTPS version to enable offline caching.");
      }
      status.textContent = "Updating the app shell…";
      const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      await registration.update().catch(() => undefined);
      const worker = registration.active || registration.waiting || registration.installing;
      if (worker) {
        worker.postMessage({ type: "CACHE_LATEST", url: new URL("./", location.href).href });
      }
      await caches.open("jamr-tmbl-pryk-app-v2").then((cache) => cache.add(new Request(new URL("./", location.href).href, { cache: "reload" })));
      status.textContent = "Offline app shell and referenced scripts/styles cached.";
      ReaderController.toast("Offline cache refreshed", 2200);
    } catch (error) {
      console.error(error);
      status.textContent = "Offline cache failed: " + (error instanceof Error ? error.message : String(error));
      ReaderController.toast("Offline cache failed", 3000);
    }
  }

  private async downloadConfiguredApp(): Promise<void> {
    try {
      const appUrl = new URL("./", location.href).href;
      const response = await fetch(appUrl + "index.html", { cache: "no-store" });
      if (!response.ok) throw new Error("App host returned HTTP " + response.status);
      let html = await response.text();
      const serialized = JSON.stringify(this.settings.d).replace(/</g, "\\u003c");
      const bootstrap = '<script>window.__JAMR_IMPORTED_SETTINGS__=' + serialized +
        ';try{localStorage.setItem("tumbal_refactor_v3",JSON.stringify(' + serialized + '))}catch{}</script>\n';
      html = html.includes("</head>") ? html.replace("</head>", bootstrap + "</head>") : bootstrap + html;
      const base = new URL(appUrl);
      html = html.replaceAll('="' + base.pathname, '="./');
      const archive = new JSZip();
      archive.file("index.html", html);
      archive.file("settings.json", JSON.stringify(this.settings.exportObject(), null, 2));
      const resourceUrls = new Set<string>();
      const resourceRegex = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
      let match: RegExpExecArray | null;
      while ((match = resourceRegex.exec(html))) {
        const source = match[1];
        if (!source || source.startsWith("data:") || source.startsWith("#")) continue;
        const url = new URL(source, appUrl);
        if (url.origin !== location.origin) continue;
        resourceUrls.add(url.href);
      }
      for (const urlString of resourceUrls) {
        const url = new URL(urlString);
        if (!url.pathname.startsWith(base.pathname)) continue;
        const archivePath = decodeURIComponent(url.pathname.slice(base.pathname.length));
        if (!archivePath || archivePath === "index.html") continue;
        const asset = await fetch(url.href, { cache: "no-store" });
        if (asset.ok) archive.file(archivePath, await asset.arrayBuffer());
      }
      const worker = await fetch(new URL("sw.js", appUrl).href, { cache: "no-store" });
      if (worker.ok) archive.file("sw.js", await worker.text());
      archive.file("RUN-APP.txt", "Serve this folder over localhost or HTTPS. For development use npm run dev in the project repository.\nThe settings.json file contains the settings used when this package was downloaded.\n");
      const blob = await archive.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl; anchor.download = "jamr-tmbl-pryk-configured.zip"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      ReaderController.toast("Configured app bundle downloaded", 2600);
    } catch (error) {
      console.error(error);
      ReaderController.toast("Could not download configured app: " + (error instanceof Error ? error.message : String(error)), 3500);
    }
  }

  private syncAnkiOptions(): void {
    const enabled = this.settings.get("ankiTagEnabled");
    const custom = this.settings.get("ankiTagType") === "__custom__";
    for (const id of ["optAnkiTagType", "ankiTagTypeInput"]) this.$<HTMLSelectElement>(id).disabled = !enabled;
    for (const id of ["optAnkiTagCustom", "ankiTagCustomInput"]) this.$<HTMLInputElement>(id).disabled = !enabled || !custom;
  }

  private syncUI(): void {
    for (const [key, id, type] of FORM_MAP) {
      const element = this.root.querySelector<HTMLInputElement | HTMLSelectElement>("#" + id);
      if (!element) continue;
      if (type === "b") (element as HTMLInputElement).checked = !!this.settings.get(key);
      else element.value = String(this.settings.get(key));
    }
    this.$("optZoomValue").textContent = this.settings.get("zoomLevel") + "%";
    this.$("optOcrDisplayValue").textContent = OCR_LABELS[this.settings.get("ocrDisplay")];
    this.$("optOcrScaleValue").textContent = this.settings.get("ocrScale") + "%";
    this.$("optOcrGroupGapValue").textContent = this.settings.get("ocrGroupGap") + "%";
    this.$<HTMLInputElement>("txFontSize").value = String(this.settings.get("txFontSize"));
    this.$("btnDual").classList.toggle("selected", this.settings.get("dualMode"));
    this.$("btnScroll").classList.toggle("selected", this.settings.get("scrollMode"));
    this.syncAnkiOptions(); this.texthooker.apply(); this.indicators();
  }

  private saveOptions(): void {
    const oldOcr = this.settings.get("ocrUrl"), oldManga = this.settings.get("mangaOcrUrl");
    const oldTx = this.settings.get("txWsUrl");
    const values: Partial<AppSettings> = {};
    for (const [key, id, type] of FORM_MAP) {
      const element = this.root.querySelector<HTMLInputElement | HTMLSelectElement>("#" + id);
      if (!element) continue;
      let value: any;
      if (type === "b") value = (element as HTMLInputElement).checked;
      else if (type === "i") {
        const number = Number(element.value);
        value = Number.isFinite(number) ? Math.trunc(number) : this.settings.get(key);
      } else if (type === "n") {
        const number = Number(element.value);
        value = Number.isFinite(number) ? number : this.settings.get(key);
      } else value = element.value;
      (values as any)[key] = value;
    }
    values.webpQuality = clamp(Number(values.webpQuality), 1, 100);
    values.ocrPreloadImages = clamp(Number(values.ocrPreloadImages), 0, 20);
    values.avifCrf = clamp(Number(values.avifCrf), 1, 63);
    values.avifSpeed = clamp(Number(values.avifSpeed), 0, 8);
    values.jxlQuality = clamp(Number(values.jxlQuality), 1, 100);
    values.jxlEffort = clamp(Number(values.jxlEffort), 1, 9);
    values.zoomLevel = clamp(Number(values.zoomLevel), 50, 250);
    values.ocrDisplay = clamp(Number(values.ocrDisplay), 0, 2);
    values.ocrScale = clamp(Number(values.ocrScale), 60, 140);
    values.ocrGroupGap = clamp(Number(values.ocrGroupGap), 0.5, 6);
    values.ocrMaxFont = clamp(Number(values.ocrMaxFont), 12, 96);
    values.txFontSize = clamp(Number(values.txFontSize), 8, 72);
    this.settings.patch(values);
    if (oldOcr !== this.settings.get("ocrUrl")) this.ocr.client.close();
    if (oldManga !== this.settings.get("mangaOcrUrl")) this.ocr.secondClient.close();
    if (this.ocr.has()) this.ocr.overlay.refreshModes(this.$("imageFrame"));
    if (oldTx !== this.settings.get("txWsUrl")) this.texthooker.reconnect();
    this.texthooker.apply(); this.hide("optionsModal"); this.syncUI();
    ReaderController.toast("Options applied");
  }

  private openAnki(): void {
    if (!this.library.count) return;
    this.show("ankiModal");
    this.$("ankiError").style.display = "none";
    for (const [key, id, type] of ANKI_INPUTS) {
      const element = this.$<HTMLInputElement | HTMLSelectElement>(id);
      if (type === "b") (element as HTMLInputElement).checked = !!this.settings.get(key);
      else element.value = String(this.settings.get(key));
    }
    this.syncAnkiOptions();
    this.$<HTMLTextAreaElement>("ankiSentenceInput").value = this.ocr.getSelectedSentence() || "";
    const preview = this.$("ankiPreview"); preview.replaceChildren();
    const index = this.navigation.idx;
    const cover = this.settings.get("coverSingle") && index === 0;
    const last = index === this.library.count - 1;
    const combined = this.settings.get("publisherCombinedDetect") &&
      (this.library.publisherCombined.has(index) || this.library.publisherCombined.has(index + 1));
    if (this.settings.get("dualMode") && !cover && !last && !combined) {
      const order = this.settings.get("japaneseMode") ? [index + 1, index] : [index, index + 1];
      for (const page of order) {
        const image = document.createElement("img"); image.src = this.library.get(page) || ""; preview.appendChild(image);
      }
    } else {
      const image = document.createElement("img"); image.src = this.library.get(index) || ""; preview.appendChild(image);
    }
    this.$("ankiMiscContent").textContent = "Source: " + this.library.title;
  }

  private async updateAnki(): Promise<void> {
    try {
      for (const [key, id, type] of ANKI_INPUTS) {
        const element = this.$<HTMLInputElement | HTMLSelectElement>(id);
        (this.settings as any).set(key, type === "b" ? (element as HTMLInputElement).checked : element.value);
      }
      const sentence = this.$<HTMLTextAreaElement>("ankiSentenceInput").value || "";
      const noteId = await this.anki.recentNote();
      if (!noteId) throw new Error("No recently added Anki note found");
      const jobId = "anki-" + Date.now() + "-" + (++this._ankiJobSequence);
      this.hide("ankiModal");
      this.showAnkiJob(jobId, "Preparing Anki card #" + noteId + "…", "loading");
      const progress = (message: string) => this.showAnkiJob(jobId, "Anki card #" + noteId + ": " + message, "loading");
      void Promise.resolve().then(() => this.anki.update(this.library, this.navigation, sentence, noteId, progress))
        .then(() => this.showAnkiJob(jobId, "Anki card #" + noteId + " updated", "success", 2600))
        .catch((error) => {
          console.error(error);
          this.showAnkiJob(jobId, "Anki card #" + noteId + " failed: " + (error?.message || error), "error", 6000);
        });
    } catch (error) {
      console.error(error);
      const jobId = "anki-" + Date.now() + "-" + (++this._ankiJobSequence);
      this.showAnkiJob(jobId, "Anki update failed: " + (error instanceof Error ? error.message : String(error)), "error", 6000);
    }
  }

  private showAnkiJob(id: string, message: string, type = "loading", hideAfter = 0): void {
    const host = this.$("ankiJobStatus");
    host.style.display = "flex";
    let item = host.querySelector<HTMLElement>('[data-job-id="' + CSS.escape(id) + '"]');
    if (!item) {
      item = document.createElement("div"); item.dataset.jobId = id; host.appendChild(item);
    }
    item.className = "anki-job-item " + type; item.textContent = message;
    const oldTimer = (item as any)._timer;
    if (oldTimer) clearTimeout(oldTimer);
    if (hideAfter) (item as any)._timer = window.setTimeout(() => {
      item?.remove();
      if (!host.children.length) host.style.display = "none";
    }, hideAfter);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dropHandler.destroy();
    this.ocr.destroy();
    this.renderer.destroy();
    this.texthooker.close();
    this.library.clear();
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    window.removeEventListener("reader-ocr-status", this.onOcrStatus);
    window.removeEventListener("reader-toast", this.onToast);
    window.removeEventListener("resize", this.syncZoomIndicator);
    window.clearTimeout(this.resizeTimer);
  }
}
