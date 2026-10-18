/* Onddo : recherche d'un lieu (commune, lieu-dit, forêt, ruisseau, sommet, col…) dans les Pyrénées-Atlantiques.
   Sources : géocodeur de l'IGN (Géoplateforme : adresses et toponymes de la BD TOPO), forêts publiques et vos coins
   (ces deux dernières fonctionnent aussi sans réseau). */
"use strict";

const Recherche = (() => {
  const API = "https://data.geopf.fr/geocodage/search";
  let minuterie = null, controle = null, repere = null, derniers = [];
  const sansAccent = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const premier = (x) => (Array.isArray(x) ? x[0] : x) || "";

  // libellés lisibles des catégories IGN
  function genre(cat) {
    const c = sansAccent([].concat(cat || []).join(" "));
    if (/cours d.eau|ruisseau|riviere|torrent|gave|canal|source|cascade|lac|etang|plan d.eau/.test(c)) return "💧";
    if (/bois|foret|massif/.test(c)) return "🌲";
    if (/sommet|pic|mont|col|cret|montagne|relief|orograph/.test(c)) return "⛰";
    if (/lieu-dit|hameau|quartier|ferme|habit/.test(c)) return "🏠";
    if (/commune|ville|localit|municipal/.test(c)) return "🏘";
    return "📍";
  }

  async function ign(q, index) {
    const p = new URLSearchParams({ q, index, limit: "12", lat: "43.2", lon: "-0.8", autocomplete: "1" });
    if (index === "poi") p.set("depcode", "64");
    const r = await fetch(`${API}?${p}`, { signal: controle.signal });
    if (!r.ok) throw new Error("IGN " + r.status);
    const d = await r.json();
    return (d.features || []).map((f) => {
      const pr = f.properties || {}, [lon, lat] = f.geometry.coordinates;
      const cp = String(premier(pr.postcode) || premier(pr.citycode) || "");
      return {
        nom: premier(pr.toponym) || premier(pr.name) || pr.label || "",
        detail: index === "poi" ? [[].concat(pr.category || []).filter((x) => !/zone d|element topo|élément topo/i.test(x)).slice(0, 2).join(", "), premier(pr.city)].filter(Boolean).join(" · ") : [pr.type === "municipality" ? "commune" : "", pr.city !== pr.name ? pr.city : "", cp].filter(Boolean).join(" · "),
        icone: index === "poi" ? genre(pr.category) : pr.type === "municipality" ? "🏘" : "🏠",
        lat, lon, bbox: f.bbox, zoom: index === "poi" ? 15 : pr.type === "municipality" ? 13 : 16,
        dep: cp.slice(0, 2), score: pr.score || 0,
      };
    }).filter((x) => !x.dep || x.dep === "64");
  }

  // forêts publiques et coins du carnet : disponibles même sans réseau
  function locaux(q) {
    const s = sansAccent(q), out = [];
    if (typeof pubLayer !== "undefined" && pubLayer) pubLayer.eachLayer((l) => {
      const n = l.feature.properties.nom;
      if (sansAccent(n).includes(s)) { const c = l.getBounds().getCenter(); out.push({ nom: n, detail: "forêt publique", icone: "🌳", lat: c.lat, lon: c.lng, bornes: l.getBounds(), score: 1 }); }
    });
    if (typeof Carnet !== "undefined" && Carnet.ouvert) for (const c of Carnet.data.coins) {
      if (sansAccent(c.nom).includes(s)) out.push({ nom: c.nom, detail: "mon coin", icone: "★", lat: c.lat, lon: c.lon, zoom: 16, score: 2 });
    }
    return out.slice(0, 8);
  }

  async function cherche(q) {
    if (controle) controle.abort();
    controle = new AbortController();
    const loc = locaux(q);
    affiche(loc, navigator.onLine ? "Recherche…" : "Hors connexion : forêts publiques et vos coins seulement.");
    if (!navigator.onLine) return;
    try {
      const [poi, adr] = await Promise.allSettled([ign(q, "poi"), ign(q, "address")]);
      const tout = [...loc, ...(poi.value || []), ...(adr.value || [])];
      // dédoublonnage : même nom à moins de 300 m
      const res = [];
      for (const r of tout) if (!res.some((x) => sansAccent(x.nom) === sansAccent(r.nom) && L.latLng(x.lat, x.lon).distanceTo([r.lat, r.lon]) < 300)) res.push(r);
      affiche(res.slice(0, 15), res.length ? "" : "Aucun lieu trouvé dans les Pyrénées-Atlantiques.");
    } catch (e) { if (e.name !== "AbortError") affiche(loc, "Recherche IGN indisponible."); }
  }

  function affiche(liste, message) {
    derniers = liste;
    $("#rech-res").innerHTML = liste.map((r, i) => `<li data-i="${i}"><span class="r-ic">${r.icone}</span><div><b>${esc(r.nom)}</b><br><span class="k">${esc(r.detail)}</span></div></li>`).join("")
      + (message ? `<li class="k r-msg">${esc(message)}</li>` : "");
    $("#rech-res").querySelectorAll("li[data-i]").forEach((li) => (li.onclick = () => va(derniers[+li.dataset.i])));
  }

  function va(r) {
    ferme();
    if (r.bornes) map.fitBounds(r.bornes, { maxZoom: 15 });
    else if (r.bbox && r.bbox.length === 4 && r.bbox[0] !== r.bbox[2]) map.fitBounds([[r.bbox[1], r.bbox[0]], [r.bbox[3], r.bbox[2]]], { maxZoom: 16, padding: [30, 30] });
    else map.setView([r.lat, r.lon], r.zoom || 14);
    if (repere) repere.remove();
    repere = L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "rech-icone", html: "📍", iconSize: [28, 28], iconAnchor: [14, 26] }) })
      .bindTooltip(esc(r.nom), { permanent: true, direction: "top", offset: [0, -24] }).addTo(map);
    repere.on("click", () => detail({ latlng: L.latLng(r.lat, r.lon) }));
    setTimeout(() => repere && map.once("movestart", () => { if (repere) { repere.remove(); repere = null; } }), 1500);
  }

  function ouvre() {
    $("#recherche").classList.add("open");
    const i = $("#rech-q"); i.value = ""; $("#rech-res").innerHTML = `<li class="k r-msg">Commune, lieu-dit, forêt, ruisseau, sommet, col… dans le 64.</li>`;
    setTimeout(() => i.focus(), 50);
  }
  function ferme() { $("#recherche").classList.remove("open"); $("#rech-q").blur(); }

  function init() {
    $("#btn-rech").onclick = ouvre;
    $("#rech-fermer").onclick = ferme;
    $("#rech-q").oninput = (e) => {
      clearTimeout(minuterie);
      const q = e.target.value.trim();
      if (q.length < 2) return;
      minuterie = setTimeout(() => cherche(q), 280);
    };
    $("#rech-q").onkeydown = (e) => { if (e.key === "Enter" && derniers[0]) va(derniers[0]); if (e.key === "Escape") ferme(); };
  }
  return { init };
})();
