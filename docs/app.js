/* Onddo : carte de pousse des champignons, Pyrénées-Atlantiques */
"use strict";

const state = { esp: "edulis", mode: "pousse", jour: 0, prive: false };
let G, M, E, C, HAB, W, H, map, overlay, pubLayer, rowLat, colLon, nodeIdx, repere;
const LUT = {}, IDX = {};   // habitat par code milieu/sol ; indice météo par point, altitude et jour, par espèce
const GRAD = -0.0065;       // °C par mètre d'altitude
const EXPO = 0.6;           // poids de l'habitat : pousse = météo × habitat^0,6
const NIV_MIN = 0.12;                       // en dessous : transparent
const $ = (s) => document.querySelector(s);

/* ---------- utilitaires ---------- */
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function toast(msg, ms = 2500) {
  const t = $("#toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = "none"), ms);
}
function rampe(v) {
  // jaune -> orange -> rouge -> bordeaux
  const s = [[243, 226, 122], [240, 166, 58], [217, 84, 43], [142, 31, 63]];
  const x = Math.min(Math.max((v - NIV_MIN) / (0.85 - NIV_MIN), 0), 1) * 3;
  const i = Math.min(Math.floor(x), 2), f = x - i;
  return s[i].map((c, k) => Math.round(c + (s[i + 1][k] - c) * f));
}
function rampeHab(v) { // vert
  const a = [214, 232, 178], b = [38, 98, 50];
  const f = Math.min(Math.max((v - 0.2) / 0.8, 0), 1);
  return a.map((c, k) => Math.round(c + (b[k] - c) * f));
}
const fmtJour = (iso) => {
  const d = new Date(iso + "T12:00:00");
  return { j: d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", ""), n: d.getDate() };
};

/* ---------- chargement ---------- */
async function charge() {
  const [g, m, e, ch] = await Promise.all([
    fetch("data/grid.json").then((r) => r.json()),
    fetch("data/meteo.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("data/especes.json").then((r) => r.json()),
    fetch("data/chasse.json").then((r) => r.json()).catch(() => null),
  ]);
  G = g; M = m && m.points && m.points[0] && m.points[0].p ? m : null; E = e; C = ch; W = g.width; H = g.height;
  for (const id of E.ordre) {
    const sp = E.especes[id], t = new Float32Array(128);
    for (let c = 0; c < 128; c++) t[c] = (sp.essences[c >> 2] || 0) * sp.sols[c & 3];
    LUT[id] = t;
  }
  try { const s = localStorage.getItem("onddo-espece"); if (s && E.especes[s]) state.esp = s; } catch (_) {}
  const img = new Image(); img.src = "data/habitat.png";
  await img.decode();
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  HAB = cx.getImageData(0, 0, W, H).data;

  // géoréférencement de chaque ligne / colonne
  const [[la0, lo0], [la1, lo1]] = g.bounds;
  const y0 = mercY(la0), y1 = mercY(la1);
  rowLat = new Float32Array(H); colLon = new Float32Array(W);
  for (let r = 0; r < H; r++) {
    const y = y1 - ((r + 0.5) / H) * (y1 - y0);
    rowLat[r] = (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;
  }
  for (let k = 0; k < W; k++) colLon[k] = lo0 + ((k + 0.5) / W) * (lo1 - lo0);

  if (M) {
    nodeIdx = new Int32Array(M.grille.nlat * M.grille.nlon).fill(-1);
    M.points.forEach((p, n) => (nodeIdx[p.i * M.grille.nlon + p.j] = n));
    // jours affichés : de J-7 à J+7 autour d'aujourd'hui
    M.j0 = Math.max(0, M.aujourdhui - M.affiche);
    M.jours = M.dates.slice(M.j0, M.aujourdhui + M.affiche + 1);
    M.auj = M.aujourdhui - M.j0;
    M.mois = M.dates.map((d) => +d.slice(5, 7));
    state.jour = M.auj;
  }
}

/* ---------- météo interpolée ---------- */
// valeur 0-1 de l'indice au point (lat, lon) pour une altitude donnée
function indiceMeteo(lat, lon, alt, jour, esp) {
  const g = M.grille;
  const fi = (lat - g.lat0) / g.dlat, fj = (lon - g.lon0) / g.dlon;
  const i0 = Math.floor(fi), j0 = Math.floor(fj), di = fi - i0, dj = fj - j0;
  let s = 0, w = 0, altp = 0;
  for (const [i, j, wt] of [[i0, j0, (1 - di) * (1 - dj)], [i0 + 1, j0, di * (1 - dj)], [i0, j0 + 1, (1 - di) * dj], [i0 + 1, j0 + 1, di * dj]]) {
    if (i < 0 || j < 0 || i >= g.nlat || j >= g.nlon || wt <= 0) continue;
    const n = nodeIdx[i * g.nlon + j]; if (n < 0) continue;
    s += wt * valNiveau(n, alt, jour, esp); altp += wt * M.points[n].alt; w += wt;
  }
  return w > 0 ? s / w : 0;
}
// indice calculé dans l'appli (indice.js) pour chaque point météo, à chaque altitude de référence
function decode(esp) {
  if (IDX[esp]) return IDX[esp];
  const L = M.niveaux, nL = L.length, nJ = M.jours.length, e = E.especes[esp].meteo;
  const a = new Float32Array(M.points.length * nL * nJ);
  M.points.forEach((pt, n) => L.forEach((lv, k) => {
    const r = calculIndice(pt.p, pt.tm, pt.tn, pt.e, M.mois, e, GRAD * (lv - pt.alt), false);
    for (let j = 0; j < nJ; j++) a[(n * nL + k) * nJ + j] = r[M.j0 + j] || 0;
  }));
  return (IDX[esp] = a);
}
function valNiveau(n, alt, jour, esp) {
  const L = M.niveaux, nL = L.length, nJ = M.jours.length, T = decode(esp);
  const v = (k) => T[(n * nL + k) * nJ + jour];
  if (alt <= L[0]) return v(0);
  for (let k = 0; k < nL - 1; k++) {
    if (alt <= L[k + 1]) {
      const f = (alt - L[k]) / (L[k + 1] - L[k]);
      return v(k) * (1 - f) + v(k + 1) * f;
    }
  }
  return v(nL - 1);
}
function altPoint(lat, lon) { // altitude météo interpolée, faute de relief
  const g = M.grille; const i = Math.round((lat - g.lat0) / g.dlat), j = Math.round((lon - g.lon0) / g.dlon);
  const n = nodeIdx[i * g.nlon + j]; return n >= 0 ? M.points[n].alt : 600;
}
const altPixel = (b, lat, lon) => (b >> 1 ? ((b >> 1) - 1) * 24 + 12 : altPoint(lat, lon));

/* ---------- rendu ---------- */
let rendu = null;
function dessine() {
  const t0 = performance.now();
  const out = new ImageData(W, H), o = out.data;
  const lut = LUT[state.esp];
  const pousse = state.mode === "pousse" && M;
  // cache de l'indice météo sur une grille grossière (8 px = 400 m) pour la vitesse
  const S = 8, cw = Math.ceil(W / S) + 1, chh = Math.ceil(H / S) + 1;
  const cache = new Map();
  for (let r = 0; r < H; r++) {
    const lat = rowLat[r];
    for (let k = 0; k < W; k++) {
      const p = (r * W + k) * 4, code = HAB[p];
      if (code < 4) continue;
      const b = HAB[p + 2];
      if (state.prive && !(b & 1)) continue;
      let v = lut[code] * HAB[p + 1] / 250, rgb;
      if (v <= 0) continue;
      if (pousse) {
        const alt = altPixel(b, lat, colLon[k]);
        const key = ((r / S) | 0) * cw * 40 + ((k / S) | 0) * 40 + Math.min(39, (alt / 50) | 0);
        let m = cache.get(key);
        if (m === undefined) { m = indiceMeteo(lat, colLon[k], alt, state.jour, state.esp); cache.set(key, m); }
        v = Math.pow(v, EXPO) * m;
        if (v < NIV_MIN) continue;
        rgb = rampe(v);
        o[p + 3] = Math.round(150 + 90 * Math.min(1, (v - NIV_MIN) / 0.5));
      } else {
        if (v < 0.2) continue;
        rgb = rampeHab(v); o[p + 3] = 170;
      }
      o[p] = rgb[0]; o[p + 1] = rgb[1]; o[p + 2] = rgb[2];
    }
  }
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  c.getContext("2d").putImageData(out, 0, 0);
  c.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    if (overlay) { URL.revokeObjectURL(overlay._url); overlay.setUrl(url); }
    else overlay = L.imageOverlay(url, G.bounds, { opacity: 0.85, interactive: false }).addTo(map);
    overlay._url = url;
  });
  rendu = performance.now() - t0;
  majStatut();
}

function majStatut() {
  let s;
  if (!M) s = "Météo indisponible : seul l'habitat est affiché.";
  else {
    const d = new Date(M.genere);
    const age = (Date.now() - d) / 36e5;
    s = `Météo du ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
    if (age > 30) s += " · données anciennes";
    const j = M.jours[state.jour];
    if (state.mode === "pousse") s += ` · ${state.jour > M.auj ? "prévision" : state.jour < M.auj ? "passé" : "aujourd'hui"} ${new Date(j + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}`;
  }
  $("#status").textContent = s;
  $("#maj").textContent = G.dem ? "Pyrénées-Atlantiques" : "Pyrénées-Atlantiques · relief en attente";
}

/* ---------- espèces ---------- */
function especes() {
  const box = $("#especes"); box.innerHTML = "";
  let groupe = null;
  for (const id of E.ordre) {
    const sp = E.especes[id];
    if (sp.groupe !== groupe) {
      groupe = sp.groupe;
      const t = document.createElement("span"); t.className = "grp"; t.textContent = groupe; box.appendChild(t);
    }
    const b = document.createElement("button");
    b.className = "chip" + (id === state.esp ? " on" : ""); b.textContent = sp.nom; b.dataset.v = id;
    b.onclick = () => {
      state.esp = id;
      try { localStorage.setItem("onddo-espece", id); } catch (_) {}
      box.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
      ficheEspece(); fermePoint(); dessine();
    };
    box.appendChild(b);
  }
  box.querySelector(".chip.on").scrollIntoView({ inline: "center", block: "nearest" });
  ficheEspece();
  // fiches détaillées dans le panneau d'information
  $("#fiches").innerHTML = E.ordre.map((id) => {
    const sp = E.especes[id];
    return `<li><b>${sp.nom}</b> <i>(${sp.latin})</i> : ${sp.arbres.toLowerCase()} ; ${sp.periode.toLowerCase()}. ${sp.note}</li>`;
  }).join("");
}
function ficheEspece() {
  const sp = E.especes[state.esp];
  $("#fiche").textContent = `${sp.arbres} · ${sp.periode}`;
}

/* ---------- jours ---------- */
function jours() {
  const box = $("#days"); box.innerHTML = "";
  if (!M) { box.style.display = "none"; return; }
  M.jours.forEach((iso, i) => {
    const f = fmtJour(iso), b = document.createElement("button");
    const ch = chasseJour(iso);
    b.className = "day" + (i === M.auj ? " today" : "") + (i < M.auj ? " past" : "") + (i === state.jour ? " on" : "") + (ch.battue ? " chasse" : "");
    b.innerHTML = `${i === M.auj ? "auj." : f.j}<b>${f.n}</b>`;
    if (ch.battue) b.title = "Jour de chasse courant";
    b.onclick = () => { state.jour = i; box.querySelectorAll(".day").forEach((x, k) => x.classList.toggle("on", k === i)); dessine(); if (repere) detail({ latlng: repere.getLatLng() }); };
    box.appendChild(b);
  });
  box.children[state.jour].scrollIntoView({ inline: "center", block: "nearest" });
}

/* ---------- détail d'un point ---------- */
function pixel(latlng) {
  const [[la0, lo0], [la1, lo1]] = G.bounds;
  const k = Math.floor(((latlng.lng - lo0) / (lo1 - lo0)) * W);
  const r = Math.floor(((mercY(la1) - mercY(latlng.lat)) / (mercY(la1) - mercY(la0))) * H);
  if (k < 0 || r < 0 || k >= W || r >= H) return null;
  const p = (r * W + k) * 4; return { code: HAB[p], rel: HAB[p + 1], b: HAB[p + 2] };
}
function graphe(vals, auj) {
  const w = 220, h = 54, bw = w / vals.length;
  let s = `<svg width="${w}" height="${h + 14}" viewBox="0 0 ${w} ${h + 14}">`;
  vals.forEach((v, i) => {
    const bh = Math.max(1, v * h), c = v < NIV_MIN ? "#cbbfae" : `rgb(${rampe(v)})`;
    s += `<rect x="${i * bw + 1}" y="${h - bh}" width="${bw - 2}" height="${bh}" rx="2" fill="${c}"${i === state.jour ? ' stroke="#2b2118" stroke-width="1.5"' : ""}/>`;
  });
  s += `<line x1="${auj * bw + bw / 2}" x2="${auj * bw + bw / 2}" y1="0" y2="${h}" stroke="#2b2118" stroke-dasharray="2 2"/>`;
  s += `<text x="0" y="${h + 12}" font-size="10" fill="#7a6a58">−7 j</text><text x="${auj * bw - 4}" y="${h + 12}" font-size="10" fill="#7a6a58">auj.</text><text x="${w - 24}" y="${h + 12}" font-size="10" fill="#7a6a58">+7 j</text></svg>`;
  return s;
}
function foretPublique(latlng) {
  let nom = null;
  if (!pubLayer) return null;
  pubLayer.eachLayer((l) => {
    if (nom || !l.getBounds().contains(latlng)) return;
    if (dansPoly(latlng, l.feature.geometry)) nom = l.feature.properties.nom;
  });
  return nom;
}
function dansPoly(ll, geom) {
  const x = ll.lng, y = ll.lat;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    let inside = false;
    poly.forEach((ring) => {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    });
    if (inside) return true;
  }
  return false;
}
/* ---------- chasse ---------- */
const FERIES = new Set(["2026-11-01", "2026-11-11", "2026-12-25", "2027-01-01", "2027-03-29", "2027-05-01", "2027-05-06", "2027-05-08"]);
function chasseJour(iso) {
  if (!C) return { saison: false, battue: false };
  const saison = iso >= C.saison.ouverture && iso <= C.saison.fermeture;
  const sanglier = iso >= C.saison.ouverture && iso <= C.saison.sanglier_plaine;
  const wd = new Date(iso + "T12:00").getDay(); // 0 = dimanche
  const jourChasse = wd === 0 || wd === 3 || wd === 6 || FERIES.has(iso);
  const palombe = iso.slice(5) >= C.palombe.debut && iso.slice(5) <= C.palombe.fin;
  return { saison: saison || sanglier, battue: (saison || sanglier) && jourChasse, jourChasse, palombe };
}
function chasseZone(ll) {
  if (!C) return null;
  return C.zones.find((z) => map.distance(ll, [z.lat, z.lon]) <= z.rayon_km * 1000) || null;
}

/* ---------- détail d'un point : indice recalculé à l'altitude exacte, avec ses raisons ---------- */
// séries météo interpolées entre les 4 points de grille voisins
function serieLocale(lat, lon) {
  const g = M.grille;
  const fi = (lat - g.lat0) / g.dlat, fj = (lon - g.lon0) / g.dlon;
  const i0 = Math.floor(fi), j0 = Math.floor(fj), di = fi - i0, dj = fj - j0;
  const n = M.dates.length, s = { p: new Float32Array(n), tm: new Float32Array(n), tn: new Float32Array(n), e: new Float32Array(n), alt: 0 };
  let w = 0;
  for (const [i, j, wt] of [[i0, j0, (1 - di) * (1 - dj)], [i0 + 1, j0, di * (1 - dj)], [i0, j0 + 1, (1 - di) * dj], [i0 + 1, j0 + 1, di * dj]]) {
    if (i < 0 || j < 0 || i >= g.nlat || j >= g.nlon || wt <= 0) continue;
    const k = nodeIdx[i * g.nlon + j]; if (k < 0) continue;
    const pt = M.points[k];
    for (let d = 0; d < n; d++) { s.p[d] += wt * pt.p[d]; s.tm[d] += wt * pt.tm[d]; s.tn[d] += wt * pt.tn[d]; s.e[d] += wt * pt.e[d]; }
    s.alt += wt * pt.alt; w += wt;
  }
  if (!w) return null;
  for (const v of ["p", "tm", "tn", "e"]) for (let d = 0; d < n; d++) s[v][d] /= w;
  s.alt /= w;
  return s;
}
const dateCourte = (iso) => new Date(iso + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const f1 = (x) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
function verdict(v) { return v >= 0.6 ? "très favorable" : v >= 0.4 ? "favorable" : v >= 0.2 ? "possible" : "faible"; }
function ligne(note, titre, texte) {
  const ic = note >= 0.75 ? "ok" : note >= 0.35 ? "moyen" : "non";
  return `<li class="${ic}"><span class="ic"></span><div><b>${titre}</b><br>${texte}</div></li>`;
}

function detail(e) {
  const ll = e.latlng, px = pixel(ll);
  if (!px) return;
  if (repere) repere.setLatLng(ll); else repere = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2b2118", fillOpacity: 1 }).addTo(map);
  const sp = E.especes[state.esp], em = sp.meteo;
  const hab = px.code >= 4 ? LUT[state.esp][px.code] * px.rel / 250 : 0;
  const alt = M || px.b >> 1 ? Math.round(altPixel(px.b, ll.lat, ll.lng)) : null;
  const nom = foretPublique(ll);
  let h = `<div class="pt-titre">${sp.nom}</div>`;
  const raisons = [];

  // habitat
  if (px.code < 4) {
    h += `<div class="pt-big">Hors forêt</div><p class="k">Pas de forêt cartographiée ici (BD Forêt : bois de plus de 0,5 ha). Un petit bois ou une haie peut tout de même produire.</p>`;
  } else {
    const mil = E.milieux[px.code >> 2], sol = E.sols[px.code & 3];
    const fe = sp.essences[px.code >> 2], fs = sp.sols[px.code & 3];
    raisons.push(ligne(hab, `Milieu : ${mil.toLowerCase()}, ${sol.toLowerCase()}`,
      `Arbres ${fe >= 0.8 ? "très favorables" : fe >= 0.5 ? "favorables" : fe >= 0.25 ? "peu favorables" : "défavorables"} (${Math.round(fe * 100)} %), sol ${Math.round(fs * 100)} %${px.rel < 240 ? `, relief ${Math.round(px.rel / 2.5)} % (pente forte ou altitude)` : ""}. ${sp.nom} : ${sp.arbres.toLowerCase()}.`));
  }

  if (M && px.code >= 4) {
    const s = serieLocale(ll.lat, ll.lng);
    if (s) {
      const dT = GRAD * (alt - s.alt);
      const r = calculIndice(s.p, s.tm, s.tn, s.e, M.mois, em, dT, true);
      const serie = M.jours.map((_, j) => Math.pow(hab, EXPO) * (r.indice[M.j0 + j] || 0));
      const jd = M.j0 + state.jour, d = r.detail[jd], v = serie[state.jour];
      h += `<div class="pt-big">${Math.round(v * 100)}<small>/100</small> <span class="pt-verdict v-${verdict(v).replace(" ", "-")}">${verdict(v)}</span></div>`;
      h += `<div class="k">Indice de pousse le ${dateCourte(M.jours[state.jour])}${state.jour > M.auj ? " (prévision)" : ""}</div>${graphe(serie, M.auj)}`;
      // pluie déclenchante
      const [a, , , dmax] = em.lag;
      let pl = 0, jmax = -1, vmax = 0;
      for (let k = a; k <= dmax; k++) { const x = s.p[jd - k]; pl += x; if (x > vmax) { vmax = x; jmax = jd - k; } }
      raisons.push(ligne(d.declenche, "Pluie déclenchante",
        `${Math.round(d.pluie)} mm « utiles » (pluie tombée ${em.lag[1]} à ${em.lag[2]} jours avant, la plus efficace). ${Math.round(pl)} mm en tout entre le ${dateCourte(M.dates[jd - dmax])} et le ${dateCourte(M.dates[jd - a])}${vmax >= 5 ? `, dont ${Math.round(vmax)} mm le ${dateCourte(M.dates[jmax])}` : ""}. ; il en faut environ ${em.seuil + em.plage} pour un plein déclenchement.`));
      raisons.push(ligne((d.humide - (em.humide_min ?? 0.3)) / (1 - (em.humide_min ?? 0.3)), "Humidité du sol",
        `Réserve en eau estimée ${Math.round(d.reserve)} mm sur ${RESERVE} (${d.reserve >= 35 ? "sol bien humide" : d.reserve >= 20 ? "sol frais" : d.reserve >= 10 ? "sol qui s'assèche" : "sol sec"}).`));
      const [t0, t1, t2, t3] = em.t;
      raisons.push(ligne(d.temp, "Température du sol",
        `${f1(d.tsol)} °C estimés à ${alt} m sur 10 jours ; idéal ${t1}-${t2} °C, rien sous ${t0} ou au-dessus de ${t3} °C${d.tsol > t2 ? " : trop chaud" : d.tsol < t1 ? " : trop froid" : ""}.`));
      raisons.push(ligne(d.gel, "Gel", d.tmin < 0.5 ? `Gelée le ${dateCourte(M.dates[d.jgel])} (${f1(d.tmin)} °C) : les poussées sont freinées.` : `Aucune gelée ces 5 derniers jours (minimum ${f1(d.tmin)} °C).`));
      raisons.push(ligne(d.saison, "Saison", `${sp.periode} ; ${d.saison >= 0.8 ? "pleine saison" : d.saison >= 0.4 ? "début ou fin de saison" : "hors saison habituelle"}.`));
      if (d.persiste > d.brut + 0.05 && d.debut >= 0)
        raisons.push(ligne(d.persiste, "Poussée en cours", `Conditions réunies vers le ${dateCourte(M.dates[d.debut])} ; la poussée se poursuit en s'atténuant.`));
      // facteur limitant
      const fx = [["la pluie", d.declenche], ["l'humidité du sol", (d.humide - (em.humide_min ?? 0.3)) / (1 - (em.humide_min ?? 0.3))], ["la température", d.temp], ["le gel", d.gel], ["la saison", d.saison], ["le milieu", hab]];
      const lim = fx.reduce((m, x) => (x[1] < m[1] ? x : m));
      if (v < 0.6 && lim[1] < 0.75) h += `<p class="pt-lim">Ce qui limite surtout : <b>${lim[0]}</b>.</p>`;
      const p15 = s.p.slice(M.aujourdhui - 14, M.aujourdhui + 1).reduce((x, y) => x + y, 0), p7 = s.p.slice(M.aujourdhui + 1, M.aujourdhui + 8).reduce((x, y) => x + y, 0);
      h += `<ul class="pt-raisons">${raisons.join("")}</ul>`;
      h += `<p class="k">Pluie : ${Math.round(p15)} mm ces 15 derniers jours, ${Math.round(p7)} mm prévus sur 7 jours.</p>`;
    }
  } else if (raisons.length) h += `<ul class="pt-raisons">${raisons.join("")}</ul>`;

  if (alt !== null) h += `<p class="k">Altitude ≈ ${alt} m${px.b >> 1 ? "" : " (estimée)"}</p>`;
  h += `<p class="k">${nom ? "Forêt publique : " + nom + ". Renseignez-vous sur les règles de cueillette de la commune ou de la commission syndicale." : px.b & 1 ? "Forêt publique." : px.code >= 4 ? "Forêt probablement privée : accord du propriétaire nécessaire." : ""}</p>`;
  // chasse
  if (M && C) {
    const iso = M.jours[state.jour], ch = chasseJour(iso), z = chasseZone(ll);
    let t = !ch.saison ? "Hors saison de chasse." :
      ch.battue ? `<b>${new Date(iso + "T12:00").toLocaleDateString("fr-FR", { weekday: "long" })} : jour de chasse courant</b>, battues probables. Gilet orange conseillé.` :
      "Saison de chasse ouverte ; battues moins fréquentes ce jour-là, mais possibles (sanglier).";
    if (ch.palombe) t += " Passage des palombes : cols et crêtes très fréquentés par les chasseurs.";
    if (z) t += `<br><b>${z.nom}</b> : ${z.texte} <a href="${z.lien}" target="_blank" rel="noopener">${z.lien_texte}</a>`;
    h += `<div class="pt-chasse">${t}</div>`;
  }
  $("#point-corps").innerHTML = h;
  $("#point").classList.add("open");
}
function fermePoint() {
  $("#point").classList.remove("open");
  if (repere) { repere.remove(); repere = null; }
}

/* ---------- carte ---------- */
const IGN = (layer, fmt) => `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&FORMAT=${fmt}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
function initCarte() {
  map = L.map("map", { zoomControl: false, attributionControl: true, minZoom: 8, maxZoom: 17 })
    .fitBounds(G.bounds);
  const plan = L.tileLayer(IGN("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png"), { maxZoom: 19, attribution: "© IGN" });
  const ortho = L.tileLayer(IGN("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg"), { maxZoom: 19, attribution: "© IGN" });
  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenTopoMap, OSM" });
  plan.addTo(map);
  L.control.layers({ "Plan IGN": plan, "Photos aériennes": ortho, "Topographique": topo }, null, { position: "topleft" }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.on("click", detail);
  $("#point-close").onclick = fermePoint;
  window._fonds = { plan, ortho, topo };

  fetch("data/forets_publiques.geojson").then((r) => r.json()).then((gj) => {
    pubLayer = L.geoJSON(gj, { interactive: false, style: { color: "#2f6b3a", weight: 1.4, dashArray: "4 3", fill: false } });
    majPub();
    map.on("zoomend", majPub);
  });
}

// contours des forêts publiques : visibles à partir du zoom 11 pour ne pas surcharger la vue d'ensemble
function majPub() {
  if (!pubLayer) return;
  const voir = $("#chk-pub").checked && map.getZoom() >= 11;
  if (voir && !map.hasLayer(pubLayer)) pubLayer.addTo(map);
  if (!voir && map.hasLayer(pubLayer)) pubLayer.remove();
}

/* ---------- contrôles ---------- */
function controles() {
  $("#seg-mode").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    $("#seg-mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    state.mode = b.dataset.v;
    $("#days").style.display = state.mode === "pousse" && M ? "flex" : "none";
    $(".ramp").classList.toggle("hab", state.mode === "habitat");
    fermePoint();
    dessine();
  }));
  especes();
  $("#chk-pub").onchange = majPub;
  $("#chk-prive").onchange = (e) => { state.prive = e.target.checked; fermePoint(); dessine(); };
  $("#btn-info").onclick = () => $("#panel").classList.add("open");
  $("#btn-close").onclick = () => $("#panel").classList.remove("open");
  let moi;
  $("#btn-gps").onclick = () => {
    if (!navigator.geolocation) return toast("Localisation indisponible");
    toast("Recherche de votre position…");
    navigator.geolocation.getCurrentPosition((p) => {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (moi) moi.remove();
      moi = L.layerGroup([L.circle(ll, { radius: p.coords.accuracy, weight: 1, color: "#1f6feb", fillOpacity: 0.1 }),
        L.circleMarker(ll, { radius: 7, color: "#fff", weight: 2, fillColor: "#1f6feb", fillOpacity: 1 })]).addTo(map);
      map.setView(ll, Math.max(map.getZoom(), 14));
    }, () => toast("Position refusée ou introuvable"), { enableHighAccuracy: true, timeout: 15000 });
  };
  $("#btn-offline").onclick = horsLigne;
}

/* ---------- hors connexion ---------- */
function tuilesZone(bounds, zmin, zmax) {
  const urls = [];
  const fond = map.hasLayer(_fonds.ortho) ? _fonds.ortho : map.hasLayer(_fonds.topo) ? _fonds.topo : _fonds.plan;
  for (let z = zmin; z <= zmax; z++) {
    const a = map.project(bounds.getNorthWest(), z).divideBy(256).floor();
    const b = map.project(bounds.getSouthEast(), z).divideBy(256).floor();
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++)
      urls.push(L.Util.template(fond._url, { z, x, y, s: "a" }));
  }
  return urls;
}
async function horsLigne() {
  const st = $("#offline-status");
  if (!("caches" in window)) return (st.textContent = "Ce navigateur ne permet pas le hors connexion.");
  const z = Math.max(map.getZoom(), 11);
  let urls = [];
  for (let zmax = Math.min(z + 4, 17); zmax >= z; zmax--) { urls = tuilesZone(map.getBounds(), z, zmax); if (urls.length <= 2500) break; }
  if (urls.length > 2500) return (st.textContent = "Zone trop grande : zoomez davantage sur le massif.");
  const cache = await caches.open("onddo-tuiles");
  let ok = 0;
  st.textContent = `Enregistrement de ${urls.length} tuiles…`;
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map((u) => fetch(u, { mode: "cors" }).then((r) => r.ok && cache.put(u, r)).then(() => ok++).catch(() => {})));
    st.textContent = `Enregistrement : ${ok} / ${urls.length} tuiles`;
  }
  // données de l'appli
  const app = await caches.open("onddo-donnees");
  await app.addAll(["data/meteo.json", "data/habitat.png", "data/grid.json", "data/especes.json", "data/forets_publiques.geojson"]).catch(() => {});
  st.textContent = `Zone enregistrée (${ok} tuiles). Elle reste consultable sans réseau.`;
}

/* ---------- démarrage ---------- */
(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  try {
    await charge();
    initCarte(); controles(); jours(); dessine();
  } catch (e) {
    $("#status").textContent = "Erreur de chargement : " + e.message;
    throw e;
  }
})();
