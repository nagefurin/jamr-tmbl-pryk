import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("Application root #app was not found");
mount(App, { target });

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update().catch(() => undefined))
      .catch((error) => console.warn("Service worker registration failed", error));
  }, { once: true });
}
