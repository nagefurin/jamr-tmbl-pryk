import type { SettingsStore } from "./settings";
import type { MediaLibrary } from "./media";
import type { PageNavigation } from "./reader";
import type { ReaderRenderer } from "./reader";

const ANKI_URL = "http://127.0.0.1:8765";
const ANKI_VERSION = 6;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function stableMediaToken(value: string): string {
  let first = 2166136261 >>> 0, second = 2246822519 >>> 0;
  for (let index = 0; index < value.length; index++) {
    const character = value.charCodeAt(index);
    first = Math.imul(first ^ character, 16777619) >>> 0;
    second = Math.imul(second ^ character, 3266489917) >>> 0;
  }
  return (first.toString(36).padStart(7, "0").slice(-5) + second.toString(36).padStart(7, "0").slice(-5)).toLowerCase();
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load source image for Anki export"));
    image.src = source;
  });
}

export class AnkiConnector {
  private mediaNameCache = new Map<string, string>();

  constructor(private renderer: ReaderRenderer, private settings: SettingsStore) {}

  private async request<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(ANKI_URL, {
      method: "POST",
      body: JSON.stringify({ action, version: ANKI_VERSION, params })
    });
    if (!response.ok) throw new Error("AnkiConnect returned HTTP " + response.status);
    const payload = await response.json();
    if (payload?.error) throw new Error(String(payload.error));
    return payload as T;
  }

  async connected(): Promise<boolean> {
    try {
      const response = await fetch(ANKI_URL, {
        method: "POST",
        body: JSON.stringify({ action: "requestPermission", version: ANKI_VERSION })
      });
      return response.ok;
    } catch { return false; }
  }

  async recentNote(): Promise<number | null> {
    const response = await this.request<{ result: number[] }>("findNotes", { query: "added:1" });
    return response.result?.length ? [...response.result].sort((a, b) => b - a)[0] : null;
  }

  private canvasBytes(format = "image/png", quality = 1): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.renderer.canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error("Browser could not encode image")); return; }
        try { resolve(new Uint8Array(await blob.arrayBuffer())); }
        catch (error) { reject(error); }
      }, format, quality);
    });
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return btoa(binary);
  }

  private async encodeExternalFormat(bytes: Uint8Array, format: "avif" | "jxl"): Promise<string> {
    const params = new URLSearchParams({
      format,
      crf: String(clamp(Number(this.settings.get("avifCrf") ?? 42), 1, 63)),
      speed: String(clamp(Number(this.settings.get("avifSpeed") ?? 4), 0, 8)),
      quality: String(clamp(Number(this.settings.get("jxlQuality") ?? 90), 1, 100)),
      effort: String(clamp(Number(this.settings.get("jxlEffort") ?? 7), 1, 9))
    });
    let response: Response;
    try {
      const body = new Uint8Array(bytes).buffer;
      response = await fetch("http://127.0.0.1:7332/encode?" + params.toString(), {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body
      });
    } catch {
      throw new Error("AVIF/JXL helper is not running. Start tmbl-helper.py first.");
    }
    if (!response.ok) {
      let message = format.toUpperCase() + " helper failed (HTTP " + response.status + ")";
      try { const payload = await response.json(); if (payload?.error) message += ": " + payload.error; } catch { /* non-JSON error */ }
      throw new Error(message);
    }
    const output = new Uint8Array(await response.arrayBuffer());
    if (!output.length) throw new Error(format.toUpperCase() + " helper returned empty data");
    return this.bytesToBase64(output);
  }

  private async encodeCanvas(format: "webp" | "avif" | "jxl"): Promise<string> {
    if (format !== "webp") return this.encodeExternalFormat(await this.canvasBytes("image/png"), format);
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.renderer.canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("Browser could not encode WebP")),
        "image/webp",
        this.settings.get("webpQuality") / 100
      );
    });
    return this.bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }

  private async imageBase64(image: HTMLImageElement, width: number, height: number): Promise<string> {
    const canvas = this.renderer.canvas, context = this.renderer.canvas.getContext("2d");
    if (!context) throw new Error("Could not create Anki image canvas");
    canvas.width = width; canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return this.encodeCanvas(this.settings.get("ankiFormat"));
  }

  private async combine(firstSource: string, secondSource: string): Promise<string> {
    const [firstImage, secondImage] = await Promise.all([loadImage(firstSource), loadImage(secondSource)]);
    let firstWidth = firstImage.naturalWidth, firstHeight = firstImage.naturalHeight;
    let secondWidth = secondImage.naturalWidth, secondHeight = secondImage.naturalHeight;
    if (this.settings.get("ankiResize")) {
      if (firstWidth > 1280) { firstHeight = Math.round(firstHeight * 1280 / firstWidth); firstWidth = 1280; }
      if (secondWidth > 1280) { secondHeight = Math.round(secondHeight * 1280 / secondWidth); secondWidth = 1280; }
    }
    const canvas = this.renderer.canvas, context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create Anki image canvas");
    canvas.width = firstWidth + secondWidth; canvas.height = Math.max(firstHeight, secondHeight);
    context.fillStyle = "#111"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(firstImage, 0, 0, firstWidth, firstHeight);
    context.drawImage(secondImage, firstWidth, 0, secondWidth, secondHeight);
    return this.encodeCanvas(this.settings.get("ankiFormat"));
  }

  private tag(): string {
    if (!this.settings.get("ankiTagEnabled")) return "";
    return this.settings.get("ankiTagType") === "__custom__"
      ? this.settings.get("ankiTagCustom").trim()
      : this.settings.get("ankiTagType");
  }

  private isSpecialSingle(index: number, library: MediaLibrary): boolean {
    return this.settings.get("publisherCombinedDetect") &&
      (library.publisherCombined.has(index) || library.publisherCombined.has(index + 1));
  }

  private mediaSourceKey(library: MediaLibrary, navigation: PageNavigation): string {
    const index = navigation.idx;
    const dual = this.settings.get("dualMode");
    const cover = this.settings.get("coverSingle") && index === 0;
    const last = index === library.count - 1;
    const combined = dual && !cover && !last && !this.isSpecialSingle(index, library) &&
      this.settings.get("combineDual") && index + 1 < library.count;
    const indices = combined
      ? (this.settings.get("japaneseMode") ? [index + 1, index] : [index, index + 1])
      : [index];
    const format = this.settings.get("ankiFormat");
    const encoderSettings = format === "webp" ? "q" + this.settings.get("webpQuality")
      : format === "avif" ? "crf" + this.settings.get("avifCrf") + "s" + this.settings.get("avifSpeed")
      : "q" + this.settings.get("jxlQuality") + "e" + this.settings.get("jxlEffort");
    return [library.title, combined ? "dual" : "single", indices.join(","), format,
      this.settings.get("ankiResize") ? "resize" : "native", encoderSettings].join("|");
  }

  private mediaFilename(library: MediaLibrary, navigation: PageNavigation): string {
    const key = this.mediaSourceKey(library, navigation);
    const cached = this.mediaNameCache.get(key);
    if (cached) return cached;
    const filename = "manga_" + stableMediaToken(key) + "." + this.settings.get("ankiFormat");
    this.mediaNameCache.set(key, filename);
    return filename;
  }

  async update(
    library: MediaLibrary, navigation: PageNavigation, sentence = "", noteId: number | null = null,
    progress?: (message: string) => void
  ): Promise<void> {
    if (!await this.connected()) throw new Error("AnkiConnect is not running");
    noteId = noteId || await this.recentNote();
    if (!noteId) throw new Error("No recently added Anki note found");

    const index = navigation.idx;
    const dual = this.settings.get("dualMode");
    const cover = this.settings.get("coverSingle") && index === 0;
    const last = index === library.count - 1;
    const specialSingle = this.isSpecialSingle(index, library);
    const combine = dual && !cover && !last && !specialSingle &&
      this.settings.get("combineDual") && index + 1 < library.count;
    let base64: string;
    progress?.("Preparing image…");
    if (combine) {
      let first = library.get(index)!, second = library.get(index + 1)!;
      if (this.settings.get("japaneseMode")) [first, second] = [second, first];
      progress?.("Encoding " + this.settings.get("ankiFormat").toUpperCase() + "…");
      base64 = await this.combine(first, second);
    } else {
      const image = await loadImage(library.get(index)!);
      let width = image.naturalWidth, height = image.naturalHeight;
      if (this.settings.get("ankiResize") && width > 1280) {
        height = Math.round(height * 1280 / width); width = 1280;
      }
      progress?.("Encoding " + this.settings.get("ankiFormat").toUpperCase() + "…");
      base64 = await this.imageBase64(image, width, height);
    }

    progress?.("Preparing media file…");
    const filename = this.mediaFilename(library, navigation);
    let exists = false;
    try {
      const lookup = await this.request<{ result: string[] }>("findMediaFiles", { pattern: filename });
      exists = Array.isArray(lookup.result) && lookup.result.includes(filename);
    } catch (error) { console.debug("Anki media lookup failed; will upload normally", error); }
    let storedName = filename;
    if (!exists) {
      progress?.("Uploading image to Anki…");
      const stored = await this.request<{ result: string }>("storeMediaFile", { filename, data: base64 });
      if (stored.result) storedName = stored.result;
    } else progress?.("Reusing existing page image…");

    const fields: Record<string, string> = {
      [this.settings.get("ankiField")]: '<img src="' + storedName + '">'
    };
    if (this.settings.get("ankiSentenceEnabled") && this.settings.get("ankiSentenceField") && sentence.trim()) {
      fields[this.settings.get("ankiSentenceField")] = sentence.trim();
    }
    if (this.settings.get("infoField")) fields[this.settings.get("ankiMiscField")] = library.title;
    progress?.("Updating note fields…");
    await this.request("updateNoteFields", { note: { id: noteId, fields } });
    const tag = this.tag();
    if (tag) await this.request("addTags", { notes: [noteId], tags: tag });
    if (this.settings.get("nsfwTag")) await this.request("addTags", { notes: [noteId], tags: "NSFW" });
  }
}
