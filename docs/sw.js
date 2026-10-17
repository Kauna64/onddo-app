/* Service worker : fonctionnement sans réseau */
const VERSION = "onddo-v1";
const COQUILLE = ["./", "index.html", "app.js", "manifest.webmanifest", "icons/icon-192.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "data/grid.json", "data/habitat.png", "data/forets_publiques.geojson"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("onddo-v") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// les sous-domaines a/b/c d'OpenTopoMap servent les mêmes tuiles
const cle = (url) => url.replace(/\/\/[abc]\.tile\.opentopomap/, "//a.tile.opentopomap");
const estTuile = (url) => url.includes("data.geopf.fr/wmts") || url.includes("tile.opentopomap.org");

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (e.request.method !== "GET") return;
  // météo : réseau d'abord, copie locale si pas de réseau
  if (url.includes("/data/meteo.json") || url.includes("/data/habitat.png") || url.includes("/data/grid.json")) {
    e.respondWith(fetch(e.request).then((r) => {
      const copie = r.clone(); caches.open("onddo-donnees").then((c) => c.put(url.split("?")[0], copie)); return r;
    }).catch(() => caches.match(url.split("?")[0], { ignoreSearch: true })));
    return;
  }
  if (estTuile(url)) {
    e.respondWith(caches.match(cle(url)).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok || r.type === "opaque") { const copie = r.clone(); caches.open("onddo-vues").then((c) => c.put(cle(url), copie)); }
      return r;
    })));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
