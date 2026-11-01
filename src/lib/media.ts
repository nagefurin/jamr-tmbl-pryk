import JSZip from "jszip";

export const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp|bmp|avif|jxl)$/i;
export const ARCHIVE_RE = /\.(zip|cbz|epub)$/i;

type FileWithPath = File & { relativePath?: string };
type ArchiveEntry = { path: string; entry: JSZip.JSZipObject };

export function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function tagFile(file: File, path: string): FileWithPath {
  try { Object.defineProperty(file, "relativePath", { value: path.replace(/^\//, ""), configurable: true }); }
  catch { /* Some browser File implementations are not extensible. */ }
  return file as FileWithPath;
}

function fileTitle(files: File[]): string {
  const first = files.find((file) => IMAGE_RE.test(file.name)) as FileWithPath | undefined;
  return first?.webkitRelativePath?.split("/")[0] || first?.relativePath?.split("/")[0] || "Images";
}

function resolveArchivePath(base: string, relative: string): string {
  const parts = (base + relative).split("/");
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

export class MediaLibrary {
  urls: string[] = [];
  title = "";
  metadata: Array<{ width: number; height: number }> = [];
  publisherCombined = new Set<number>();
  get count(): number { return this.urls.length; }
  get(index: number): string | null { return this.urls[index] || null; }

  clear(): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = []; this.metadata = []; this.publisherCombined.clear(); this.title = "";
  }

  async loadFiles(files: File[]): Promise<number> {
    this.clear();
    const sorted = [...files].sort((a, b) => {
      const fa = a as FileWithPath, fb = b as FileWithPath;
      return naturalSort(fa.relativePath || fa.webkitRelativePath || a.name, fb.relativePath || fb.webkitRelativePath || b.name);
    });
    for (const file of sorted) if (IMAGE_RE.test(file.name)) this.urls.push(URL.createObjectURL(file));
    this.title = fileTitle(sorted);
    await this.loadMetadata();
    this.publisherCombined = this.detectPublisherCombined();
    return this.count;
  }

  async loadArchive(file: File): Promise<number> {
    this.clear();
    const zip = await JSZip.loadAsync(file);
    const entries: ArchiveEntry[] = [];
    if (/\.epub$/i.test(file.name)) {
      const found = await this.loadEpubSpine(zip, entries);
      if (!found) this.collectZipImages(zip, entries);
    } else this.collectZipImages(zip, entries);
    entries.sort((a, b) => naturalSort(a.path, b.path));
    for (const item of entries) this.urls.push(URL.createObjectURL(await item.entry.async("blob")));
    this.title = file.name.replace(/\.[^/.]+$/, "");
    await this.loadMetadata();
    this.publisherCombined = this.detectPublisherCombined();
    return this.count;
  }

  private collectZipImages(zip: JSZip, output: ArchiveEntry[]): void {
    zip.forEach((path, entry) => { if (!entry.dir && IMAGE_RE.test(path)) output.push({ path, entry }); });
  }

  private async loadEpubSpine(zip: JSZip, output: ArchiveEntry[]): Promise<boolean> {
    try {
      const container = zip.file("META-INF/container.xml");
      if (!container) return false;
      const rootFile = (await container.async("text")).match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!rootFile) return false;
      const opf = zip.file(rootFile);
      if (!opf) return false;
      const base = rootFile.includes("/") ? rootFile.slice(0, rootFile.lastIndexOf("/") + 1) : "";
      const xml = await opf.async("text");
      const manifest = new Map<string, { href: string; type: string }>();
      const itemRegex = /<item\s+([^>]*?)\/?\s*>/gi;
      let match: RegExpExecArray | null;
      while ((match = itemRegex.exec(xml))) {
        const attrs = match[1];
        const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
        const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
        const type = attrs.match(/\bmedia-type\s*=\s*["']([^"']+)["']/i)?.[1] || "";
        if (id && href) manifest.set(id, { href: decodeURIComponent(href), type });
      }
      const spine: string[] = [];
      const spineRegex = /<itemref\b[^>]*?\bidref\s*=\s*["']([^"']+)["'][^>]*>/gi;
      while ((match = spineRegex.exec(xml))) spine.push(match[1]);
      if (!spine.length) return false;
      const seen = new Set<string>();
      for (const id of spine) {
        const item = manifest.get(id);
        if (!item) continue;
        const fullPath = resolveArchivePath(base, item.href);
        if (item.type.startsWith("image/")) {
          const image = zip.file(fullPath);
          if (image && !seen.has(fullPath)) { seen.add(fullPath); output.push({ path: fullPath, entry: image }); }
        } else if (item.type.includes("html") || item.type.includes("xml")) {
          const documentEntry = zip.file(fullPath);
          if (!documentEntry) continue;
          const content = await documentEntry.async("text");
          const dir = fullPath.includes("/") ? fullPath.slice(0, fullPath.lastIndexOf("/") + 1) : "";
          const imageRegex = /(?:src|href|xlink:href)\s*=\s*["']([^"']+)["']/gi;
          let imageMatch: RegExpExecArray | null;
          while ((imageMatch = imageRegex.exec(content))) {
            const relative = decodeURIComponent(imageMatch[1]).split("#")[0];
            if (!relative || relative.startsWith("data:") || !IMAGE_RE.test(relative)) continue;
            const imagePath = resolveArchivePath(dir, relative);
            const image = zip.file(imagePath);
            if (image && !seen.has(imagePath)) { seen.add(imagePath); output.push({ path: imagePath, entry: image }); }
          }
        }
      }
      return output.length > 0;
    } catch (error) {
      console.warn("EPUB spine parse failed; falling back to archive image sorting", error);
      return false;
    }
  }

  private async loadMetadata(): Promise<void> {
    this.metadata = await Promise.all(this.urls.map((src) => new Promise<{ width: number; height: number }>((resolve) => {
      const image = new Image();
      const done = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
      image.onload = done; image.onerror = done; image.src = src;
    })));
  }

  detectPublisherCombined(): Set<number> {
    const valid = this.metadata.filter((meta) => meta.width > 0 && meta.height > 0);
    if (valid.length < 3) return new Set();
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const medianWidth = median(valid.map((meta) => meta.width));
    const medianHeight = median(valid.map((meta) => meta.height));
    const medianArea = median(valid.map((meta) => meta.width * meta.height));
    const result = new Set<number>();
    this.metadata.forEach((meta, index) => {
      if (!meta.width || !meta.height) return;
      if (meta.width >= medianWidth * 1.6 && meta.height >= medianHeight * 1.6 &&
          meta.width * meta.height >= medianArea * 2.35) result.add(index);
    });
    return result;
  }
}
