/* Simple offline-first service worker. Bump CACHE when files change. */
const CACHE = "guessit-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/categories.js",
  "./js/storage.js",
  "./js/game.js",
  "./js/ui.js",
  "./js/main.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
            return resp;
          })
          .catch(() => cached)
      );
    })
  );
});
