/* Service worker : fonctionnement sans réseau */
const VERSION = "onddo-v6";
const COQUILLE = ["./", "index.html", "app.js", "manifest.webmanifest", "icons/icon-192.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "indice.js", "carnet.js", "carnet-ui.js", "terrain.js", "carnet/onddo.yml", "data/grid.json", "data/especes.json", "data/chasse.json", "data/habitat.png", "data/forets_publiques.geojson"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("onddo-v") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// les sous-domaines a/b/c d'OpenTopoMap servent les mêmes tuiles
const cle = (url) => url.replace(/\/\/[abc]\.tile\.opentopomap/, "//a.tile.opentopomap");
// notifications d'alerte envoyées par votre dépôt privé
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) { d = { title: "Onddo", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Onddo", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: `${d.coin || ""}:${d.esp || ""}`,
    data: { url: d.coin ? `./?coin=${encodeURIComponent(d.coin)}` : "./" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    for (const c of cs) if ("navigate" in c) return c.navigate(url).then((w) => w && w.focus());
    return self.clients.openWindow(url);
  }));
});

const estTuile = (url) => url.includes("data.geopf.fr/wmts") || url.includes("tile.opentopomap.org");

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (e.request.method !== "GET" || url.startsWith("https://api.github.com")) return;
  // météo : réseau d'abord, copie locale si pas de réseau
  if (/\/data\/(meteo|especes|grid|chasse)\.json|\/data\/habitat\.png/.test(url)) {
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
  // pages et scripts de l'appli : réseau d'abord (pour recevoir les mises à jour), copie locale sinon
  if (url.startsWith(self.location.origin)) {
    e.respondWith(fetch(e.request).then((r) => {
      const copie = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copie)); return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
