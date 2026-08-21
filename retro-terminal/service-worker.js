const CACHE_NAME = "workday-sys-pwa-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=centred-percent-v1",
  "./script.js?v=mobile-fit-v1",
  "./manifest.webmanifest?v=mono-v2",
  "./icons/icon-192.png?v=mono-v2",
  "./icons/icon-512.png?v=mono-v2",
  "./icons/icon-maskable-512.png?v=mono-v2",
  "./icons/apple-touch-icon.png?v=mono-v2",
  "./icons/favicon-64.png?v=mono-v2"
];

const appUrl = (path) => new URL(path, self.registration.scope).toString();

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map(appUrl)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first keeps GitHub Pages updates fresh while the cached shell
  // remains available offline. Cache writes are best-effort: a partial response
  // or full storage quota must never turn a successful network fetch into an
  // application failure.
  const networkResponse = fetch(request);
  const cacheUpdate = networkResponse
    .then((response) => {
      if (!response || !response.ok || response.status === 206) return;
      const copy = response.clone();
      return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    })
    .catch(() => {
      // Cache/storage failures do not affect the response delivered to the app.
    });

  event.waitUntil(cacheUpdate);
  event.respondWith(
    networkResponse.catch(async () => {
      const cached = await caches.match(request, { ignoreSearch: false });
      if (cached) return cached;
      if (request.mode === "navigate") {
        return caches.match(appUrl("./index.html"));
      }
      return Response.error();
    })
  );
});
