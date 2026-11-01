const CACHE_NAME = "jamr-tmbl-pryk-app-v3";
const LEGACY_CACHES = ["jamr-tmbl-pryk-shell-v1", "jamr-tmbl-pryk-app-v2"];
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest"];

async function cacheDocument(response, documentUrl) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  const rootUrl = new URL("./", self.registration.scope).href;
  const indexUrl = new URL("./index.html", self.registration.scope).href;

  await cache.put(new Request(documentUrl), response.clone());
  await cache.put(new Request(rootUrl), response.clone());
  await cache.put(new Request(indexUrl), response.clone());

  const html = await response.clone().text();
  const resources = new Set();
  const attributePattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attributePattern.exec(html))) {
    const source = match[1];
    if (!source || source.startsWith("data:") || source.startsWith("#")) continue;
    try {
      const asset = new URL(source, documentUrl);
      if (asset.origin !== self.location.origin) continue;
      if (!asset.pathname.startsWith(new URL(self.registration.scope).pathname)) continue;
      resources.add(asset.href);
    } catch { /* Skip malformed asset references. */ }
  }

  await Promise.all([...resources].map(async (url) => {
    try {
      const assetResponse = await fetch(url, { cache: "no-store" });
      if (assetResponse.ok) await cache.put(new Request(url), assetResponse);
    } catch { /* An individual optional asset should not break the app shell. */ }
  }));
}

async function cacheLatest(url) {
  const target = url || new URL("./index.html", self.registration.scope).href;
  const response = await fetch(target, { cache: "no-store" });
  if (!response.ok) throw new Error("HTTP " + response.status);
  await cacheDocument(response, target);
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL).catch(() => undefined);
    await cacheLatest(new URL("./index.html", self.registration.scope).href).catch((error) => {
      console.warn("Initial app-shell precache failed", error);
    });
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME &&
      (LEGACY_CACHES.includes(key) || key.startsWith("jamr-tmbl-pryk-app-v")))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

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
        if (response.ok) await cacheDocument(response.clone(), request.url);
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
