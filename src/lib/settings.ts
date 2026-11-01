export const SETTINGS_KEY = "tumbal_refactor_v3";
export const TEXTHOOKER_KEY = "tumbal_tx_v1";

export interface AppSettings {
  japaneseMode: boolean; showProgress: boolean; dualMode: boolean; scrollMode: boolean;
  coverSingle: boolean; snapDouble: boolean; publisherCombinedDetect: boolean; floatyMode: boolean;
  pageFocus: "top" | "middle" | "bottom" | "preserve"; zoomLevel: number;
  ankiField: string; ankiMiscField: string; ankiSentenceField: string; ankiSentenceEnabled: boolean;
  ankiTagType: string; ankiTagCustom: string; ankiTagEnabled: boolean; ankiResize: boolean;
  nsfwTag: boolean; infoField: boolean; combineDual: boolean; webpQuality: number;
  ankiFormat: "webp" | "avif" | "jxl"; avifCrf: number; avifSpeed: number;
  jxlQuality: number; jxlEffort: number;
  ocrUrl: string; mangaOcrUrl: string; ocrTwoPass: "off" | "owocr" | "mangaocr";
  autoOcr: boolean; cacheOcr: boolean; ocrPreloadImages: number; ocrDisplay: number;
  ocrDebug: boolean; ocrBackground: "transparent" | "black" | "white";
  ocrGroupLines: boolean; ocrGroupGap: number; ocrRotation: boolean;
  ocrGeometry: "auto" | "paragraph" | "line" | "word"; ocrFontFamily: string;
  ocrScale: number; ocrMaxFont: number;
  txWsUrl: string; txFontSize: number; txAlign: "center" | "left" | "right";
  txFontFamily: string; txReversed: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  japaneseMode: true, showProgress: true, dualMode: true, scrollMode: false,
  coverSingle: true, snapDouble: true, publisherCombinedDetect: true, floatyMode: false,
  pageFocus: "top", zoomLevel: 175,
  ankiField: "Picture", ankiMiscField: "MiscInfo", ankiSentenceField: "",
  ankiSentenceEnabled: false, ankiTagType: "doujinshi", ankiTagCustom: "",
  ankiTagEnabled: true, ankiResize: true, nsfwTag: true, infoField: true,
  combineDual: true, webpQuality: 80, ankiFormat: "webp", avifCrf: 42,
  avifSpeed: 4, jxlQuality: 90, jxlEffort: 7,
  ocrUrl: "ws://127.0.0.1:7331", mangaOcrUrl: "ws://127.0.0.1:7441",
  ocrTwoPass: "owocr", autoOcr: true, cacheOcr: true, ocrPreloadImages: 3,
  ocrDisplay: 1, ocrDebug: false, ocrBackground: "black", ocrGroupLines: true,
  ocrGroupGap: 2, ocrRotation: true, ocrGeometry: "auto",
  ocrFontFamily: "BIZ UDGothic", ocrScale: 100, ocrMaxFont: 54,
  txWsUrl: "ws://127.0.0.1:6677", txFontSize: 50, txAlign: "center",
  txFontFamily: "BIZ UDGothic", txReversed: false
};

function migrateSettings(value: Record<string, unknown>): Partial<AppSettings> {
  const result = { ...value } as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(result, "ankiFormat") &&
      Object.prototype.hasOwnProperty.call(result, "ankiAvif")) {
    result.ankiFormat = result.ankiAvif ? "avif" : "webp";
  }
  delete result.ankiAvif;
  return result as Partial<AppSettings>;
}

export class SettingsStore {
  d: AppSettings = { ...DEFAULT_SETTINGS };

  constructor() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.d = { ...this.d, ...migrateSettings(JSON.parse(raw)) };
    } catch (error) {
      console.warn("Could not restore reader settings", error);
    }
    try {
      const injected = (window as typeof window & { __JAMR_IMPORTED_SETTINGS__?: unknown }).__JAMR_IMPORTED_SETTINGS__;
      if (injected && typeof injected === "object" && !Array.isArray(injected)) {
        this.d = { ...DEFAULT_SETTINGS, ...this.d, ...migrateSettings(injected as Record<string, unknown>) };
      }
    } catch { /* A settings bootstrap is optional. */ }
    this.persist();
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] { return this.d[key]; }
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void { this.d[key] = value; this.persist(); }
  patch(values: Partial<AppSettings>): void { this.d = { ...this.d, ...values }; this.persist(); }
  replace(values: Record<string, unknown>): void { this.d = { ...DEFAULT_SETTINGS, ...migrateSettings(values) }; this.persist(); }
  reset(): void { this.d = { ...DEFAULT_SETTINGS }; this.persist(); }

  persist(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.d)); }
    catch (error) { console.warn("Could not save reader settings", error); }
  }

  exportObject() {
    return { app: "jamr-tmbl-pryk", formatVersion: 1, exportedAt: new Date().toISOString(), settings: this.d };
  }

  importObject(value: unknown): void {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings file");
    const settings = (value as { settings?: unknown }).settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("The JSON file does not contain a settings object");
    }
    this.replace(settings as Record<string, unknown>);
  }
}
