import type { SettingsStore } from "./settings";
import type { MediaLibrary } from "./media";
import type { PageNavigation } from "./reader";

export const OCR_LABELS = ["Hidden", "Hover", "Always"];
const OCR_TIMEOUT = 20_000;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type OcrBox = { center_x: number; center_y: number; width: number; height: number; rotation_z: number };
type OcrLine = { bbox: OcrBox; text: string; dir: string; index?: number };
type OcrGroup = {
  bbox: OcrBox; text: string; dir: string; kind: string; lines: OcrLine[];
  groupId?: string; _twoPassText?: string | null;
};
type OcrPayload = Record<string, any> & {
  paragraphs?: any[]; lines?: any[]; image_properties?: { width?: number; height?: number };
  _twoPassTexts?: Array<string | null>;
};

function resultPayload(value: any): OcrPayload {
  return (value?.result ?? value?.ocr_result ?? value?.data ?? value) as OcrPayload;
}

function textFromResult(value: any): string {
  const result = resultPayload(value);
  if (typeof result === "string") return result.trim();
  const paragraphs = Array.isArray(result?.paragraphs) ? result.paragraphs : [];
  const lines = paragraphs.length ? paragraphs.flatMap((p: any) => p?.lines || []) : (result?.lines || []);
  if (lines.length) return lines.map((line: any) => {
    if (typeof line?.text === "string") return line.text;
    if (Array.isArray(line?.words)) return line.words.map((word: any) => word?.text || "").join("");
    return "";
  }).filter(Boolean).join(" ").trim();
  return typeof result?.text === "string" ? result.text.trim() : "";
}

export class OwocrClient {
  private ws: WebSocket | null = null;
  private url = "";
  private queue: Promise<any> = Promise.resolve();
  private connectedPromise: Promise<void> | null = null;

  constructor(private settings: SettingsStore, private onState: (type: string, message: string) => void) {}

  close(): void {
    try { this.ws?.close(); } catch { /* Socket may already be closed. */ }
    this.ws = null; this.url = ""; this.connectedPromise = null;
  }

  async connect(silent = false): Promise<void> {
    const url = this.settings.get("ocrUrl");
    if (this.ws?.readyState === WebSocket.OPEN && this.url === url) return;
    if (this.connectedPromise) return this.connectedPromise;
    this.close();
    if (!silent) this.onState("loading", "Connecting to OwOCR at " + url + "…");
    this.connectedPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* ignore */ }
        reject(new Error("OwOCR connection timeout: " + url));
      }, 7000);
      socket.onopen = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this.ws = socket; this.url = url;
        if (!silent) this.onState("success", "OwOCR connected · click OCR text to select a sentence");
        resolve();
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        reject(new Error("Cannot connect to OwOCR at " + url));
      };
      socket.onclose = () => { if (this.ws === socket) this.ws = null; };
    }).catch((error) => { this.connectedPromise = null; throw error; });
    await this.connectedPromise;
    this.connectedPromise = null;
  }

  request(buffer: ArrayBuffer | Uint8Array, options: { silent?: boolean } = {}): Promise<OcrPayload> {
    const run = async () => { await this.connect(!!options.silent); return this.requestNow(buffer, !!options.silent); };
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private requestNow(buffer: ArrayBuffer | Uint8Array, silent: boolean): Promise<OcrPayload> {
    return new Promise((resolve, reject) => {
      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) { reject(new Error("OwOCR WebSocket is not open")); return; }
      let done = false;
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onError);
      };
      const finish = (callback: (value: any) => void, value: any) => {
        if (done) return;
        done = true; cleanup(); callback(value);
      };
      const timer = window.setTimeout(() => finish(reject, new Error("OwOCR response timeout (" + (OCR_TIMEOUT / 1000) + "s)")), OCR_TIMEOUT);
      const onClose = () => finish(reject, new Error("OwOCR WebSocket closed"));
      const onError = () => finish(reject, new Error("OwOCR WebSocket error"));
      const handleText = (text: string) => {
        if (text === "True") return;
        if (text === "False") { finish(reject, new Error("OwOCR rejected image (paused or input disabled)")); return; }
        try {
          const parsed = JSON.parse(text);
          const result = resultPayload(parsed);
          if (result && typeof result === "object" &&
              (Array.isArray(result.paragraphs) || Array.isArray(result.lines) || result.image_properties || result.engine_capabilities)) {
            finish(resolve, result);
          }
        } catch { /* Ignore non-JSON acknowledgements. */ }
      };
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data === "string") handleText(event.data);
        else if (event.data instanceof ArrayBuffer) handleText(new TextDecoder().decode(event.data));
        else if (event.data instanceof Blob) event.data.text().then(handleText).catch(() => undefined);
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onError);
      try {
        socket.send(buffer);
        if (!silent) this.onState("loading", "OwOCR image sent · waiting for OCR…");
      } catch (error) { finish(reject, error); }
    });
  }
}

export class MangaTextClient {
  private ws: WebSocket | null = null;
  private url = "";
  private queue: Promise<any> = Promise.resolve();
  private connectedPromise: Promise<void> | null = null;

  constructor(private settings: SettingsStore) {}

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null; this.url = ""; this.connectedPromise = null;
  }

  private async connect(): Promise<void> {
    const url = this.settings.get("mangaOcrUrl");
    if (this.ws?.readyState === WebSocket.OPEN && this.url === url) return;
    if (this.connectedPromise) return this.connectedPromise;
    this.close();
    this.connectedPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true; try { socket.close(); } catch { /* ignore */ }
        reject(new Error("MangaOCR WebSocket connection timeout: " + url));
      }, 7000);
      socket.onopen = () => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.ws = socket; this.url = url; resolve();
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(new Error("Cannot connect to MangaOCR OwOCR at " + url));
      };
    }).catch((error) => { this.connectedPromise = null; throw error; });
    await this.connectedPromise;
    this.connectedPromise = null;
  }

  request(buffer: ArrayBuffer | Uint8Array): Promise<string> {
    const run = async () => {
      await this.connect();
      return new Promise<string>((resolve, reject) => {
        const socket = this.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) { reject(new Error("MangaOCR WebSocket is not open")); return; }
        let done = false;
        const cleanup = () => {
          clearTimeout(timer);
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("close", onClose);
          socket.removeEventListener("error", onError);
        };
        const finish = (callback: (value: any) => void, value: any) => {
          if (done) return; done = true; cleanup(); callback(value);
        };
        const timer = window.setTimeout(() => finish(reject, new Error("MangaOCR response timeout (20s)")), OCR_TIMEOUT);
        const onClose = () => finish(reject, new Error("MangaOCR WebSocket closed"));
        const onError = () => finish(reject, new Error("MangaOCR WebSocket error"));
        const onMessage = (event: MessageEvent) => {
          const accept = (value: string) => {
            const text = value.trim();
            if (!text || text === "True" || text === "False") return;
            finish(resolve, text.replace(/^True\s*/, "").trim());
          };
          if (typeof event.data === "string") accept(event.data);
          else if (event.data instanceof ArrayBuffer) accept(new TextDecoder().decode(event.data));
          else if (event.data instanceof Blob) event.data.text().then(accept).catch(() => undefined);
        };
        socket.addEventListener("message", onMessage);
        socket.addEventListener("close", onClose);
        socket.addEventListener("error", onError);
        try { socket.send(buffer); } catch (error) { finish(reject, error); }
      });
    };
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => undefined);
    return task;
  }
}

export class OcrOverlay {
  private root: HTMLElement | null = null;
  private items: Array<{ img: HTMLImageElement; group: OcrGroup }> = [];
  private frame: HTMLElement | null = null;
  private imageIds = new WeakMap<HTMLImageElement, string>();
  private nextImageId = 1;
  selectedSentence = "";
  private activeGroupKeys = new Set<string>();
  private activeMasterKey: string | null = null;

  constructor(private settings: SettingsStore) {}

  private fontFamily(): string {
    const font = String(this.settings.get("ocrFontFamily") || "BIZ UDGothic").trim().replace(/["']/g, "");
    return '"' + (font || "BIZ UDMincho") + '", "BIZ UDGothic", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
  }

  private ensureRoot(frame: HTMLElement): HTMLElement {
    this.frame = frame;
    if (this.root?.isConnected) { this.applyRootClasses(); return this.root; }
    this.root = document.createElement("div");
    frame.appendChild(this.root);
    this.applyRootClasses();
    return this.root;
  }

  private modeClass(): string {
    const mode = this.settings.get("ocrDisplay");
    return mode === 0 ? "hidden" : mode === 1 ? "hover" : "always";
  }

  private applyRootClasses(): void {
    if (this.root) this.root.className = "ocr-layer " + this.modeClass() + (this.settings.get("ocrDebug") ? " debug" : "") +
      " " + this.settings.get("ocrBackground");
  }

  clear(frame?: HTMLElement): void {
    this.items = []; this.selectedSentence = ""; this.activeGroupKeys.clear(); this.activeMasterKey = null;
    (frame || this.frame)?.querySelector(".ocr-layer")?.remove();
    this.root = null; this.frame = null;
  }

  refreshModes(frame: HTMLElement): void {
    this.ensureRoot(frame); this.applyRootClasses(); this.relayout();
  }

  private imageId(image: HTMLImageElement): string {
    let id = this.imageIds.get(image);
    if (!id) { id = String(this.nextImageId++); this.imageIds.set(image, id); }
    return id;
  }

  applyToImage(image: HTMLImageElement, result: OcrPayload): void {
    if (!image || !result || !image.isConnected) return;
    const root = this.ensureRoot(this.frame || image.closest(".image-frame") as HTMLElement || document.body);
    const active = new Set(this.activeGroupKeys);
    this.items = this.items.filter((item) => item.img !== image);
    const groups = this.extractGroups(result);
    for (const group of groups) this.items.push({ img: image, group });
    this.renderImageItems(image, groups, root);
    this.activeGroupKeys = active;
    this.restoreActiveGroups();
  }

  private renderImageItems(image: HTMLImageElement, groups: OcrGroup[], root: HTMLElement): void {
    const id = this.imageId(image);
    root.querySelectorAll('[data-ocr-img-id="' + id + '"]').forEach((node) => node.remove());
    groups.forEach((group, index) => this.addRegion(root, image, group, index));
  }

  relayout(): void {
    if (!this.root) return;
    const active = new Set(this.activeGroupKeys);
    this.applyRootClasses();
    const grouped = new Map<HTMLImageElement, OcrGroup[]>();
    for (const item of this.items) {
      if (!item.img?.isConnected) continue;
      const groups = grouped.get(item.img) || [];
      groups.push(item.group); grouped.set(item.img, groups);
    }
    for (const [image, groups] of grouped) this.renderImageItems(image, groups, this.root);
    this.activeGroupKeys = active;
    this.restoreActiveGroups();
  }

  private normalizeBox(raw: any, imageWidth: number, imageHeight: number): OcrBox | null {
    if (!raw) return null;
    const box = raw.bounding_box || raw.boundingBox || raw;
    let cx = Number(box.center_x ?? box.centerX), cy = Number(box.center_y ?? box.centerY);
    let width = Number(box.width), height = Number(box.height);
    if (![cx, cy, width, height].every(Number.isFinite)) return null;
    const pixelLike = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(width), Math.abs(height)) > 1.01;
    if (pixelLike) { cx /= imageWidth; cy /= imageHeight; width /= imageWidth; height /= imageHeight; }
    let rotation = Number(box.rotation_z ?? box.rotationZ ?? box.angle ?? 0) || 0;
    if (Math.abs(rotation) > Math.PI * 2) rotation *= Math.PI / 180;
    return { center_x: cx, center_y: cy, width, height, rotation_z: rotation };
  }

  private textFromLine(line: any): string {
    if (typeof line?.text === "string") return line.text;
    if (Array.isArray(line?.words)) return line.words.map((word: any) => word?.text || "").join("");
    return "";
  }

  private linesText(lines: any[]): string {
    return (lines || []).map((line) => this.textFromLine(line)).filter(Boolean).join("");
  }

  private directionOf(paragraph: any, line: any): string {
    return String(line?.writing_direction || paragraph?.writing_direction || "").toUpperCase();
  }

  private isVertical(direction: string): boolean { return /VERTICAL|TOP_TO_BOTTOM/.test(direction); }

  private closeEnough(a: OcrLine, b: OcrLine, vertical: boolean): boolean {
    const gap = Math.max(0, Number(this.settings.get("ocrGroupGap") || 2) / 100);
    const ax1 = a.bbox.center_x - a.bbox.width / 2, ax2 = a.bbox.center_x + a.bbox.width / 2;
    const ay1 = a.bbox.center_y - a.bbox.height / 2, ay2 = a.bbox.center_y + a.bbox.height / 2;
    const bx1 = b.bbox.center_x - b.bbox.width / 2, bx2 = b.bbox.center_x + b.bbox.width / 2;
    const by1 = b.bbox.center_y - b.bbox.height / 2, by2 = b.bbox.center_y + b.bbox.height / 2;
    const overlapX = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
    const overlapY = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const ox = overlapX / Math.max(0.000001, Math.min(a.bbox.width, b.bbox.width));
    const oy = overlapY / Math.max(0.000001, Math.min(a.bbox.height, b.bbox.height));
    if (vertical) {
      const xGap = Math.max(0, Math.max(ax1, bx1) - Math.min(ax2, bx2));
      return xGap <= Math.max(gap, Math.min(a.bbox.width, b.bbox.width) * 0.9) &&
        (oy > 0.15 || Math.abs(a.bbox.center_y - b.bbox.center_y) < Math.max(a.bbox.height, b.bbox.height) * 0.9);
    }
    const yGap = Math.max(0, Math.max(ay1, by1) - Math.min(ay2, by2));
    return yGap <= Math.max(gap, Math.min(a.bbox.height, b.bbox.height) * 0.9) &&
      (ox > 0.15 || Math.abs(a.bbox.center_x - b.bbox.center_x) < Math.max(a.bbox.width, b.bbox.width) * 0.9);
  }

  private union(lines: OcrLine[]): OcrBox | null {
    if (!lines.length) return null;
    const left = Math.min(...lines.map((line) => line.bbox.center_x - line.bbox.width / 2));
    const top = Math.min(...lines.map((line) => line.bbox.center_y - line.bbox.height / 2));
    const right = Math.max(...lines.map((line) => line.bbox.center_x + line.bbox.width / 2));
    const bottom = Math.max(...lines.map((line) => line.bbox.center_y + line.bbox.height / 2));
    return { center_x: (left + right) / 2, center_y: (top + bottom) / 2, width: right - left, height: bottom - top, rotation_z: 0 };
  }

  extractGroups(payload: OcrPayload): OcrGroup[] {
    const geometry = this.settings.get("ocrGeometry");
    const paragraphs = Array.isArray(payload?.paragraphs) ? payload.paragraphs : [];
    const source = paragraphs.length ? paragraphs :
      (Array.isArray(payload?.lines) ? [{ lines: payload.lines, writing_direction: payload.writing_direction || "" }] : []);
    const imageWidth = payload?.image_properties?.width || 1;
    const imageHeight = payload?.image_properties?.height || 1;
    const output: OcrGroup[] = [];
    const overrides = Array.isArray(payload?._twoPassTexts) ? payload._twoPassTexts : [];
    const nextOverride = () => overrides[output.length] ?? null;

    for (const paragraph of source) {
      const rawLines = Array.isArray(paragraph?.lines) ? paragraph.lines : [];
      const lines = rawLines.map((line: any, index: number) => ({
        index,
        bbox: this.normalizeBox(line?.bounding_box || line?.boundingBox, imageWidth, imageHeight),
        text: this.textFromLine(line).trim(),
        dir: this.directionOf(paragraph, line)
      })).filter((line: any) => line.bbox && line.text) as OcrLine[];

      if (geometry === "paragraph") {
        const box = this.normalizeBox(paragraph?.bounding_box || paragraph?.boundingBox, imageWidth, imageHeight) || this.union(lines);
        const text = this.linesText(rawLines), replacement = nextOverride();
        if (box && text) output.push({ bbox: box, text: replacement ?? text, dir: String(paragraph?.writing_direction || ""), kind: "paragraph", lines, _twoPassText: replacement });
        continue;
      }
      if (geometry === "word") {
        for (const line of rawLines) for (const word of (line?.words || [])) {
          const box = this.normalizeBox(word?.bounding_box || word?.boundingBox, imageWidth, imageHeight);
          const text = String(word?.text || "").trim(), replacement = nextOverride();
          if (box && text) output.push({
            bbox: box, text: replacement ?? text, dir: this.directionOf(paragraph, line), kind: "word",
            lines: [{ bbox: box, text: replacement ?? text, dir: this.directionOf(paragraph, line) }], _twoPassText: replacement
          });
        }
        continue;
      }
      if (!lines.length) continue;
      if (!this.settings.get("ocrGroupLines")) {
        for (const line of lines) {
          const replacement = nextOverride();
          output.push({ bbox: line.bbox, text: replacement ?? line.text, dir: line.dir, kind: "line",
            lines: [{ ...line, text: replacement ?? line.text }], _twoPassText: replacement });
        }
        continue;
      }
      let cluster: OcrLine[] = [lines[0]];
      const flush = () => {
        if (!cluster.length) return;
        const replacement = nextOverride();
        output.push({
          bbox: this.union(cluster)!, text: replacement ?? cluster.map((line) => line.text).join(""),
          dir: cluster[0].dir, kind: cluster.length > 1 ? "group" : "line",
          lines: replacement && cluster.length === 1 ? [{ ...cluster[0], text: replacement }] : [...cluster],
          groupId: String(output.length) + ":" + String(cluster[0].index),
          _twoPassText: replacement
        });
        cluster = [];
      };
      for (let index = 1; index < lines.length; index++) {
        const current = lines[index], previous = cluster[cluster.length - 1];
        if (this.isVertical(current.dir) !== this.isVertical(previous.dir) ||
            !this.closeEnough(previous, current, this.isVertical(previous.dir))) {
          flush(); cluster = [current];
        } else cluster.push(current);
      }
      flush();
    }
    return output;
  }

  private fontSize(box: OcrBox, rect: DOMRect, vertical: boolean, text: string): number {
    const chars = Math.max(1, [...(text || "")].length);
    let size = vertical
      ? Math.min(box.width * rect.width * 0.86, (box.height * rect.height / chars) * 1.18)
      : Math.min(box.height * rect.height * 0.88, (box.width * rect.width / chars) * 1.28);
    size *= Number(this.settings.get("ocrScale") || 100) / 100;
    return clamp(size, 8, Number(this.settings.get("ocrMaxFont") || 54));
  }

  private groupByKey(key: string): HTMLElement | null {
    if (!this.root || !key) return null;
    return this.root.querySelector('[data-group-key="' + CSS.escape(key) + '"]');
  }

  private activeGroups(): HTMLElement[] {
    return [...this.activeGroupKeys].map((key) => this.groupByKey(key)).filter((node): node is HTMLElement => !!node);
  }

  private groupCardGeometry(groups: HTMLElement[]) {
    const viewWidth = Math.max(320, this.root?.clientWidth || window.innerWidth || 1280);
    const viewHeight = Math.max(200, this.root?.clientHeight || window.innerHeight || 720);
    if (!groups.length) return { left: 8, top: 8, width: Math.max(1, viewWidth - 16), height: 62 };
    const rects = groups.map((group) => (group as any)._baseRect).filter(Boolean);
    const unionLeft = Math.min(...rects.map((rect: any) => rect.left));
    const unionTop = Math.min(...rects.map((rect: any) => rect.top));
    const unionRight = Math.max(...rects.map((rect: any) => rect.left + rect.width));
    const unionBottom = Math.max(...rects.map((rect: any) => rect.top + rect.height));
    const sentences = groups.map((group) => String((group as any)._ocrSentence || "").trim()).filter(Boolean);
    const chars = [...sentences.join(" ")].length;
    const cardWidth = Math.min(Math.max(320, Math.max(260, chars * 15 + 80)), Math.max(260, viewWidth - 16));
    const lineCount = Math.max(1, Math.ceil(chars / 42));
    const cardHeight = Math.min(Math.max(62, 44 + lineCount * 26), Math.max(62, viewHeight - 16));
    const anchorX = (unionLeft + unionRight) / 2, anchorY = (unionTop + unionBottom) / 2;
    return {
      left: Math.max(8, Math.min(viewWidth - cardWidth - 8, anchorX - cardWidth / 2)),
      top: Math.max(8, Math.min(viewHeight - cardHeight - 8, anchorY - cardHeight / 2)),
      width: Math.min(cardWidth, viewWidth - 16), height: Math.min(cardHeight, viewHeight - 16)
    };
  }

  private renderActiveCard(): void {
    const groups = this.activeGroups();
    if (!groups.length) { this.activeMasterKey = null; this.selectedSentence = ""; return; }
    if (!this.activeMasterKey || !this.activeGroupKeys.has(this.activeMasterKey)) {
      this.activeMasterKey = groups[0].dataset.groupKey || null;
    }
    const master = (this.activeMasterKey && this.groupByKey(this.activeMasterKey)) || groups[0];
    const background = this.settings.get("ocrBackground") || "black";
    const geometry = this.groupCardGeometry(groups);
    const sentences = groups.map((group) => String((group as any)._ocrSentence || "").trim()).filter(Boolean);
    this.selectedSentence = sentences.join("\n");
    for (const group of groups) {
      group.classList.add("group-active", "selected", background);
      if (group !== master) {
        group.style.visibility = "hidden"; group.style.pointerEvents = "none";
      } else {
        group.style.visibility = "visible"; group.style.pointerEvents = "auto";
        group.style.left = geometry.left + "px"; group.style.top = geometry.top + "px";
        group.style.width = geometry.width + "px"; group.style.height = geometry.height + "px";
        const text = (group as any)._groupText as HTMLElement;
        text.textContent = sentences.join(" "); text.style.fontFamily = this.fontFamily();
      }
      ((group as any)._lineEls as HTMLElement[] || []).forEach((line) => {
        if ((line as any)._savedText == null) (line as any)._savedText = line.textContent;
        line.textContent = ""; line.setAttribute("aria-hidden", "true");
        line.style.userSelect = "none"; line.style.webkitUserSelect = "none";
      });
    }
    this.root?.querySelectorAll(".ocr-region.selected").forEach((node) => {
      if (!this.activeGroupKeys.has((node as HTMLElement).dataset.groupKey || "")) node.classList.remove("selected");
    });
  }

  private restoreActiveGroups(): void {
    if (!this.activeGroupKeys.size) { this.selectedSentence = ""; return; }
    const found = [...this.activeGroupKeys].map((key) => this.groupByKey(key)).filter((node): node is HTMLElement => !!node);
    if (!found.length) { this.activeGroupKeys.clear(); this.activeMasterKey = null; this.selectedSentence = ""; return; }
    this.activeGroupKeys = new Set(found.map((node) => node.dataset.groupKey || ""));
    this.renderActiveCard();
  }

  private distributeRefinedText(text: string, lines: OcrLine[]): string[] {
    if (!text || !lines.length) return lines.map((line) => String(line.text || ""));
    if (lines.length === 1) return [text];
    const characters = [...String(text)];
    if (characters.length <= lines.length) return lines.map((_line, index) => index < characters.length ? characters[index] : "");
    const weights = lines.map((line) => Math.max(1, [...String(line.text || "")].length));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const cuts: number[] = [];
    let accumulated = 0;
    for (let index = 0; index < weights.length; index++) {
      accumulated += weights[index];
      cuts.push(index === weights.length - 1 ? characters.length :
        Math.max(index + 1, Math.min(characters.length - (weights.length - index - 1), Math.round(characters.length * accumulated / total))));
    }
    const output: string[] = [];
    let start = 0;
    for (const end of cuts) { output.push(characters.slice(start, end).join("").trim()); start = end; }
    return output;
  }

  private addRegion(root: HTMLElement, image: HTMLImageElement, groupData: OcrGroup, groupIndex: number): void {
    const frame = this.frame!;
    const frameRect = frame.getBoundingClientRect(), imageRect = image.getBoundingClientRect();
    if (imageRect.width < 1 || imageRect.height < 1) return;
    const imageWidth = image.naturalWidth || 1, imageHeight = image.naturalHeight || 1;
    const box = this.normalizeBox(groupData.bbox, imageWidth, imageHeight);
    if (!box) return;
    const group = document.createElement("div");
    group.className = "ocr-region";
    group.dataset.ocrImgId = this.imageId(image);
    group.dataset.groupKey = this.imageId(image) + ":" + (groupData.groupId || groupData.kind) + ":" + groupIndex;
    (group as any)._ocrSentence = groupData.text;
    (group as any)._ocrData = groupData;
    const gx = imageRect.left - frameRect.left + box.center_x * imageRect.width;
    const gy = imageRect.top - frameRect.top + box.center_y * imageRect.height;
    const gw = Math.max(1, box.width * imageRect.width), gh = Math.max(1, box.height * imageRect.height);
    group.style.left = (gx - gw / 2) + "px"; group.style.top = (gy - gh / 2) + "px";
    group.style.width = gw + "px"; group.style.height = gh + "px";
    (group as any)._baseRect = { left: gx - gw / 2, top: gy - gh / 2, width: gw, height: gh };

    const groupText = document.createElement("div");
    groupText.className = "ocr-group-text horizontal"; groupText.style.fontFamily = this.fontFamily();
    group.appendChild(groupText);

    const selectGroup = (line?: HTMLElement) => {
      if (this.activeGroupKeys.size) return;
      this.selectedSentence = groupData.text;
      root.querySelectorAll(".ocr-line.selected").forEach((node) => node.classList.remove("selected"));
      line?.classList.add("selected");
      root.querySelectorAll(".ocr-region.selected").forEach((node) => node.classList.remove("selected"));
      group.classList.add("selected");
    };
    const activateFromContext = (event: Event) => {
      event.preventDefault(); event.stopPropagation();
      const key = group.dataset.groupKey || "";
      if (this.activeGroupKeys.has(key)) { this.deactivateActive(); return; }
      this.activeGroupKeys.add(key); this.activeMasterKey = this.activeMasterKey || key;
      this.renderActiveCard();
    };

    const refinedText = String(groupData._twoPassText || "").trim();
    const sourceLines = groupData.lines?.length ? groupData.lines : [{ bbox: box, text: groupData.text, dir: groupData.dir }];
    const refinedParts = this.distributeRefinedText(refinedText, sourceLines);
    const lineElements: HTMLElement[] = [];
    const makeLine = (lineData: OcrLine, textOverride: string | null = null, refined = false, sizingTextOverride: string | null = null) => {
      const lineBox = this.normalizeBox(lineData.bbox, imageWidth, imageHeight) || box;
      const vertical = this.isVertical(lineData.dir || groupData.dir);
      const text = String(textOverride ?? lineData.text ?? "").trim();
      if (!text) return;
      const sizingText = refinedText && text === refinedText ? String(groupData.text || text) : text;
      const fontSize = Math.round(this.fontSize(lineBox, imageRect, vertical, String(sizingTextOverride ?? sizingText)));
      let lineWidth = Math.max(4, lineBox.width * imageRect.width);
      let lineHeight = Math.max(4, lineBox.height * imageRect.height);
      if (vertical) {
        const characters = Math.max(1, [...sizingText].length);
        lineWidth = Math.max(lineWidth, fontSize * 1.08);
        lineHeight = Math.max(lineHeight, Math.ceil(fontSize * characters * 1.02));
      }
      const x = imageRect.left - frameRect.left + lineBox.center_x * imageRect.width;
      const y = imageRect.top - frameRect.top + lineBox.center_y * imageRect.height;
      const line = document.createElement("span");
      line.className = "ocr-line" + (vertical ? " vertical" : "") + (refined ? " twopass-refined" : "");
      line.dataset.text = text; line.dataset.visualText = text;
      line.dataset.ocrImgId = this.imageId(image); line.dataset.kind = groupData.kind;
      line.dataset.groupKey = group.dataset.groupKey || ""; line.tabIndex = 0; line.textContent = text;
      line.style.left = (x - (gx - gw / 2) - lineWidth / 2) + "px";
      line.style.top = (y - (gy - gh / 2) - lineHeight / 2) + "px";
      line.style.width = lineWidth + "px"; line.style.height = lineHeight + "px";
      line.style.fontSize = fontSize + "px"; line.style.fontFamily = this.fontFamily();
      let rotation = this.settings.get("ocrRotation") ? Number(lineBox.rotation_z) || 0 : 0;
      if (Math.abs(rotation) > Math.PI * 2) rotation *= Math.PI / 180;
      if (vertical && Math.abs(rotation) < 0.2) rotation = 0;
      if (Math.abs(rotation) > 0.008) line.style.transform = "rotate(" + rotation + "rad)";
      line.addEventListener("mouseenter", () => { if (!this.activeGroupKeys.size) line.classList.add("hovered"); });
      line.addEventListener("mouseleave", () => line.classList.remove("hovered"));
      line.addEventListener("click", (event) => { event.stopPropagation(); if (!this.activeGroupKeys.has(group.dataset.groupKey || "")) selectGroup(line); });
      line.addEventListener("contextmenu", activateFromContext);
      line.addEventListener("dblclick", (event) => {
        event.preventDefault(); event.stopPropagation();
        navigator.clipboard?.writeText(groupData.text).then(() => window.dispatchEvent(new CustomEvent("reader-toast", { detail: "OCR sentence copied" }))).catch(() => undefined);
      });
      group.appendChild(line); lineElements.push(line);
    };

    if (refinedText) {
      if (sourceLines.length === 1) makeLine(sourceLines[0], refinedText, true, sourceLines[0].text);
      else sourceLines.forEach((line, index) => makeLine(line, refinedParts[index] || line.text || "", true, line.text));
    } else sourceLines.forEach((line) => makeLine(line));
    group.addEventListener("contextmenu", activateFromContext);
    group.addEventListener("click", (event) => { if (this.activeGroupKeys.has(group.dataset.groupKey || "")) event.stopPropagation(); });
    group.addEventListener("dblclick", (event) => {
      if (!this.activeGroupKeys.has(group.dataset.groupKey || "")) return;
      event.preventDefault(); event.stopPropagation();
      navigator.clipboard?.writeText(this.selectedSentence || groupData.text).then(() => window.dispatchEvent(new CustomEvent("reader-toast", { detail: "OCR sentence copied" }))).catch(() => undefined);
    });
    (group as any)._lineEls = lineElements;
    (group as any)._groupText = groupText;
    root.appendChild(group);
    if (this.activeGroupKeys.has(group.dataset.groupKey || "")) this.renderActiveCard();
  }

  private deactivateGroup(group: HTMLElement): void {
    const base = (group as any)._baseRect;
    if (base) {
      group.style.left = base.left + "px"; group.style.top = base.top + "px";
      group.style.width = base.width + "px"; group.style.height = base.height + "px";
    }
    group.style.visibility = "visible"; group.style.pointerEvents = "auto";
    group.classList.remove("group-active", "selected", "black", "white", "transparent");
    const text = (group as any)._groupText as HTMLElement;
    if (text) text.textContent = "";
    (((group as any)._lineEls || []) as HTMLElement[]).forEach((line) => {
      line.textContent = (line as any)._savedText ?? line.dataset.text ?? "";
      line.removeAttribute("aria-hidden"); line.style.userSelect = ""; line.style.webkitUserSelect = "";
      delete (line as any)._savedText;
    });
  }

  deactivateActive(): void {
    if (!this.activeGroupKeys.size || !this.root) return;
    for (const key of this.activeGroupKeys) {
      const group = this.groupByKey(key);
      if (group) this.deactivateGroup(group);
    }
    this.activeGroupKeys.clear(); this.activeMasterKey = null; this.selectedSentence = "";
  }

  replaceSecondPassText(image: HTMLImageElement, index: number, text: string): void {
    const item = this.items.filter((entry) => entry.img === image)[index];
    if (!item || !this.root) return;
    const group = this.root.querySelectorAll<HTMLElement>('.ocr-region[data-ocr-img-id="' + this.imageId(image) + '"]')[index];
    if (!group) return;
    const refined = String(text || "").trim() || String(item.group.text || "");
    item.group._twoPassText = refined; item.group.text = refined;
    (group as any)._ocrSentence = refined;
    const lines = item.group.lines?.length ? item.group.lines : [{ bbox: item.group.bbox, text: refined, dir: item.group.dir }];
    const parts = this.distributeRefinedText(refined, lines);
    const elements = ((group as any)._lineEls || []) as HTMLElement[];
    if (elements.length === 1) {
      elements[0].textContent = refined; elements[0].dataset.text = refined; elements[0].dataset.visualText = refined;
    } else {
      elements.forEach((line, lineIndex) => {
        const part = (parts[lineIndex] ?? lines[lineIndex]?.text ?? refined).trim();
        line.textContent = part; line.dataset.text = part; line.dataset.visualText = part;
      });
    }
    if (this.activeGroupKeys.has(group.dataset.groupKey || "")) this.renderActiveCard();
  }

  getSelectedSentence(): string { return this.selectedSentence || ""; }
}

export class OcrManager {
  readonly client: OwocrClient;
  readonly secondClient: MangaTextClient;
  readonly overlay: OcrOverlay;
  private cache = new Map<string, OcrPayload>();
  private preloadCache = new Map<string, OcrPayload>();
  private preloadInflight = new Set<string>();
  private generation = 0;
  private raf = 0;
  private busy = false;

  constructor(
    private frame: HTMLElement, private settings: SettingsStore,
    private library: MediaLibrary, private navigation: PageNavigation
  ) {
    this.client = new OwocrClient(settings, (type, message) => this.status(type, message));
    this.secondClient = new MangaTextClient(settings);
    this.overlay = new OcrOverlay(settings);
    window.addEventListener("resize", this.scheduleRelayout, { passive: true });
    document.addEventListener("scroll", this.scheduleRelayout, true);
  }

  destroy(): void {
    this.generation++;
    this.client.close(); this.secondClient.close();
    window.removeEventListener("resize", this.scheduleRelayout);
    document.removeEventListener("scroll", this.scheduleRelayout, true);
    cancelAnimationFrame(this.raf);
  }

  private status(type: string, message: string): void {
    window.dispatchEvent(new CustomEvent("reader-ocr-status", { detail: { type, message } }));
  }

  reset(clearCaches = false): void {
    this.generation++; this.busy = false; this.overlay.clear(this.frame);
    if (clearCaches) { this.cache.clear(); this.preloadCache.clear(); this.preloadInflight.clear(); }
  }

  clear(): void { this.generation++; this.overlay.clear(this.frame); this.status("success", "OCR cleared"); }
  private scheduleRelayout = (): void => {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.overlay.relayout());
  };
  has(): boolean { return !!this.frame.querySelector(".ocr-layer"); }
  getSelectedSentence(): string { return this.overlay.getSelectedSentence(); }

  cycleDisplay(): void {
    const next = (this.settings.get("ocrDisplay") + 1) % 3;
    this.settings.set("ocrDisplay", next);
    if (this.has()) this.overlay.refreshModes(this.frame);
    window.dispatchEvent(new CustomEvent("reader-toast", { detail: "OCR: " + OCR_LABELS[next] }));
  }

  toggle(): void { if (this.has()) this.clear(); else void this.processCurrent(); }
  private preloadImageCount(): number { return clamp(Number(this.settings.get("ocrPreloadImages") ?? 2), 0, 20); }

  private visiblePageCount(): number {
    if (!this.settings.get("dualMode") || this.settings.get("scrollMode") || !this.library.count) return 1;
    const index = this.navigation.idx;
    return index < this.library.count - 1 && !this.navigation.shouldShowSingle(index) ? 2 : 1;
  }

  async preloadAhead(generation = this.generation): Promise<void> {
    if (!this.settings.get("autoOcr") || this.settings.get("scrollMode") ||
        generation !== this.generation || !this.library.count) return;
    const start = this.navigation.idx + this.visiblePageCount();
    const count = this.preloadImageCount();
    const mode = this.settings.get("ocrTwoPass") || "off";
    for (let page = start; page < Math.min(this.library.count, start + count); page++) {
      if (generation !== this.generation) break;
      const source = this.library.get(page);
      if (!source) continue;
      const key = source + "|" + mode;
      if (this.preloadCache.has(key) || this.preloadInflight.has(key) ||
          (this.settings.get("cacheOcr") && this.cache.has(key))) continue;
      const image = new Image(); image.decoding = "async"; image.loading = "eager"; image.src = source;
      try {
        await new Promise<void>((resolve) => {
          if (image.complete && image.naturalWidth) { resolve(); return; }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
        if (generation !== this.generation || !image.naturalWidth) continue;
        this.preloadInflight.add(key);
        const result = await this.runOne(image, page - start + 1, count, generation, mode, true);
        if (result && generation === this.generation) {
          this.preloadCache.set(key, result);
          while (this.preloadCache.size > 12) this.preloadCache.delete(this.preloadCache.keys().next().value as string);
        }
      } catch (error) { console.debug("OCR preload failed", page, error); }
      finally { this.preloadInflight.delete(key); }
    }
  }

  private async currentImages(): Promise<HTMLImageElement[]> {
    let images = [...this.frame.querySelectorAll<HTMLImageElement>("img")].filter((image) => image.isConnected);
    if (!images.length) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      images = [...this.frame.querySelectorAll<HTMLImageElement>("img")].filter((image) => image.isConnected);
    }
    const waiters = images.filter((image) => !image.naturalWidth && image.src).map((image) => new Promise<void>((resolve) => {
      let finished = false;
      const done = () => { if (finished) return; finished = true; resolve(); };
      image.addEventListener("load", done, { once: true }); image.addEventListener("error", done, { once: true });
      window.setTimeout(done, 6000);
    }));
    if (waiters.length) await Promise.all(waiters);
    images = images.filter((image) => image.naturalWidth > 0);
    if (!this.settings.get("scrollMode")) return images;
    const strip = this.frame.querySelector<HTMLElement>(".scroll-strip");
    if (!strip) return images;
    const stripRect = strip.getBoundingClientRect();
    return images.filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom >= stripRect.top - stripRect.height && rect.top <= stripRect.bottom + stripRect.height;
    });
  }

  private cacheKey(image: HTMLImageElement): string {
    return (image.currentSrc || image.src) + "|" + (this.settings.get("ocrTwoPass") || "off");
  }

  async processCurrent(force = false): Promise<void> {
    if (this.busy) return;
    const images = await this.currentImages();
    if (!images.length) { this.status("error", "OCR: no rendered image is ready"); return; }
    const generation = this.generation;
    this.busy = true;
    const mode = this.settings.get("ocrTwoPass") || "off";
    this.status("loading", mode === "owocr" ? "Two-pass OCR…" : mode === "mangaocr" ? "MangaOCR first pass…" : "OCR " + (images.length > 1 ? "pages" : "page") + "…");
    let successful = 0, failed = 0;
    try {
      for (let index = 0; index < images.length; index++) {
        if (generation !== this.generation) break;
        const image = images[index], key = this.cacheKey(image);
        let result: OcrPayload | null = force ? null : this.preloadCache.get(key) || null;
        const fromPreload = !!result;
        this.preloadCache.delete(key);
        if (!result && !force && this.settings.get("cacheOcr")) result = this.cache.get(key) || null;
        const fromCache = !!result;
        if (!result) {
          result = mode === "mangaocr"
            ? await this.runFirstPass(image, index + 1, images.length, generation, false)
            : await this.runOne(image, index + 1, images.length, generation, mode, false);
          if (result && this.settings.get("cacheOcr") && mode !== "mangaocr") this.cache.set(key, result);
        }
        if (!result) { failed++; continue; }
        this.overlay.applyToImage(image, result);
        successful++;
        this.scheduleRelayout();
        if (mode === "mangaocr" && !fromPreload && !fromCache) {
          void this.runSecondPassStreaming(image, result, generation, false).then((finalResult) => {
            if (finalResult && generation === this.generation && this.settings.get("cacheOcr")) this.cache.set(key, finalResult);
          }).catch((error) => {
            console.error(error);
            if (generation === this.generation) this.status("error", "MangaOCR: " + (error?.message || error));
          });
        }
      }
    } finally {
      this.busy = false;
      this.status(failed ? "error" : "success", failed
        ? "OCR done: " + successful + " ok, " + failed + " failed"
        : "OCR ready: " + successful + " image" + (successful === 1 ? "" : "s") + (mode === "mangaocr" ? " · MangaOCR refining…" : ""));
      if (!failed && this.settings.get("autoOcr") && !this.settings.get("scrollMode")) void this.preloadAhead(generation);
    }
  }

  private async runFirstPass(image: HTMLImageElement, index: number, total: number, generation: number, silent = false): Promise<OcrPayload | null> {
    if (!silent) this.status("loading", "OCR " + index + "/" + total + "…");
    if (!image.complete) await new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); });
    if (generation !== this.generation || (!silent && !document.body.contains(image))) return null;
    const buffer = await this.toBuffer(image, silent);
    try { return await this.client.request(buffer, { silent }); }
    catch (error) { console.error(error); if (!silent) this.status("error", error instanceof Error ? error.message : String(error)); return null; }
  }

  private async runOne(image: HTMLImageElement, index: number, total: number, generation: number, mode = "off", silent = false): Promise<OcrPayload | null> {
    if (!silent) this.status("loading", (mode === "owocr" ? "Two-pass OCR" : "OCR") + " " + index + "/" + total + "…");
    if (!image.complete) await new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); });
    if (generation !== this.generation || (!silent && !document.body.contains(image))) return null;
    const buffer = await this.toBuffer(image, silent);
    let first: OcrPayload;
    try { first = await this.client.request(buffer, { silent }); }
    catch (error) { console.error(error); if (!silent) this.status("error", error instanceof Error ? error.message : String(error)); return null; }
    if (mode === "off") return first;
    try { return await this.runSecondPass(image, first, mode, generation, silent); }
    catch (error) {
      console.error(error);
      if (!silent) this.status("error", (mode === "mangaocr" ? "MangaOCR" : "Two-pass") + ": " + (error instanceof Error ? error.message : String(error)));
      return first;
    }
  }

  private async cropBox(image: HTMLImageElement, box: OcrBox): Promise<Uint8Array> {
    const imageWidth = image.naturalWidth || 1, imageHeight = image.naturalHeight || 1;
    const x = Math.max(0, Math.floor((box.center_x - box.width / 2) * imageWidth));
    const y = Math.max(0, Math.floor((box.center_y - box.height / 2) * imageHeight));
    const width = Math.max(1, Math.min(imageWidth - x, Math.ceil(box.width * imageWidth)));
    const height = Math.max(1, Math.min(imageHeight - y, Math.ceil(box.height * imageHeight)));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create OCR crop canvas");
    context.drawImage(image, x, y, width, height, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not crop OCR region")), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  }

  private collectPassRegions(result: OcrPayload): OcrGroup[] {
    return this.overlay.extractGroups(result).filter((group) => group?.bbox && String(group.text || "").trim());
  }

  private replacePassText(result: OcrPayload, replacements: Array<string | null>): OcrPayload {
    result._twoPassTexts = [...replacements];
    return result;
  }

  private async runSecondPassStreaming(image: HTMLImageElement, first: OcrPayload, generation: number, silent = false): Promise<OcrPayload> {
    const regions = this.collectPassRegions(first);
    if (!regions.length) return first;
    const replacements: Array<string | null> = [];
    first._twoPassTexts = [];
    for (let index = 0; index < regions.length; index++) {
      if (generation !== this.generation) return first;
      const region = regions[index];
      try {
        const crop = await this.cropBox(image, region.bbox);
        if (!silent) this.status("loading", "MangaOCR " + (index + 1) + "/" + regions.length + " region…");
        const text = await this.secondClient.request(crop);
        const cleaned = String(text || "").replace(/^True\s*/, "").trim() || region.text;
        replacements[index] = cleaned; first._twoPassTexts[index] = cleaned;
        if (generation === this.generation) {
          this.overlay.replaceSecondPassText(image, index, cleaned);
          this.scheduleRelayout();
        }
      } catch (error) {
        console.error("MangaOCR region failed", index, error);
        replacements[index] = region.text; first._twoPassTexts[index] = region.text;
        if (!silent && generation === this.generation) this.status("error", "MangaOCR " + (index + 1) + "/" + regions.length + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
    if (generation === this.generation && !silent) this.status("success", "MangaOCR refinement complete");
    return this.replacePassText(first, replacements);
  }

  private async runSecondPass(image: HTMLImageElement, first: OcrPayload, mode: string, generation: number, silent = false): Promise<OcrPayload> {
    const regions = this.collectPassRegions(first);
    if (!regions.length) return first;
    const output: string[] = [];
    for (let index = 0; index < regions.length; index++) {
      if (generation !== this.generation) break;
      const region = regions[index], crop = await this.cropBox(image, region.bbox);
      if (!silent) this.status("loading", (mode === "mangaocr" ? "MangaOCR" : "Two-pass OCR") + " " + (index + 1) + "/" + regions.length + " region…");
      const response = mode === "mangaocr" ? await this.secondClient.request(crop) : await this.client.request(crop, { silent });
      const cleaned = (typeof response === "string" ? response : textFromResult(response)).trim() || region.text;
      output.push(cleaned);
    }
    return this.replacePassText(first, output);
  }

  private async toBuffer(image: HTMLImageElement, silent = false): Promise<ArrayBuffer> {
    const source = image.currentSrc || image.src;
    if (!source) throw new Error("Image has no source");
    const response = await fetch(source);
    if (!response.ok) throw new Error("Failed to read image (" + response.status + ")");
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) throw new Error("Image data is empty");
    if (!silent) this.status("loading", "OwOCR ← " + Math.round(buffer.byteLength / 1024) + " KB image sent");
    return buffer;
  }
}
