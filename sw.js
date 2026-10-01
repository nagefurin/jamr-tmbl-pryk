const CACHE_NAME = 'jamr-tmbl-pryk-shell-v1';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

async function cacheLatestIndex(requestUrl) {
  const cache = await caches.open(CACHE_NAME);
  const url = requestUrl || new URL('./index.html', self.registration.scope).href;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await cache.put(new Request(url), response.clone());

  const scopeUrl = new URL(self.registration.scope);
  const rootUrl = new URL('./', scopeUrl).href;
  if (url !== rootUrl) {
    await cache.put(new Request(rootUrl), response.clone());
  }
  return response;
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_LATEST') return;
  event.waitUntil(
    cacheLatestIndex(event.data.url)
      .then(() => event.source?.postMessage?.({ type: 'CACHE_LATEST_RESULT', ok: true }))
      .catch(error => event.source?.postMessage?.({ type: 'CACHE_LATEST_RESULT', ok: false, error: String(error?.message || error) }))
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode !== 'navigate') return;

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request, { cache: 'no-store' });
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(new Request(new URL('./index.html', self.registration.scope).href), response.clone());
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE_NAME);
      const scopeUrl = new URL(self.registration.scope);
      const cached = await cache.match(new URL('./index.html', scopeUrl).href);
      if (cached) return cached;
      const rootCached = await cache.match(new URL('./', scopeUrl).href);
      if (rootCached) return rootCached;
      return Response.error();
    }
  })());
});