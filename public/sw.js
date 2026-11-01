const CACHE_NAME = "jamr-tmbl-pryk-app-v2";
const LEGACY_CACHES = ["jamr-tmbl-pryk-shell-v1"];
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL).catch(() => undefined);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME && LEGACY_CACHES.includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function cacheLatest(url) {
  const target = url || new URL("./", self.registration.scope).href;
  const response = await fetch(target, { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const cache = await caches.open(CACHE_NAME);
  await cache.put(new Request(target), response.clone());
  const root = new URL("./", self.registration.scope).href;
  if (target !== root) await cache.put(new Request(root), response.clone());
  return response;
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_LATEST") return;
  event.waitUntil(cacheLatest(event.data.url)
    .then(() => event.source?.postMessage?.({ type: "CACHE_LATEST_RESULT", ok: true }))
    .catch((error) => event.source?.postMessage?.({
      type: "CACHE_LATEST_RESULT", ok: false, error: String(error?.message || error)
    })));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(new Request(new URL("./index.html", self.registration.scope).href), response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) ||
          (await cache.match(new URL("./index.html", self.registration.scope).href)) ||
          (await cache.match(new URL("./", self.registration.scope).href)) ||
          Response.error();
      }
    })());
    return;
  }

  if (["script", "style", "worker", "font", "image"].includes(request.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response.ok) void cache.put(request, response.clone());
        return response;
      }).catch(() => null);
      return cached || await network || Response.error();
    })());
  }
});
