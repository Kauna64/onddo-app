/* Onddo : carnet de coins.
   Tout est chiffré sur le téléphone (AES-GCM 256, clé tirée de votre phrase secrète par PBKDF2) avant d'être
   envoyé dans votre dépôt GitHub privé. Le site public ne contient jamais vos coins. */
"use strict";

const Carnet = (() => {
  const ITER = 210000;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64utf8 = (txt) => { const u = te.encode(txt); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64utf8 = (s) => td.decode(unb64(s.replace(/\n/g, "")));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  let cfg = null;          // { owner, repo, token, branche }
  let cle = null, sel = null;
  let data = null;         // { version, sorties, coins, push, supprimes, modif }
  let sha = null;          // version du fichier distant
  let reglages = null, alertes = null;
  const ecouteurs = [];

  /* ---------- petit stockage local (IndexedDB) ---------- */
  const idb = (() => {
    let db;
    const ouvre = () => db || (db = new Promise((ok, ko) => {
      const r = indexedDB.open("onddo", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    }));
    const tx = async (mode, f) => { const d = await ouvre(); return new Promise((ok, ko) => { const t = d.transaction("kv", mode); const r = f(t.objectStore("kv")); t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); }); };
    return { get: (k) => tx("readonly", (s) => s.get(k)), set: (k, v) => tx("readwrite", (s) => s.put(v, k)), del: (k) => tx("readwrite", (s) => s.delete(k)) };
  })();

  try { cfg = JSON.parse(localStorage.getItem("onddo-carnet") || "null"); } catch (_) { cfg = null; }
  const sauveCfg = () => { try { localStorage.setItem("onddo-carnet", JSON.stringify(cfg)); } catch (_) {} };

  /* ---------- chiffrement ---------- */
  async function derive(phrase, selB64) {
    const base = await crypto.subtle.importKey("raw", te.encode(phrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(selB64), iterations: ITER }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function chiffre(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cle, te.encode(JSON.stringify(obj)));
    return { v: 1, alg: "AES-GCM", kdf: "PBKDF2-SHA256", iter: ITER, sel, iv: b64(iv), ct: b64(ct) };
  }
  async function dechiffre(env) {
    const clair = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) }, cle, unb64(env.ct));
    return JSON.parse(td.decode(clair));
  }

  /* ---------- GitHub ---------- */
  async function gh(methode, chemin, corps) {
    const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${chemin}`, {
      method: methode, cache: "no-store",
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    if (r.status === 404) return null;
    if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
    return r.status === 204 ? {} : r.json();
  }
  async function lit(chemin) {
    const r = await gh("GET", `/contents/${chemin}?ref=${cfg.branche || "main"}`);
    if (!r) return null;
    let texte;
    if (r.content) texte = unb64utf8(r.content);
    else { const b = await gh("GET", `/git/blobs/${r.sha}`); texte = unb64utf8(b.content); } // fichiers > 1 Mo
    return { texte, sha: r.sha };
  }
  const ecrit = (chemin, texte, shaPrec, message) =>
    gh("PUT", `/contents/${chemin}`, { message, content: b64utf8(texte), sha: shaPrec || undefined, branch: cfg.branche || "main" });

  /* ---------- installation et déverrouillage ---------- */
  async function installe(owner, repo, token, phrase, souvenir) {
    cfg = { owner: owner.trim(), repo: repo.trim(), token: token.trim() };
    const info = await gh("GET", "");
    if (!info) throw new Error("Dépôt introuvable : vérifiez le nom et les droits de la clé d'accès.");
    if (!info.private) throw new Error("Ce dépôt est PUBLIC : le carnet doit aller dans un dépôt privé.");
    cfg.branche = info.default_branch || "main";
    const c = await lit("cle.json");
    if (c) {
      await deverrouille(phrase, souvenir, JSON.parse(c.texte));
    } else {
      sel = b64(crypto.getRandomValues(new Uint8Array(16)));
      cle = await derive(phrase, sel);
      const verif = await chiffre("onddo");
      await ecrit("cle.json", JSON.stringify({ sel, verif }, null, 1), null, "Onddo : création du carnet chiffré");
      data = { version: 1, sorties: [], coins: [], push: {}, supprimes: [], modif: Date.now() };
      await ecrit("carnet.enc", JSON.stringify(await chiffre(data)), null, "Onddo : carnet vide");
      if (souvenir) await idb.set("cle", { cle, sel, depot: `${cfg.owner}/${cfg.repo}` });
    }
    sauveCfg();
    await installeTache();
    await charge();
  }
  async function installeTache() {
    try {
      const modele = await fetch("carnet/onddo.yml", { cache: "no-store" }).then((r) => r.text());
      const ex = await lit(".github/workflows/onddo.yml");
      if (ex && ex.texte === modele) return true;
      await ecrit(".github/workflows/onddo.yml", modele, ex && ex.sha, "Onddo : tâche d'alertes et d'apprentissage");
      return true;
    } catch (e) {
      console.warn("tâche non installée", e);
      return false;
    }
  }
  async function deverrouille(phrase, souvenir, cleJson) {
    cleJson = cleJson || JSON.parse((await lit("cle.json")).texte);
    sel = cleJson.sel;
    cle = await derive(phrase, sel);
    try { if ((await dechiffre(cleJson.verif)) !== "onddo") throw 0; }
    catch (_) { cle = null; throw new Error("Phrase secrète incorrecte."); }
    if (souvenir) await idb.set("cle", { cle, sel, depot: `${cfg.owner}/${cfg.repo}` });
    await charge();
  }
  async function auto() {
    if (!cfg) return false;
    const k = await idb.get("cle").catch(() => null);
    if (!k || k.depot !== `${cfg.owner}/${cfg.repo}`) return false;
    cle = k.cle; sel = k.sel;
    await charge();
    return true;
  }
  async function verrouille(oublier) {
    cle = null; data = null; reglages = null; alertes = null;
    await idb.del("cle");
    if (oublier) await idb.del("local"); // la copie locale (chiffrée) garde les sorties pas encore envoyées
    if (oublier) { cfg = null; try { localStorage.removeItem("onddo-carnet"); } catch (_) {} }
    previent();
  }

  /* ---------- lecture, fusion, synchronisation ---------- */
  function fusionne(a, b) {
    if (!a) return b; if (!b) return a;
    const sup = new Set([...(a.supprimes || []), ...(b.supprimes || [])]);
    const unit = (x, y) => {
      const m = new Map();
      for (const e of [...(x || []), ...(y || [])]) { const p = m.get(e.id); if (!p || (e.modif || 0) >= (p.modif || 0)) m.set(e.id, e); }
      return [...m.values()].filter((e) => !sup.has(e.id));
    };
    const pushA = a.push || {}, pushB = b.push || {};
    const ab = new Map([...(pushA.abonnements || []), ...(pushB.abonnements || [])].map((s) => [s.endpoint, s]));
    return {
      version: 1, sorties: unit(a.sorties, b.sorties), coins: unit(a.coins, b.coins), supprimes: [...sup],
      push: { vapid: pushA.vapid || pushB.vapid, abonnements: [...ab.values()] }, modif: Math.max(a.modif || 0, b.modif || 0),
    };
  }
  async function charge() {
    const local = await idb.get("local").catch(() => null);
    let loc = null;
    if (local && local.depot === `${cfg.owner}/${cfg.repo}`) { try { loc = await dechiffre(local.env); } catch (_) {} }
    let dist = null;
    try {
      const f = await lit("carnet.enc");
      if (f) { dist = await dechiffre(JSON.parse(f.texte)); sha = f.sha; }
    } catch (e) { if (e.status === 401) throw new Error("Clé d'accès GitHub refusée (expirée ?)."); }
    data = fusionne(dist, loc) || { version: 1, sorties: [], coins: [], push: {}, supprimes: [] };
    if (local && local.enAttente) await synchro();
    chargeAnnexes();
    previent();
  }
  async function chargeAnnexes() {
    try { const r = await lit("reglages.enc"); reglages = r ? await dechiffre(JSON.parse(r.texte)) : null; } catch (_) {}
    try { const a = await lit("alertes.enc"); alertes = a ? await dechiffre(JSON.parse(a.texte)) : null; } catch (_) {}
    previent();
  }
  let synchroEnCours = null;
  async function enregistre() {
    data.modif = Date.now();
    await idb.set("local", { depot: `${cfg.owner}/${cfg.repo}`, env: await chiffre(data), enAttente: true });
    previent();
    return synchro();
  }
  async function synchro() {
    if (synchroEnCours) return synchroEnCours;
    synchroEnCours = (async () => {
      for (let essai = 0; essai < 4; essai++) {
        try {
          const f = await lit("carnet.enc");
          if (f && f.sha !== sha) { data = fusionne(await dechiffre(JSON.parse(f.texte)), data); }
          const r = await ecrit("carnet.enc", JSON.stringify(await chiffre(data)), f && f.sha, "Onddo : carnet mis à jour");
          sha = r.content.sha;
          await idb.set("local", { depot: `${cfg.owner}/${cfg.repo}`, env: await chiffre(data), enAttente: false });
          etat.synchro = "ok"; previent(); return true;
        } catch (e) {
          if (e.status === 409 || e.status === 422) continue; // quelqu'un a écrit entre-temps : on refusionne
          etat.synchro = navigator.onLine ? "erreur" : "hors-ligne"; previent(); return false;
        }
      }
      return false;
    })();
    try { return await synchroEnCours; } finally { synchroEnCours = null; }
  }
  window.addEventListener("online", () => data && synchro());

  /* ---------- sorties, coins, photos ---------- */
  async function ajouteSortie(s, photo) {
    s = { id: uid(), cree: Date.now(), modif: Date.now(), ...s };
    if (photo) { try { await envoiePhoto(s.id, photo); s.photo = true; } catch (_) { s.photo = false; } }
    data.sorties.push(s);
    return enregistre().then(() => s);
  }
  async function supprime(type, id) {
    data[type] = data[type].filter((x) => x.id !== id);
    data.supprimes = [...new Set([...(data.supprimes || []), id])];
    return enregistre();
  }
  async function majCoin(c) { c.modif = Date.now(); const i = data.coins.findIndex((x) => x.id === c.id); if (i >= 0) data.coins[i] = c; else data.coins.push(c); return enregistre(); }
  function coinProche(lat, lon, m = 150) {
    return data.coins.find((c) => L.latLng(lat, lon).distanceTo([c.lat, c.lon]) <= m);
  }
  async function compressePhoto(fichier) {
    const img = await createImageBitmap(fichier);
    const k = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  }
  async function envoiePhoto(id, fichier) {
    const url = await compressePhoto(fichier);
    await ecrit(`photos/${id}.enc`, JSON.stringify(await chiffre({ image: url })), null, "Onddo : photo");
  }
  async function photo(id) {
    const f = await lit(`photos/${id}.enc`);
    return f ? (await dechiffre(JSON.parse(f.texte))).image : null;
  }

  /* ---------- notifications ---------- */
  async function activeNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Notifications impossibles ici : ouvrez Onddo depuis son icône sur l'écran d'accueil (iOS 16.4 ou plus).");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications refusées dans les réglages du téléphone.");
    data.push = data.push || {};
    if (!data.push.vapid) {
      const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
      const pub = await crypto.subtle.exportKey("raw", paire.publicKey);
      data.push.vapid = { d: jwk.d, x: jwk.x, y: jwk.y, pub: b64url(pub) };
    }
    const reg = await navigator.serviceWorker.ready;
    const cleServeur = Uint8Array.from(atob(data.push.vapid.pub.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (data.push.vapid.pub.length % 4)) % 4)), (c) => c.charCodeAt(0));
    let ab = await reg.pushManager.getSubscription();
    if (ab) {
      const k = ab.options && ab.options.applicationServerKey && b64url(ab.options.applicationServerKey);
      if (k && k !== data.push.vapid.pub) { await ab.unsubscribe(); ab = null; }
    }
    if (!ab) ab = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleServeur });
    const j = ab.toJSON();
    data.push.abonnements = [...(data.push.abonnements || []).filter((x) => x.endpoint !== j.endpoint), j];
    await enregistre();
  }
  async function lanceTache(apprendre) {
    await installeTache();
    await gh("POST", "/actions/workflows/onddo.yml/dispatches", { ref: cfg.branche || "main", inputs: { apprendre: apprendre ? "true" : "false" } });
  }

  /* ---------- import de fichiers (CSV, GPX) ---------- */
  const ESP_MOTS = [[/bordeaux|edulis/, "edulis"], [/n[eè]gre|aereus|bronz/, "aereus"], [/[eé]t[eé]\b|aestivalis|reticulatus/, "aestivalis"],
    [/pin|pinophilus/, "pinophilus"], [/girolle|chanterelle|cibarius/, "girolle"], [/mouton|hydnum|pied/, "hydnum"],
    [/trompette|cornucopioides/, "trompette"], [/c[eè]pe|bolet/, "edulis"]];
  const espDe = (t) => { t = (t || "").toLowerCase(); for (const [re, e] of ESP_MOTS) if (re.test(t)) return e; return null; };
  const qteDe = (t) => {
    t = String(t ?? "").toLowerCase().trim();
    if (t === "" ) return 1;
    if (/rien|aucun|vide|bredouille|^0$/.test(t)) return 0;
    const n = parseFloat(t.replace(",", ".")); if (!isNaN(n)) return n <= 0 ? 0 : n < 1 ? 1 : n < 3 ? 2 : 3;
    if (/gros|beaucoup|panier/.test(t)) return 3; if (/bonne|bien/.test(t)) return 2; return 1;
  };
  const dateDe = (t) => {
    t = (t || "").trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if (m) { const a = m[3].length === 2 ? "20" + m[3] : m[3]; return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
    return null;
  };
  function lisFichier(nom, texte) {
    const res = [];
    if (/\.gpx$/i.test(nom) || texte.includes("<gpx")) {
      const doc = new DOMParser().parseFromString(texte, "application/xml");
      for (const w of doc.querySelectorAll("wpt")) {
        const t = (s) => (w.querySelector(s) || {}).textContent || "";
        const txt = `${t("name")} ${t("desc")} ${t("cmt")}`;
        res.push({ date: dateDe(t("time")) || dateDe(txt.match(/\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}/)?.[0] || ""), lat: +w.getAttribute("lat"), lon: +w.getAttribute("lon"),
          esp: espDe(txt), qte: qteDe(/rien|bredouille/i.test(txt) ? "rien" : ""), note: txt.trim() });
      }
    } else {
      const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
      const sep = (lignes[0].match(/;/g) || []).length >= (lignes[0].match(/,/g) || []).length ? ";" : ",";
      const tete = lignes[0].toLowerCase().split(sep).map((x) => x.trim());
      const col = (mots) => tete.findIndex((h) => mots.some((m) => h.includes(m)));
      const ci = { date: col(["date", "jour"]), lat: col(["lat"]), lon: col(["lon", "lng"]), esp: col(["esp", "champ", "type"]), qte: col(["quant", "qte", "poids", "récolte", "recolte"]), note: col(["note", "comment", "lieu"]) };
      const avecTete = ci.lat >= 0 && ci.lon >= 0;
      for (const l of lignes.slice(avecTete ? 1 : 0)) {
        const v = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ""));
        const g = (k, d) => v[ci[k] >= 0 ? ci[k] : d];
        res.push({ date: dateDe(g("date", 0)), lat: parseFloat((g("lat", 1) || "").replace(",", ".")), lon: parseFloat((g("lon", 2) || "").replace(",", ".")),
          esp: espDe(g("esp", 3)), qte: qteDe(g("qte", 4)), note: g("note", 5) || "" });
      }
    }
    return res.map((s) => ({ ...s, ok: !!(s.date && isFinite(s.lat) && isFinite(s.lon) && s.lat > 42 && s.lat < 44.5 && s.lon > -2.5 && s.lon < 1) }));
  }
  async function importe(liste) {
    for (const s of liste) data.sorties.push({ id: uid(), cree: Date.now(), modif: Date.now(), date: s.date, lat: s.lat, lon: s.lon, esp: s.esp, qte: s.qte, note: s.note, importee: true });
    return enregistre();
  }

  /* ---------- état ---------- */
  const etat = { synchro: "ok" };
  function previent() { ecouteurs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
  return {
    get configure() { return !!cfg; }, get ouvert() { return !!data; }, get data() { return data; }, get cfg() { return cfg; },
    get reglages() { return reglages; }, get alertes() { return alertes; }, etat,
    surChangement: (f) => ecouteurs.push(f),
    installe, deverrouille: (p, s) => deverrouille(p, s), auto, verrouille, synchro, chargeAnnexes,
    ajouteSortie, supprime, majCoin, coinProche, photo, activeNotifications, lanceTache, lisFichier, importe, uid,
  };
})();
