const CACHE_NAME = "workday-sys-pwa-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=centred-percent-v1",
  "./script.js?v=centred-percent-v1",
  "./manifest.webmanifest?v=mono-v1",
  "./icons/icon-192.png?v=mono-v1",
  "./icons/icon-512.png?v=mono-v1",
  "./icons/icon-maskable-512.png?v=mono-v1",
  "./icons/apple-touch-icon.png?v=mono-v1",
  "./icons/favicon-64.png?v=mono-v1"
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
  // remains available when the phone or laptop is offline. Awaiting cache.put
  // inside the response promise also keeps the worker alive for the write.
  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: false });
        if (cached) return cached;
        if (request.mode === "navigate") {
          return caches.match(appUrl("./index.html"));
        }
        return Response.error();
      })
  );
});
