import type { SettingsStore } from "./settings";
import { TEXTHOOKER_KEY } from "./settings";

export interface TexthookerLine { text: string; time: number }

export class Texthooker {
  lines: TexthookerLine[] = [];
  private socket: WebSocket | null = null;

  constructor(
    private content: HTMLElement,
    private status: HTMLElement,
    private reverseButton: HTMLElement,
    private alignButton: HTMLElement,
    private settings: SettingsStore
  ) {
    try {
      const value = localStorage.getItem(TEXTHOOKER_KEY);
      if (value) {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed?.lines)) this.lines = parsed.lines.filter((line: any) => typeof line?.text === "string");
      }
    } catch { /* Ignore damaged local transcript data. */ }
    this.render();
    this.apply();
    if (location.protocol !== "file:") void this.connect();
  }

  async connect(): Promise<void> {
    this.socket?.close();
    try {
      const socket = new WebSocket(this.settings.get("txWsUrl"));
      this.socket = socket;
      socket.onopen = () => this.status.classList.add("connected");
      socket.onclose = () => this.status.classList.remove("connected");
      socket.onerror = () => this.status.classList.remove("connected");
      socket.onmessage = (event) => {
        const text = String(event.data || "").trim();
        if (text) this.add(text);
      };
    } catch (error) {
      console.warn("Could not connect texthooker socket", error);
      this.status.classList.remove("connected");
    }
  }

  reconnect(): void { void this.connect(); }

  add(text: string): void {
    this.lines.push({ text, time: Date.now() });
    if (this.lines.length > 5000) this.lines.splice(0, this.lines.length - 5000);
    this.render(); this.save();
  }

  render(): void {
    const fragment = document.createDocumentFragment();
    for (const line of this.lines) {
      const element = document.createElement("div");
      element.className = "tx-line"; element.textContent = line.text;
      fragment.appendChild(element);
    }
    this.content.replaceChildren(fragment);
    this.apply();
  }

  apply(): void {
    this.content.style.fontSize = this.settings.get("txFontSize") + "px";
    const font = String(this.settings.get("txFontFamily") || "BIZ UDGothic").trim().replace(/["']/g, "");
    this.content.style.fontFamily = '"' + (font || "BIZ UDGothic") +
      '", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
    this.content.style.textAlign = this.settings.get("txAlign");
    this.content.classList.toggle("reversed", this.settings.get("txReversed"));
    this.reverseButton.classList.toggle("selected", this.settings.get("txReversed"));
    this.alignButton.classList.toggle("selected", this.settings.get("txAlign") === "center");
  }

  private save(): void {
    try { localStorage.setItem(TEXTHOOKER_KEY, JSON.stringify({ lines: this.lines })); }
    catch (error) { console.warn("Could not persist texthooker transcript", error); }
  }

  clear(): void {
    this.lines = []; this.content.replaceChildren();
    try { localStorage.removeItem(TEXTHOOKER_KEY); } catch { /* ignore */ }
  }

  async copy(): Promise<void> {
    await navigator.clipboard?.writeText(this.lines.map((line) => line.text).join("\n"));
  }

  export(): void {
    const data = {
      lines: this.lines,
      text: this.lines.map((line) => line.text).join("\n"),
      exported: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "texthooker_" + Date.now() + ".json"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async import(file: File): Promise<void> {
    try {
      const data = JSON.parse(await file.text());
      const lines = Array.isArray(data?.lines) ? data.lines :
        String(data?.text || "").split("\n").filter(Boolean).map((text) => ({ text, time: Date.now() }));
      this.lines = lines.filter((line: any) => typeof line?.text === "string").slice(-5000);
      this.render(); this.save();
    } catch { window.dispatchEvent(new CustomEvent("reader-toast", { detail: "Invalid texthooker JSON" })); }
  }

  toggleEdit(): boolean {
    const editable = this.content.contentEditable !== "true";
    this.content.contentEditable = String(editable);
    this.content.classList.toggle("edit-mode", editable);
    return editable;
  }

  toggleReverse(): void { this.settings.set("txReversed", !this.settings.get("txReversed")); this.apply(); }
  toggleAlign(): void {
    this.settings.set("txAlign", this.settings.get("txAlign") === "center" ? "left" : "center");
    this.apply();
  }
  close(): void { this.socket?.close(); this.socket = null; }
}
