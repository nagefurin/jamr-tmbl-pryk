import type { SettingsStore } from "./settings";
import type { MediaLibrary } from "./media";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export class PageNavigation {
  idx = 0;
  total = 0;
  constructor(private settings: SettingsStore, private library: MediaLibrary) {}
  setTotal(value: number): void { this.total = value; }
  isResolutionSingle(index: number): boolean {
    return this.settings.get("publisherCombinedDetect") && this.library.publisherCombined.has(index);
  }
  shouldShowSingle(index: number): boolean {
    if (index < 0 || index >= this.total) return true;
    if (this.settings.get("coverSingle") && index === 0) return true;
    if (index === this.total - 1) return true;
    return this.isResolutionSingle(index) || this.isResolutionSingle(index + 1);
  }
  next(): boolean {
    if (!this.total) return false;
    if (this.settings.get("scrollMode") || !this.settings.get("dualMode")) {
      if (this.idx < this.total - 1) { this.idx++; return true; }
      return false;
    }
    const step = this.shouldShowSingle(this.idx) ? 1 : 2;
    if (this.idx + step < this.total) { this.idx += step; return true; }
    if (this.idx < this.total - 1) { this.idx = this.total - 1; return true; }
    return false;
  }
  prev(): boolean {
    if (!this.total || this.idx === 0) return false;
    if (this.settings.get("scrollMode") || !this.settings.get("dualMode")) { this.idx--; return true; }
    if (this.settings.get("coverSingle") && this.idx === 1) { this.idx = 0; return true; }
    const candidate = this.idx - 1;
    this.idx = this.shouldShowSingle(candidate) ? candidate : Math.max(0, this.idx - 2);
    return true;
  }
  stepForward(): void { if (this.total) this.idx = Math.min(this.idx + 1, this.total - 1); }
  stepBackward(): void { if (this.total) this.idx = Math.max(this.idx - 1, 0); }
}

export class ReaderRenderer {
  zoom = 1;
  panX = 0;
  panY = 0;
  onRendered: (() => void) | null = null;
  private pendingPageFocus: string | null = null;
  private pendingPreservedRatio: number | null = null;
  private resizeObserver: ResizeObserver;

  constructor(public frame: HTMLElement, public canvas: HTMLCanvasElement, private settings: SettingsStore) {
    this.resizeObserver = new ResizeObserver(() => { this.reflow(); this.onRendered?.(); });
    this.resizeObserver.observe(frame);
  }

  destroy(): void { this.resizeObserver.disconnect(); }

  private fit(image: HTMLImageElement): number {
    if (!image?.naturalWidth || !image?.naturalHeight) return 1;
    return Math.min(this.frame.clientWidth / image.naturalWidth, this.frame.clientHeight / image.naturalHeight, 1);
  }

  captureSingleFocus(): number {
    const wrapper = this.frame.querySelector<HTMLElement>(".zoom-wrapper");
    if (!wrapper) return 0;
    const maxY = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
    return maxY > 0 ? clamp(wrapper.scrollTop / maxY, 0, 1) : 0;
  }

  panBy(dx: number, dy: number): void {
    const wrapper = this.frame.querySelector<HTMLElement>(".zoom-wrapper");
    if (!wrapper) return;
    wrapper.scrollLeft -= dx;
    wrapper.scrollTop -= dy;
  }

  private centerScroll(): void {
    const wrapper = this.frame.querySelector<HTMLElement>(".zoom-wrapper");
    if (!wrapper) return;
    wrapper.scrollLeft = Math.round(Math.max(0, wrapper.scrollWidth - wrapper.clientWidth) / 2);
  }

  private applyPageFocus(preservedRatio: number | null): void {
    const wrapper = this.frame.querySelector<HTMLElement>(".zoom-wrapper");
    if (!wrapper) return;
    const maxY = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
    const mode = this.pendingPageFocus || this.settings.get("pageFocus") || "top";
    if (mode === "top") wrapper.scrollTop = 0;
    else if (mode === "middle") wrapper.scrollTop = Math.round(maxY / 2);
    else if (mode === "bottom") wrapper.scrollTop = maxY;
    else wrapper.scrollTop = Math.round((preservedRatio ?? 0) * maxY);
    this.pendingPageFocus = null;
  }

  render(library: MediaLibrary, index: number, focusRatio: number | null = null): void {
    this.pendingPreservedRatio = focusRatio;
    this.pendingPageFocus = this.settings.get("pageFocus");
    if (this.pendingPageFocus === "preserve" && focusRatio === null) this.pendingPageFocus = "top";
    this.frame.replaceChildren();
    const layer = document.createElement("div");
    layer.className = "float-layer";
    const drift = document.createElement("div");
    drift.className = "float-drift";
    layer.appendChild(drift);
    this.frame.appendChild(layer);
    this.zoom = this.baseZoom;
    if (this.settings.get("scrollMode")) this.renderScroll(library, index, drift);
    else if (this.settings.get("dualMode")) this.renderDual(library, index, drift);
    else this.renderSingle(library.get(index), drift);
    requestAnimationFrame(() => this.onRendered?.());
  }

  get baseZoom(): number {
    return (this.settings.get("dualMode") || this.settings.get("scrollMode")) ? 1 : this.settings.get("zoomLevel") / 100;
  }

  private layoutSingle(image: HTMLImageElement): void {
    if (!image?.naturalWidth) return;
    const fit = this.fit(image);
    const width = image.naturalWidth * fit;
    const height = image.naturalHeight * fit;
    const wrapper = this.frame.querySelector<HTMLElement>(".zoom-wrapper");
    const sizer = this.frame.querySelector<HTMLElement>(".zoom-sizer");
    const container = this.frame.querySelector<HTMLElement>(".img-container");
    if (!wrapper || !sizer || !container) return;
    image.style.width = width + "px";
    image.style.height = height + "px";
    container.style.width = width + "px";
    container.style.height = height + "px";
    container.style.transform = "scale(" + this.zoom + ")";
    const oldMaxY = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
    const ratio = oldMaxY > 0 ? clamp(wrapper.scrollTop / oldMaxY, 0, 1) : 0;
    sizer.style.width = Math.max(width * this.zoom, wrapper.clientWidth) + "px";
    sizer.style.height = Math.max(height * this.zoom, wrapper.clientHeight) + "px";
    const hadPendingFocus = this.pendingPageFocus !== null;
    requestAnimationFrame(() => {
      if (hadPendingFocus) this.applyPageFocus(this.pendingPreservedRatio);
      else {
        const maxX = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
        const maxY = Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
        wrapper.scrollLeft = Math.round(maxX / 2);
        if (wrapper.dataset.focusInitialized) wrapper.scrollTop = Math.min(Math.round(ratio * maxY), maxY);
        else { wrapper.scrollTop = 0; wrapper.dataset.focusInitialized = "1"; }
      }
    });
  }

  private reflow(): void {
    if (this.settings.get("dualMode") || this.settings.get("scrollMode")) return;
    const image = this.frame.querySelector<HTMLImageElement>(".page-single");
    if (image) this.layoutSingle(image);
  }

  private renderSingle(src: string | null, drift: HTMLElement): void {
    if (!src) return;
    const wrapper = document.createElement("div"); wrapper.className = "zoom-wrapper";
    const sizer = document.createElement("div"); sizer.className = "zoom-sizer";
    const container = document.createElement("div"); container.className = "img-container";
    const image = document.createElement("img"); image.className = "page-single"; image.src = src; image.draggable = false;
    container.appendChild(image); sizer.appendChild(container); wrapper.appendChild(sizer); drift.appendChild(wrapper);
    const apply = () => this.layoutSingle(image);
    if (image.complete && image.naturalWidth) apply();
    else image.addEventListener("load", apply, { once: true });
  }

  private renderDual(library: MediaLibrary, index: number, drift: HTMLElement): void {
    const cover = this.settings.get("coverSingle") && index === 0;
    const last = index === library.count - 1;
    const special = this.settings.get("publisherCombinedDetect") &&
      (library.publisherCombined.has(index) || library.publisherCombined.has(index + 1));
    if (cover || last || special) { this.renderSingle(library.get(index), drift); return; }
    const wrapper = document.createElement("div"); wrapper.className = "page-dual-wrap";
    const add = (pageIndex: number) => {
      const container = document.createElement("div"); container.className = "img-container";
      const image = document.createElement("img"); image.className = "page-dual";
      image.src = library.get(pageIndex) || ""; image.draggable = false;
      container.appendChild(image); wrapper.appendChild(container);
    };
    if (this.settings.get("japaneseMode")) { add(index + 1); add(index); }
    else { add(index); add(index + 1); }
    drift.appendChild(wrapper);
  }

  private renderScroll(library: MediaLibrary, start: number, drift: HTMLElement): void {
    const strip = document.createElement("div"); strip.className = "scroll-strip";
    for (let index = 0; index < library.count; index++) {
      const page = document.createElement("div"); page.className = "scroll-page";
      const image = document.createElement("img"); image.src = library.get(index) || "";
      image.dataset.index = String(index); image.loading = "lazy"; image.draggable = false;
      page.appendChild(image); strip.appendChild(page);
    }
    drift.appendChild(strip);
    requestAnimationFrame(() => {
      const target = strip.querySelector(".scroll-page:nth-child(" + (start + 1) + ")");
      target?.scrollIntoView({ block: "start" });
    });
  }

  setZoom(value: number): void {
    this.zoom = value;
    this.reflow();
    requestAnimationFrame(() => this.centerScroll());
  }
}
