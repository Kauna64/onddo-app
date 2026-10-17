/* Onddo : sur le terrain (retour à la voiture, tracé du parcours) et hors-ligne automatique.
   La voiture et le tracé restent sur ce téléphone uniquement. */
"use strict";

const Terrain = (() => {
  let st = { voiture: null, trace: [], actif: false };
  try { st = { ...st, ...JSON.parse(localStorage.getItem("onddo-terrain") || "{}") }; } catch (_) {}
  const sauve = () => { try { localStorage.setItem("onddo-terrain", JSON.stringify(st)); } catch (_) {} };
  let moi = null, cap = null, suivi = null, calque = null, ligneVoiture = null, ligneTrace = null, marqueMoi = null;

  /* ---------- géométrie ---------- */
  const rad = (x) => (x * Math.PI) / 180;
  function distance(a, b) { return L.latLng(a).distanceTo(L.latLng(b)); }
  function gisement(a, b) { // direction de a vers b, en degrés depuis le nord
    const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
    const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  const POINTS = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"];
  const cardinal = (g) => POINTS[Math.round(g / 45) % 8];
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`);
  function longueurTrace() { let d = 0; for (let i = 1; i < st.trace.length; i++) d += distance(st.trace[i - 1], st.trace[i]); return d; }

  /* ---------- position ---------- */
  function ecoute() {
    if (suivi !== null || !navigator.geolocation) return;
    suivi = navigator.geolocation.watchPosition((p) => {
      moi = [p.coords.latitude, p.coords.longitude];
      if (st.actif && p.coords.accuracy < 50) {
        const der = st.trace[st.trace.length - 1];
        if (!der || distance(der, moi) > 8) { st.trace.push([+moi[0].toFixed(6), +moi[1].toFixed(6), Date.now()]); sauve(); }
      }
      HorsLigne.autour(moi[0], moi[1]);
      affiche();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
  }
  function arreteEcoute() { if (suivi !== null && !st.actif && !st.voiture) { navigator.geolocation.clearWatch(suivi); suivi = null; } }

  async function boussole() {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
        if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return;
      }
      window.addEventListener("deviceorientation", (e) => {
        if (e.webkitCompassHeading != null) cap = e.webkitCompassHeading;
        else if (e.absolute && e.alpha != null) cap = (360 - e.alpha) % 360;
        else return;
        afficheFleche();
      }, true);
    } catch (_) {}
  }

  /* ---------- affichage ---------- */
  function affiche() {
    if (!calque) calque = L.layerGroup().addTo(map);
    calque.clearLayers();
    if (st.trace.length > 1) L.polyline(st.trace.map((p) => [p[0], p[1]]), { color: "#ff6a00", weight: 4, opacity: 0.85 }).addTo(calque);
    if (st.voiture) {
      L.marker([st.voiture.lat, st.voiture.lon], { icon: L.divIcon({ className: "voiture-icone", html: "🚗", iconSize: [30, 30] }) }).addTo(calque);
      if (moi) L.polyline([moi, [st.voiture.lat, st.voiture.lon]], { color: "#1f6feb", weight: 2, dashArray: "6 6" }).addTo(calque);
    }
    if (moi) L.circleMarker(moi, { radius: 7, color: "#fff", weight: 2, fillColor: "#1f6feb", fillOpacity: 1 }).addTo(calque);
    const c = $("#terrain");
    const lignes = [];
    if (st.voiture) {
      if (moi) {
        const d = distance(moi, [st.voiture.lat, st.voiture.lon]), g = gisement(moi, [st.voiture.lat, st.voiture.lon]);
        lignes.push(`<span class="fleche" id="t-fleche" data-g="${g}">➤</span> <b>Voiture à ${fmtDist(d)}</b>, vers le ${cardinal(g)}`);
      } else lignes.push("🚗 Voiture garée · recherche de votre position…");
    }
    if (st.actif || st.trace.length > 1) {
      const dur = st.trace.length > 1 ? Math.round((st.trace[st.trace.length - 1][2] - st.trace[0][2]) / 60000) : 0;
      lignes.push(`${st.actif ? "⏺" : "⏹"} Tracé ${fmtDist(longueurTrace())}${dur ? ` · ${Math.floor(dur / 60) ? Math.floor(dur / 60) + " h " : ""}${dur % 60} min` : ""}`);
    }
    c.innerHTML = lignes.join("<br>");
    c.style.display = lignes.length ? "block" : "none";
    afficheFleche();
    $("#btn-terrain").classList.toggle("actif", !!(st.voiture || st.actif));
  }
  function afficheFleche() {
    const f = $("#t-fleche"); if (!f) return;
    const g = +f.dataset.g;
    // la flèche montre la direction de la voiture : par rapport au nord, ou par rapport au téléphone si la boussole répond
    f.style.transform = `rotate(${(cap != null ? g - cap : g) - 90}deg)`;
    f.title = cap != null ? "Direction par rapport au téléphone" : "Direction par rapport au nord (haut de la carte)";
  }

  /* ---------- actions ---------- */
  function menu() {
    const h = `<h2>Sur le terrain</h2>
      <p class="k">La position de la voiture et le tracé restent sur ce téléphone.</p>
      <p>${st.voiture ? `<button class="btn" id="t-retour">Retour à la voiture</button> <button class="btn ghost" id="t-repartir">Voiture récupérée</button>` : `<button class="btn" id="t-garer">Je me gare ici</button>`}</p>
      <p>${st.actif ? `<button class="btn" id="t-stop">Arrêter le tracé</button>` : `<button class="btn ghost" id="t-go">Enregistrer mon parcours</button>`}
         ${st.trace.length > 1 ? `<button class="btn ghost" id="t-gpx">Exporter (GPX)</button> <button class="btn ghost" id="t-effacer">Effacer le tracé</button>` : ""}</p>
      <p class="k">Sur iPhone, gardez Onddo ouvert à l'écran pendant le tracé : l'enregistrement se met en pause quand l'appli passe en arrière-plan. La flèche s'oriente avec la boussole si vous l'autorisez.</p>
      <p class="k" id="t-etat"></p>`;
    $("#terrain-corps").innerHTML = h;
    $("#terrain-panel").classList.add("open");
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    on("#t-garer", () => position((p) => { st.voiture = { lat: p[0], lon: p[1], t: Date.now() }; sauve(); boussole(); ecoute(); HorsLigne.autour(p[0], p[1], true); fini("Voiture enregistrée"); }));
    on("#t-retour", () => { boussole(); ecoute(); const v = st.voiture; map.fitBounds(L.latLngBounds([[v.lat, v.lon], moi || [v.lat, v.lon]]).pad(0.3)); fini(); });
    on("#t-repartir", () => { st.voiture = null; sauve(); arreteEcoute(); fini("Voiture effacée"); });
    on("#t-go", () => { st.actif = true; if (st.trace.length && Date.now() - st.trace[st.trace.length - 1][2] > 6 * 3600e3) st.trace = []; sauve(); ecoute(); fini("Tracé démarré"); });
    on("#t-stop", () => { st.actif = false; sauve(); arreteEcoute(); fini("Tracé arrêté"); });
    on("#t-effacer", () => { st.trace = []; sauve(); fini("Tracé effacé"); });
    on("#t-gpx", exporteGpx);
  }
  function fini(msg) { $("#terrain-panel").classList.remove("open"); if (msg) toast(msg); affiche(); }
  function position(f) {
    if (!navigator.geolocation) return toast("Localisation indisponible");
    texteEtat("Recherche de la position…");
    navigator.geolocation.getCurrentPosition((p) => f([p.coords.latitude, p.coords.longitude]), () => texteEtat("Position introuvable : activez la localisation."), { enableHighAccuracy: true, timeout: 15000 });
  }
  const texteEtat = (t) => { const e = $("#t-etat"); if (e) e.textContent = t; };
  function exporteGpx() {
    const pts = st.trace.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join("");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Onddo" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Sortie Onddo</name><trkseg>${pts}</trkseg></trk></gpx>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    a.download = `onddo-${new Date(st.trace[0][2]).toISOString().slice(0, 10)}.gpx`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function init() {
    $("#btn-terrain").onclick = menu;
    $("#terrain-fermer").onclick = () => $("#terrain-panel").classList.remove("open");
    $("#terrain").onclick = () => { if (st.voiture) { const v = st.voiture; map.fitBounds(L.latLngBounds([[v.lat, v.lon], moi || [v.lat, v.lon]]).pad(0.3)); } };
    if (st.voiture || st.actif) ecoute();
    affiche();
  }
  return { init, get position() { return moi; } };
})();

/* ---------- hors-ligne automatique ---------- */
const HorsLigne = (() => {
  const LIMITE_VUES = 4000;
  let fait = {};
  try { fait = JSON.parse(localStorage.getItem("onddo-horsligne") || "{}"); } catch (_) {}
  const note = () => { try { localStorage.setItem("onddo-horsligne", JSON.stringify(fait)); } catch (_) {} };
  let file = Promise.resolve();

  function urls(lat, lon, rayonKm, zmin, zmax) {
    const fond = map.hasLayer(_fonds.ortho) ? _fonds.ortho : map.hasLayer(_fonds.topo) ? _fonds.topo : _fonds.plan;
    const dLat = rayonKm / 111, dLon = rayonKm / (111 * Math.cos((lat * Math.PI) / 180));
    const b = L.latLngBounds([lat - dLat, lon - dLon], [lat + dLat, lon + dLon]);
    const out = [];
    for (let z = zmin; z <= zmax; z++) {
      const a = map.project(b.getNorthWest(), z).divideBy(256).floor(), c = map.project(b.getSouthEast(), z).divideBy(256).floor();
      for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) out.push(L.Util.template(fond._url, { z, x, y, s: "a" }));
    }
    return out;
  }
  // télécharge en arrière-plan, sans bloquer l'appli, ce qui n'est pas déjà en cache
  function precharge(liste) {
    if (!("caches" in window) || !navigator.onLine) return;
    file = file.then(async () => {
      const cache = await caches.open("onddo-tuiles");
      for (let i = 0; i < liste.length; i += 6) {
        await Promise.all(liste.slice(i, i + 6).map(async (u) => {
          if (await caches.match(u)) return;
          try { const r = await fetch(u, { mode: "cors" }); if (r.ok) await cache.put(u, r); } catch (_) {}
        }));
      }
    }).catch(() => {});
  }
  // autour d'une position : une fois par jour et par carré d'environ 1 km
  function autour(lat, lon, force) {
    const k = `p${lat.toFixed(2)},${lon.toFixed(2)}`, auj = new Date().toISOString().slice(0, 10);
    if (!force && fait[k] === auj) return;
    fait[k] = auj; note();
    precharge(urls(lat, lon, 2, 13, 16));
  }
  // autour des coins du carnet : tous les 30 jours
  function coins(liste) {
    const lim = Date.now() - 30 * 864e5;
    for (const c of liste || []) {
      const k = `c${c.id}`;
      if (fait[k] && fait[k] > lim) continue;
      fait[k] = Date.now(); note();
      precharge(urls(c.lat, c.lon, 1.5, 12, 16));
    }
  }
  // le cache des tuiles vues ne grossit pas indéfiniment
  async function menage() {
    if (!("caches" in window)) return;
    const c = await caches.open("onddo-vues"), k = await c.keys();
    for (const r of k.slice(0, Math.max(0, k.length - LIMITE_VUES))) await c.delete(r);
  }
  return { autour, coins, menage };
})();

function initTerrain() {
  Terrain.init();
  HorsLigne.menage();
  if (typeof Carnet !== "undefined") Carnet.surChangement(() => Carnet.ouvert && HorsLigne.coins(Carnet.data.coins));
}
