/* Onddo : écrans du carnet de coins (ajout de sortie, liste, coins suivis, alertes, apprentissage, import) */
"use strict";

const QTE = ["Rien trouvé", "Quelques-uns", "Bonne cueillette", "Gros coup"];
const COULEURS = { edulis: "#8a3b12", aereus: "#3b2414", aestivalis: "#c08a3e", pinophilus: "#a3341f", girolle: "#e8a317", hydnum: "#e9d8b4", trompette: "#2d2a33" };
let calqueCarnet = null, onglet = "sorties", importEnCours = null;
const texte = (sel, t) => { const el = $(sel); if (el) el.textContent = t; };
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nomEsp = (id) => (E.especes[id] || {}).nom || "Autre";
const dateFr = (iso) => new Date(iso + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

function initCarnetUI() {
  $("#btn-carnet").onclick = ouvreCarnet;
  $("#btn-ajout").onclick = () => {
    if (!navigator.geolocation) return ouvreAjout(map.getCenter());
    toast("Position en cours…");
    navigator.geolocation.getCurrentPosition((p) => ouvreAjout(L.latLng(p.coords.latitude, p.coords.longitude), p.coords.accuracy),
      () => ouvreAjout(map.getCenter()), { enableHighAccuracy: true, timeout: 12000 });
  };
  map.on("contextmenu", (e) => ouvreAjout(e.latlng)); // appui long
  $("#carnet-fermer").onclick = () => $("#carnet").classList.remove("open");
  $("#ajout-fermer").onclick = () => $("#ajout").classList.remove("open");
  Carnet.surChangement(() => { majCalque(); if ($("#carnet").classList.contains("open")) rendCarnet(); IDX_reset(); });
  Carnet.auto().catch(() => {}).finally(majCalque);
  // le bouton + suit la hauteur du panneau du bas
  const place = () => { const h = document.querySelector(".sheet").offsetHeight; document.documentElement.style.setProperty("--sheet-h", h + "px"); };
  new ResizeObserver(place).observe(document.querySelector(".sheet")); place();
  // ouverture depuis une notification : ?coin=…
  const coin = new URLSearchParams(location.search).get("coin");
  if (coin) Carnet.surChangement(() => { const c = Carnet.data && Carnet.data.coins.find((x) => x.id === coin); if (c && !initCarnetUI.vu) { initCarnetUI.vu = 1; map.setView([c.lat, c.lon], 15); } });
}

// les réglages appris changent l'indice : on recalcule la carte
let reglagesVus = null;
function IDX_reset() {
  const r = Carnet.reglages && Carnet.reglages.genere;
  if (r === reglagesVus) return;
  reglagesVus = r;
  for (const k in IDX) delete IDX[k];
  if (M) dessine();
}

/* ---------- coins et sorties sur la carte ---------- */
function majCalque() {
  if (calqueCarnet) { calqueCarnet.remove(); calqueCarnet = null; }
  $("#btn-carnet").classList.toggle("actif", Carnet.ouvert);
  if (!Carnet.ouvert) return;
  calqueCarnet = L.layerGroup();
  for (const s of Carnet.data.sorties) {
    const vide = !s.qte;
    L.circleMarker([s.lat, s.lon], { radius: vide ? 5 : 6 + (s.qte || 0), color: vide ? "#777" : "#fff", weight: 2, fillColor: vide ? "#fff" : COULEURS[s.esp] || "#555", fillOpacity: vide ? 0.6 : 0.95 })
      .bindTooltip(`${dateFr(s.date)} · ${nomEsp(s.esp)} · ${QTE[s.qte || 0]}`, { direction: "top" })
      .on("click", (e) => { L.DomEvent.stop(e); ficheSortie(s); })
      .addTo(calqueCarnet);
  }
  for (const c of Carnet.data.coins) {
    L.marker([c.lat, c.lon], { icon: L.divIcon({ className: "coin-icone" + (c.alerte ? " suivi" : ""), html: "★", iconSize: [26, 26] }) })
      .bindTooltip(esc(c.nom), { direction: "top" }).on("click", (e) => { L.DomEvent.stop(e); detail({ latlng: L.latLng(c.lat, c.lon) }); })
      .addTo(calqueCarnet);
  }
  calqueCarnet.addTo(map);
}

/* ---------- ajout d'une sortie ---------- */
function ouvreAjout(ll, precision) {
  if (!Carnet.configure) { ouvreCarnet(); toast("Configurez d'abord votre carnet privé"); return; }
  if (!Carnet.ouvert) { ouvreCarnet(); toast("Déverrouillez le carnet"); return; }
  fermePoint();
  const proche = Carnet.coinProche(ll.lat, ll.lng);
  const auj = new Date().toISOString().slice(0, 10);
  $("#ajout-corps").innerHTML = `
    <h2>Noter une sortie</h2>
    <p class="k">Position : ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}${precision ? ` (± ${Math.round(precision)} m)` : ""}${proche ? ` · coin « ${esc(proche.nom)} »` : ""}</p>
    <label class="champ">Date<input type="date" id="a-date" value="${auj}" max="${auj}"></label>
    <label class="champ">Espèce<select id="a-esp">${E.ordre.map((id) => `<option value="${id}"${id === state.esp ? " selected" : ""}>${nomEsp(id)}</option>`).join("")}<option value="autre">Autre</option></select></label>
    <div class="champ">Résultat<div class="seg seg-qte" id="a-qte">${QTE.map((q, i) => `<button data-v="${i}"${i === 1 ? ' class="on"' : ""}>${q}</button>`).join("")}</div></div>
    <label class="champ">Poids (kg, facultatif)<input type="number" id="a-poids" min="0" step="0.1" inputmode="decimal"></label>
    <label class="champ">Note<textarea id="a-note" rows="2" placeholder="sous les hêtres, bord du ruisseau…"></textarea></label>
    <label class="champ">Photo<input type="file" id="a-photo" accept="image/*" capture="environment"></label>
    <label class="chk"><input type="checkbox" id="a-suivre" ${proche ? "checked" : ""}> Suivre ce coin (alertes)</label>
    <label class="champ" id="a-nom-l">Nom du coin<input type="text" id="a-nom" value="${esc(proche ? proche.nom : "")}" placeholder="ex. Hêtraie du col"></label>
    <p class="k">Tout est chiffré sur ce téléphone avant d'être envoyé dans votre dépôt privé.</p>
    <button class="btn" id="a-ok">Enregistrer</button> <span class="k" id="a-etat"></span>`;
  $("#a-qte").querySelectorAll("button").forEach((b) => (b.onclick = () => $("#a-qte").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b))));
  const majNom = () => ($("#a-nom-l").style.display = $("#a-suivre").checked ? "" : "none");
  $("#a-suivre").onchange = majNom; majNom();
  $("#a-ok").onclick = async () => {
    const b = $("#a-ok"); b.disabled = true; texte("#a-etat", "Chiffrement et envoi…");
    try {
      const esp = $("#a-esp").value, qte = +$("#a-qte").querySelector(".on").dataset.v;
      const s = { date: $("#a-date").value || auj, lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6), esp, qte,
        poids: parseFloat($("#a-poids").value) || null, note: $("#a-note").value.trim() };
      let coin = proche;
      if ($("#a-suivre").checked) {
        coin = coin ? { ...coin } : { id: Carnet.uid(), lat: s.lat, lon: s.lon, esp: [], alerte: true, seuil: 50 };
        coin.nom = $("#a-nom").value.trim() || coin.nom || `Coin du ${dateFr(s.date)}`;
        if (esp !== "autre" && !coin.esp.includes(esp)) coin.esp.push(esp);
        await Carnet.majCoin(coin);
      }
      if (coin) s.coin = coin.id;
      await Carnet.ajouteSortie(s, $("#a-photo").files[0]);
      $("#ajout").classList.remove("open");
      toast(Carnet.etat.synchro === "ok" ? "Sortie enregistrée et synchronisée" : "Sortie enregistrée sur le téléphone ; envoi dès que le réseau revient", 3500);
    } catch (e) { texte("#a-etat", "Erreur : " + e.message); b.disabled = false; }
  };
  $("#ajout").classList.add("open");
}
window.ouvreAjout = ouvreAjout;

async function ficheSortie(s) {
  fermePoint();
  let h = `<div class="pt-titre">${dateFr(s.date)}</div><div class="pt-big" style="font-size:22px">${nomEsp(s.esp)} · ${QTE[s.qte || 0]}</div>`;
  if (s.poids) h += `<p class="k">${f1(s.poids)} kg</p>`;
  if (s.note) h += `<p>${esc(s.note)}</p>`;
  if (s.photo) h += `<div id="sortie-photo" class="k">Photo en cours de déchiffrement…</div>`;
  h += `<div class="pt-actions"><button class="btn ghost" id="s-indice">Voir l'indice ici</button> <button class="btn ghost" id="s-suppr">Supprimer</button></div>`;
  $("#point-corps").innerHTML = h; $("#point").classList.add("open");
  $("#s-indice").onclick = () => { if (E.especes[s.esp]) { state.esp = s.esp; especes(); dessine(); } detail({ latlng: L.latLng(s.lat, s.lon) }); };
  $("#s-suppr").onclick = async () => { if (confirmeDouce("#s-suppr")) { await Carnet.supprime("sorties", s.id); fermePoint(); } };
  if (s.photo) Carnet.photo(s.id).then((u) => { const el = $("#sortie-photo"); if (el) el.innerHTML = u ? `<img src="${u}" class="photo">` : "Photo indisponible hors connexion."; }).catch(() => {});
}
// confirmation sans boîte de dialogue : un second appui confirme
function confirmeDouce(sel) {
  const b = $(sel);
  if (b.dataset.arme) return true;
  b.dataset.arme = 1; const t = b.textContent; b.textContent = "Appuyer encore pour confirmer";
  setTimeout(() => { if (b) { delete b.dataset.arme; b.textContent = t; } }, 3000);
  return false;
}

/* ---------- panneau du carnet ---------- */
function ouvreCarnet() { rendCarnet(); $("#carnet").classList.add("open"); }

function rendCarnet() {
  const c = $("#carnet-corps");
  if (!Carnet.configure) return rendInstallation(c);
  if (!Carnet.ouvert) return rendVerrou(c);
  const d = Carnet.data;
  const tabs = [["sorties", `Sorties (${d.sorties.length})`], ["coins", `Coins (${d.coins.length})`], ["alertes", "Alertes"], ["appris", "Apprentissage"], ["import", "Importer"], ["reglages", "Réglages"]];
  c.innerHTML = `<h2>Mon carnet</h2>
    <p class="k">${Carnet.etat.synchro === "ok" ? "✓ Synchronisé avec votre dépôt privé" : Carnet.etat.synchro === "hors-ligne" ? "Hors connexion : envoi au retour du réseau" : "⚠ Synchronisation en échec : réessayez"} · ${esc(Carnet.cfg.owner)}/${esc(Carnet.cfg.repo)}</p>
    <div class="chips onglets">${tabs.map(([k, t]) => `<button class="chip${k === onglet ? " on" : ""}" data-o="${k}">${t}</button>`).join("")}</div>
    <div id="onglet"></div>`;
  c.querySelectorAll("[data-o]").forEach((b) => (b.onclick = () => { onglet = b.dataset.o; rendCarnet(); }));
  ({ sorties: rendSorties, coins: rendCoins, alertes: rendAlertes, appris: rendAppris, import: rendImport, reglages: rendReglages })[onglet]($("#onglet"));
}

function rendInstallation(c) {
  c.innerHTML = `<h2>Carnet de coins privé</h2>
    <p>Vos sorties sont chiffrées sur ce téléphone avec votre phrase secrète, puis rangées dans votre dépôt GitHub <b>privé</b>. Ni le site public, ni GitHub, ni Claude ne peuvent les lire.</p>
    <h3>1. Clé d'accès au dépôt privé</h3>
    <ol class="petit">
      <li>Sur GitHub : photo de profil → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
      <li>Nom : <i>Onddo téléphone</i> ; durée : la plus longue proposée.</li>
      <li><b>Repository access</b> : <i>Only select repositories</i> → <b>onddo-carnet</b> uniquement.</li>
      <li><b>Permissions</b> (Repository) : <b>Contents</b>, <b>Workflows</b> et <b>Actions</b> en <i>Read and write</i>.</li>
      <li>Générez, copiez la clé (elle commence par <code>github_pat_</code>) et collez-la ci-dessous.</li>
    </ol>
    <label class="champ">Compte GitHub<input id="i-owner" value="Kauna64" autocapitalize="off"></label>
    <label class="champ">Dépôt privé<input id="i-repo" value="onddo-carnet" autocapitalize="off"></label>
    <label class="champ">Clé d'accès<input id="i-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
    <h3>2. Phrase secrète</h3>
    <p class="petit">La même que celle enregistrée dans le secret <code>ONDDO_PHRASE</code> du dépôt privé. Elle ne quitte jamais ce téléphone.</p>
    <label class="champ">Phrase secrète<input id="i-phrase" type="password" autocomplete="off"></label>
    <label class="chk"><input type="checkbox" id="i-souvenir" checked> Se souvenir sur ce téléphone</label>
    <p><button class="btn" id="i-ok">Connecter le carnet</button></p><p class="k" id="i-etat"></p>`;
  $("#i-ok").onclick = async () => {
    texte("#i-etat", "Vérification…"); $("#i-ok").disabled = true;
    try {
      await Carnet.installe($("#i-owner").value, $("#i-repo").value, $("#i-token").value, $("#i-phrase").value, $("#i-souvenir").checked);
      toast("Carnet connecté"); rendCarnet();
    } catch (e) { texte("#i-etat", e.message); $("#i-ok").disabled = false; }
  };
}
function rendVerrou(c) {
  c.innerHTML = `<h2>Carnet verrouillé</h2><p>Entrez votre phrase secrète pour déchiffrer le carnet.</p>
    <label class="champ">Phrase secrète<input id="v-phrase" type="password" autocomplete="off"></label>
    <label class="chk"><input type="checkbox" id="v-souvenir" checked> Se souvenir sur ce téléphone</label>
    <p><button class="btn" id="v-ok">Déverrouiller</button> <button class="btn ghost" id="v-oubli">Changer de dépôt</button></p><p class="k" id="v-etat"></p>`;
  $("#v-ok").onclick = async () => {
    texte("#v-etat", "Déchiffrement…");
    try { await Carnet.deverrouille($("#v-phrase").value, $("#v-souvenir").checked); rendCarnet(); }
    catch (e) { texte("#v-etat", e.message); }
  };
  $("#v-oubli").onclick = async () => { await Carnet.verrouille(true); rendCarnet(); };
}

function rendSorties(o) {
  const s = [...Carnet.data.sorties].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!s.length) { o.innerHTML = `<p>Aucune sortie. Touchez <b>＋</b> sur la carte (ou appuyez longuement sur un endroit) pour noter une sortie, ou importez vos anciennes sorties.</p>`; return; }
  o.innerHTML = `<ul class="liste">${s.map((x) => `<li data-id="${x.id}"><span class="pastille" style="background:${x.qte ? COULEURS[x.esp] || "#555" : "#fff"}"></span>
      <div><b>${dateFr(x.date)}</b> · ${nomEsp(x.esp)}<br><span class="k">${QTE[x.qte || 0]}${x.poids ? ` · ${f1(x.poids)} kg` : ""}${x.note ? " · " + esc(x.note.slice(0, 60)) : ""}${x.photo ? " · 📷" : ""}</span></div></li>`).join("")}</ul>`;
  o.querySelectorAll("li").forEach((li) => (li.onclick = () => {
    const x = Carnet.data.sorties.find((y) => y.id === li.dataset.id);
    $("#carnet").classList.remove("open"); map.setView([x.lat, x.lon], 15); ficheSortie(x);
  }));
}

function rendCoins(o) {
  const cs = Carnet.data.coins;
  if (!cs.length) { o.innerHTML = `<p>Aucun coin suivi. En notant une sortie, cochez « Suivre ce coin » pour recevoir des alertes.</p>`; return; }
  o.innerHTML = cs.map((c) => `<div class="coin" data-id="${c.id}">
      <div class="row"><input class="c-nom" value="${esc(c.nom)}"><button class="btn ghost c-voir">Voir</button></div>
      <label class="chk"><input type="checkbox" class="c-alerte" ${c.alerte ? "checked" : ""}> Alertes</label>
      <label class="champ">Seuil d'alerte : <b class="c-sv">${c.seuil || 50}</b>/100<input type="range" class="c-seuil" min="20" max="90" step="5" value="${c.seuil || 50}"></label>
      <div class="chips">${E.ordre.map((id) => `<button class="chip petit${(c.esp || []).includes(id) ? " on" : ""}" data-e="${id}">${nomEsp(id)}</button>`).join("")}</div>
      <button class="btn ghost c-suppr">Supprimer ce coin</button></div>`).join("");
  o.querySelectorAll(".coin").forEach((el) => {
    const c = () => ({ ...Carnet.data.coins.find((x) => x.id === el.dataset.id) });
    el.querySelector(".c-nom").onchange = (e) => Carnet.majCoin({ ...c(), nom: e.target.value.trim() || "Coin" });
    el.querySelector(".c-alerte").onchange = (e) => Carnet.majCoin({ ...c(), alerte: e.target.checked });
    el.querySelector(".c-seuil").oninput = (e) => (el.querySelector(".c-sv").textContent = e.target.value);
    el.querySelector(".c-seuil").onchange = (e) => Carnet.majCoin({ ...c(), seuil: +e.target.value });
    el.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => {
      const x = c(); const s = new Set(x.esp || []); s.has(b.dataset.e) ? s.delete(b.dataset.e) : s.add(b.dataset.e);
      Carnet.majCoin({ ...x, esp: [...s] });
    }));
    el.querySelector(".c-voir").onclick = () => { const x = c(); $("#carnet").classList.remove("open"); map.setView([x.lat, x.lon], 15); detail({ latlng: L.latLng(x.lat, x.lon) }); };
    el.querySelector(".c-suppr").onclick = (e) => { e.target.id = "c-suppr-" + el.dataset.id; if (confirmeDouce("#" + e.target.id)) Carnet.supprime("coins", el.dataset.id); };
  });
}

function rendAlertes(o) {
  const a = Carnet.alertes, push = Carnet.data.push || {};
  const nb = (push.abonnements || []).length;
  let h = `<p>Chaque matin vers 7 h, votre dépôt privé calcule l'indice des 8 prochains jours sur vos coins suivis et vous envoie une notification quand il dépasse le seuil du coin.</p>
    <p><button class="btn" id="al-notif">${nb ? "Réactiver les notifications sur ce téléphone" : "Activer les notifications"}</button> <span class="k" id="al-etat">${nb ? `${nb} appareil(s) abonné(s)` : ""}</span></p>`;
  if (a && a.liste) {
    h += `<p class="k">Calcul du ${new Date(a.genere).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</p>`;
    h += `<ul class="liste">${[...a.liste].sort((x, y) => y.indice - x.indice).map((x) => `<li><span class="pastille" style="background:rgb(${rampe(x.indice / 100)})"></span><div><b>${esc(x.nom)}</b> · ${nomEsp(x.esp)}<br>
      <span class="k">max ${x.indice}/100 le ${dateFr(x.jour)}</span> ${mini(x.serie)}</div></li>`).join("")}</ul>`;
    if ((a.erreurs_push || []).length) h += `<p class="k">⚠ ${a.erreurs_push.length} notification(s) non remise(s) : réactivez les notifications sur ce téléphone.</p>`;
  } else h += `<p class="k">Pas encore de calcul : il aura lieu demain matin, ou maintenant avec le bouton ci-dessous.</p>`;
  h += `<p><button class="btn ghost" id="al-run">Calculer maintenant</button> <span class="k" id="al-run-etat"></span></p>`;
  o.innerHTML = h;
  $("#al-notif").onclick = async () => {
    texte("#al-etat", "Activation…");
    try { await Carnet.activeNotifications(); texte("#al-etat", "Notifications activées ✓"); }
    catch (e) { texte("#al-etat", e.message); }
  };
  $("#al-run").onclick = () => lanceCalcul(false, "#al-run-etat");
}
function mini(serie) {
  if (!serie) return "";
  return `<svg width="${serie.length * 7}" height="16" style="vertical-align:middle">${serie.map((v, i) => `<rect x="${i * 7}" y="${16 - Math.max(1, v / 100 * 16)}" width="5" height="${Math.max(1, v / 100 * 16)}" fill="${v < 12 ? "#cbbfae" : `rgb(${rampe(v / 100)})`}"/>`).join("")}</svg>`;
}
async function lanceCalcul(apprendre, sel) {
  texte(sel, "Lancement…");
  try {
    await Carnet.lanceTache(apprendre);
    texte(sel, "Calcul lancé dans votre dépôt privé (2 à 5 min). Revenez ici ensuite.");
    setTimeout(() => Carnet.chargeAnnexes(), 240000);
  } catch (e) { texte(sel, e.status === 403 || e.status === 404 ? "La clé d'accès n'a pas le droit « Actions » ou « Workflows »." : "Échec : " + e.message); }
}

function rendAppris(o) {
  const r = Carnet.reglages, d = Carnet.data;
  const n = d.sorties.filter((s) => E.especes[s.esp]).length, npos = d.sorties.filter((s) => s.qte > 0).length;
  let h = `<p>L'appli recale seule, dans votre dépôt privé, un réglage par espèce et par secteur (côte sous 300 m, piémont, montagne au-dessus de 900 m) :
    elle cherche le décalage de température et le besoin en pluie qui placent vos récoltes sur les meilleurs jours de la saison, et vos sorties vides sur les moins bons.
    Il faut au moins <b>3 récoltes</b> d'une espèce ; les sorties « rien trouvé » sont aussi précieuses.</p>
    <p class="k">${npos} récoltes et ${n - npos} sorties vides notées.</p>`;
  if (r && r.reglages && Object.keys(r.reglages).length) {
    const SECT = { cote: "côte", piemont: "piémont", montagne: "montagne", "*": "tout le département" };
    h += `<ul class="liste">${Object.entries(r.reglages).flatMap(([esp, ss]) => Object.entries(ss).map(([s, x]) => `<li><div><b>${nomEsp(esp)}</b> · ${SECT[s]}<br><span class="k">${x.n} récoltes, ${x.n_vides} vides ·
      ${x.dT || x.k !== 1 ? `${x.dT ? `température ${x.dT > 0 ? "+" : ""}${x.dT} °C` : ""}${x.dT && x.k !== 1 ? ", " : ""}${x.k !== 1 ? `pluie ×${f1(x.k)}` : ""}` : "réglage de base confirmé"}
      · qualité ${Math.round(100 * x.score_base)} → ${Math.round(100 * x.score)}</span></div></li>`)).join("")}</ul>
      <p class="k">Recalage du ${new Date(r.genere).toLocaleDateString("fr-FR")}. Ces réglages s'appliquent à la carte quand le carnet est ouvert.</p>`;
  } else h += `<p class="k">Pas encore de réglage appris.</p>`;
  h += `<p><button class="btn ghost" id="ap-run">Recaler maintenant</button> <span class="k" id="ap-etat"></span></p>`;
  o.innerHTML = h;
  $("#ap-run").onclick = () => lanceCalcul(true, "#ap-etat");
}

function rendImport(o) {
  o.innerHTML = `<p>Importez vos anciennes sorties : fichier <b>CSV</b> (colonnes date, latitude, longitude, espèce, quantité, note) ou <b>GPX</b> (points enregistrés dans une appli de randonnée ou de GPS : le nom ou la description doit citer l'espèce).
    Le fichier est lu et chiffré sur ce téléphone ; il n'est envoyé nulle part en clair.</p>
    <p class="k">Exemple de CSV :<br><code>date;latitude;longitude;espece;quantite;note<br>22/09/2024;43.0412;-1.0731;cèpe de Bordeaux;2 kg;sous les hêtres<br>05/10/2024;43.4267;-1.5197;girolle;rien;</code></p>
    <input type="file" id="imp-f" accept=".csv,.txt,.gpx,text/csv,application/gpx+xml"><div id="imp-apercu"></div>`;
  $("#imp-f").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const liste = Carnet.lisFichier(f.name, await f.text());
    importEnCours = liste.filter((x) => x.ok);
    const ko = liste.length - importEnCours.length, sansEsp = importEnCours.filter((x) => !x.esp).length;
    $("#imp-apercu").innerHTML = `<p><b>${importEnCours.length}</b> sorties lisibles${ko ? `, ${ko} ignorées (date ou position manquante, ou hors du 64)` : ""}${sansEsp ? `, dont ${sansEsp} sans espèce reconnue (classées « Autre »)` : ""}.</p>
      <ul class="liste">${importEnCours.slice(0, 8).map((x) => `<li><div><b>${x.date ? dateFr(x.date) : "?"}</b> · ${nomEsp(x.esp)} · ${QTE[x.qte]}<br><span class="k">${x.lat.toFixed(4)}, ${x.lon.toFixed(4)} ${esc(x.note || "")}</span></div></li>`).join("")}</ul>
      ${importEnCours.length > 8 ? `<p class="k">… et ${importEnCours.length - 8} autres.</p>` : ""}
      ${importEnCours.length ? `<button class="btn" id="imp-ok">Importer ces ${importEnCours.length} sorties</button>` : ""} <span class="k" id="imp-etat"></span>`;
    const b = $("#imp-ok");
    if (b) b.onclick = async () => {
      b.disabled = true; texte("#imp-etat", "Chiffrement et envoi…");
      onglet = "sorties";
      try { await Carnet.importe(importEnCours.map((x) => ({ ...x, esp: x.esp || "autre" }))); texte("#imp-etat", "Importé ✓ Le recalage se fera dans votre dépôt privé."); }
      catch (err) { texte("#imp-etat", "Erreur : " + err.message); b.disabled = false; }
    };
  };
}

function rendReglages(o) {
  o.innerHTML = `<p><button class="btn ghost" id="r-sync">Synchroniser maintenant</button></p>
    <p><button class="btn ghost" id="r-verrou">Verrouiller le carnet</button> <span class="k">La phrase sera redemandée.</span></p>
    <p><button class="btn ghost" id="r-oubli">Déconnecter ce téléphone</button> <span class="k">Efface la clé d'accès et la copie locale ; le dépôt privé n'est pas touché.</span></p>
    <p class="k">Sécurité : quiconque a votre téléphone déverrouillé peut ouvrir le carnet si « se souvenir » est coché. La clé d'accès GitHub ne donne accès qu'au dépôt ${esc(Carnet.cfg.repo)}.</p>`;
  $("#r-sync").onclick = () => Carnet.synchro().then(() => toast(Carnet.etat.synchro === "ok" ? "Synchronisé" : "Échec de synchronisation"));
  $("#r-verrou").onclick = async () => { await Carnet.verrouille(false); rendCarnet(); };
  $("#r-oubli").onclick = async () => { if (confirmeDouce("#r-oubli")) { await Carnet.verrouille(true); rendCarnet(); } };
}
