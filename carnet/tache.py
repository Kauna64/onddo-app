"""Tâche quotidienne du carnet privé (exécutée dans le dépôt privé onddo-carnet, jamais dans le dépôt public).

1. Déchiffre le carnet avec la phrase secrète (secret GitHub ONDDO_PHRASE).
2. Apprentissage : recale, par espèce et par secteur (côte, piémont, montagne), un décalage de température
   et un facteur sur la pluie pour que l'indice soit le plus haut possible les jours de vos récoltes
   et le plus bas possible les jours où vous n'avez rien trouvé.
3. Alertes : calcule l'indice des 8 prochains jours sur vos coins suivis et envoie une notification.
4. Écrit les résultats chiffrés (reglages.enc, alertes.enc).

Rien n'est écrit en clair et les journaux n'affichent aucune position.
Seuls les nœuds de la grille météo publique (pas de 0,05°, environ 5 km) sont envoyés à Open-Meteo.
"""
import argparse, datetime as dt, hashlib, json, math, os, sys, time, urllib.request
import numpy as np
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, "..", "scripts"))
from indice import indice, ajuste, secteur, bouche_trous  # noqa: E402
from coffre import chiffre, dechiffre  # noqa: E402

GRAD, EXPO = -0.0065, 0.6
DAILY = "precipitation_sum,temperature_2m_mean,temperature_2m_min,et0_fao_evapotranspiration"


# ---------- données publiques ----------
class Public:
    def __init__(self, racine):
        d = os.path.join(racine, "docs", "data")
        self.E = json.load(open(os.path.join(d, "especes.json"), encoding="utf-8"))
        self.G = json.load(open(os.path.join(d, "grid.json")))
        self.M = json.load(open(os.path.join(d, "meteo.json")))
        self.hab = np.array(Image.open(os.path.join(d, "habitat.png")).convert("RGB")).astype(int)
        g = self.M["grille"]
        self.noeuds = {(p["i"], p["j"]): p for p in self.M["points"]}
        self.g = g

    def pixel(self, lat, lon):
        (la0, lo0), (la1, lo1) = self.G["bounds"]
        my = lambda l: math.log(math.tan(math.pi / 4 + math.radians(l) / 2))
        H, W = self.hab.shape[:2]
        r = int((my(la1) - my(lat)) / (my(la1) - my(la0)) * H); k = int((lon - lo0) / (lo1 - lo0) * W)
        if not (0 <= r < H and 0 <= k < W):
            return None
        R, Gc, B = self.hab[r, k]
        v2 = self.G.get("codage") == 2
        return {"code": R, "rel": (Gc >> 4) / 15 if v2 else Gc / 250, "nord": ((Gc & 15) - 7) / 7 if v2 else 0.0,
                "alt": ((B >> 1) - 1) * 24 + 12 if B >> 1 else None}

    def habitat(self, esp, px):
        if not px or px["code"] < 4:
            return 0.0
        sp = self.E["especes"][esp]
        return sp["essences"][px["code"] >> 2] * sp["sols"][px["code"] & 3] * px["rel"]

    def serie(self, lat, lon):
        """Séries météo interpolées entre les nœuds voisins (comme l'appli)."""
        g = self.g
        fi, fj = (lat - g["lat0"]) / g["dlat"], (lon - g["lon0"]) / g["dlon"]
        i0, j0 = math.floor(fi), math.floor(fj); di, dj = fi - i0, fj - j0
        acc, w = None, 0.0
        for i, j, wt in [(i0, j0, (1 - di) * (1 - dj)), (i0 + 1, j0, di * (1 - dj)), (i0, j0 + 1, (1 - di) * dj), (i0 + 1, j0 + 1, di * dj)]:
            p = self.noeuds.get((i, j))
            if p is None or wt <= 0:
                continue
            v = {k: np.array(p[k], float) * wt for k in ("p", "tm", "tn", "e")}; v["alt"] = p["alt"] * wt
            acc = v if acc is None else {k: acc[k] + v[k] for k in acc}
            w += wt
        if acc is None:
            return None
        return {k: acc[k] / w for k in acc}


# ---------- historique météo (apprentissage) ----------
_archives = {}
def archive(lat, lon, debut, fin):
    """Météo passée sur un nœud de la grille publique (jamais la position exacte d'un coin)."""
    cle = (lat, lon, debut, fin)
    if cle not in _archives:
        url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}"
               f"&start_date={debut}&end_date={fin}&daily={DAILY}&timezone=Europe%2FParis")
        for essai in range(5):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    _archives[cle] = json.load(r); break
            except Exception as e:  # noqa: BLE001
                print(f"::warning::archive météo, essai {essai + 1} : {type(e).__name__}", flush=True); time.sleep(60)
        else:
            _archives[cle] = None
        time.sleep(1)
    return _archives[cle]

def noeud_proche(pub, lat, lon):
    g = pub.g
    return round(g["lat0"] + round((lat - g["lat0"]) / g["dlat"]) * g["dlat"], 3), round(g["lon0"] + round((lon - g["lon0"]) / g["dlon"]) * g["dlon"], 3)

def apprend(pub, sorties):
    """Cherche, par espèce et secteur, le réglage qui distingue le mieux vos récoltes de vos sorties vides."""
    aujourd = dt.date.today()
    groupes = {}
    for s in sorties:
        esp = s.get("esp")
        if esp not in pub.E["especes"]:
            continue
        d = dt.date.fromisoformat(s["date"][:10])
        if d > aujourd - dt.timedelta(days=6):
            continue  # l'historique Open-Meteo a quelques jours de retard
        px = pub.pixel(s["lat"], s["lon"])
        la, lo = noeud_proche(pub, s["lat"], s["lon"])
        debut = min(dt.date(d.year, 4, 1), d - dt.timedelta(days=60))
        fin = min(max(dt.date(d.year, 12, 31), d), aujourd - dt.timedelta(days=6))
        a = archive(la, lo, debut.isoformat(), fin.isoformat())
        if not a:
            continue
        dd = a["daily"]
        rec = {"jour": dd["time"].index(d.isoformat()), "trouve": (s.get("qte") or 0) > 0,
               "P": np.nan_to_num(np.array(dd["precipitation_sum"], float)),
               "Tm": bouche_trous(dd["temperature_2m_mean"]), "Tn": bouche_trous(dd["temperature_2m_min"]),
               "E": np.nan_to_num(bouche_trous(dd["et0_fao_evapotranspiration"])),
               "mois": [int(x[5:7]) for x in dd["time"]]}
        alt = (px or {}).get("alt") or a.get("elevation") or 0
        rec["dT"] = GRAD * (alt - (a.get("elevation") or alt))
        rec["nord"] = (px or {}).get("nord", 0.0)
        groupes.setdefault((esp, secteur(alt)), []).append(rec)

    def score(recs, e):
        rp, rn = [], []
        for r in recs:
            ix = np.nan_to_num(indice(r["P"], r["Tm"], r["Tn"], r["E"], r["mois"], None, r["dT"], params=e, nord=r["nord"]))
            saison = ix[40:]  # jours où l'indice est calculable (40 jours de météo nécessaires)
            rang = float((saison < ix[r["jour"]]).mean())
            (rp if r["trouve"] else rn).append(rang)
        if not rp:
            return None
        return np.mean(rp) - (np.mean(rn) if rn else 0.5)

    reglages, resume = {}, []
    par_espece = {}
    for (esp, sect), recs in groupes.items():
        par_espece.setdefault(esp, []).extend(recs)
    cibles = [((esp, sect), recs) for (esp, sect), recs in groupes.items()] + [((esp, "*"), recs) for esp, recs in par_espece.items()]
    for (esp, sect), recs in cibles:
        npos = sum(r["trouve"] for r in recs); nneg = len(recs) - npos
        if npos < 3:
            continue
        base = pub.E["especes"][esp]["meteo"]
        s0 = score(recs, base)
        meilleur = (s0, 0, 1.0)
        for dT in (-3, -2, -1, 0, 1, 2, 3):
            for k in (0.6, 0.8, 1.0, 1.25, 1.5):
                if dT == 0 and k == 1.0:
                    continue
                s = score(recs, ajuste(base, {"dT": dT, "k": k}))
                if s is None:
                    continue
                s -= 0.02 * (abs(dT) + 2 * abs(math.log(k)))  # on ne s'écarte du réglage de base que si ça vaut le coup
                if s > meilleur[0] + 0.03:
                    meilleur = (s, dT, k)
        reglages.setdefault(esp, {})[sect] = {"dT": meilleur[1], "k": meilleur[2], "n": npos, "n_vides": nneg,
                                              "score_base": round(s0, 3), "score": round(meilleur[0], 3)}
        resume.append(f"{esp}/{sect} : {npos} récoltes, {nneg} sorties vides")
    print("Apprentissage :", "; ".join(resume) or "pas encore assez de sorties (3 récoltes par espèce minimum)", flush=True)
    return reglages


# ---------- alertes ----------
def reglage_pour(reglages, esp, alt):
    r = (reglages or {}).get(esp, {})
    return r.get(secteur(alt)) or r.get("*")

def alertes(pub, carnet, reglages, etat):
    M = pub.M; auj = M["aujourdhui"]; dates = M["dates"]
    mois = [int(d[5:7]) for d in dates]
    liste = []
    for c in carnet.get("coins", []):
        if not c.get("alerte"):
            continue
        px = pub.pixel(c["lat"], c["lon"]); s = pub.serie(c["lat"], c["lon"])
        if s is None:
            continue
        alt = (px or {}).get("alt") or s["alt"]
        for esp in c.get("esp") or []:
            if esp not in pub.E["especes"]:
                continue
            e = ajuste(pub.E["especes"][esp]["meteo"], reglage_pour(reglages, esp, alt))
            h = pub.habitat(esp, px) or 0.5  # coin hors carte forestière : on fait confiance à votre coin
            ix = np.nan_to_num(indice(s["p"], s["tm"], s["tn"], s["e"], mois, esp, GRAD * (alt - s["alt"]), params=e, nord=(px or {}).get("nord", 0.0)))
            fut = [(dates[j], round(100 * (h ** EXPO) * ix[j])) for j in range(auj, len(dates))]
            jour, v = max(fut, key=lambda x: x[1])
            liste.append({"coin": c["id"], "nom": c.get("nom", "Coin"), "esp": esp, "jour": jour, "indice": v,
                          "serie": [x[1] for x in fut]})
    # notifications : seuil propre à chaque coin, pas plus d'une fois tous les 3 jours sauf forte hausse
    a_envoyer = []
    for a in liste:
        coin = next(c for c in carnet["coins"] if c["id"] == a["coin"])
        if a["indice"] < coin.get("seuil", 50):
            continue
        cle = f'{a["coin"]}:{a["esp"]}'
        prec = etat.get(cle)
        if prec and (dt.date.today() - dt.date.fromisoformat(prec["le"])).days < 3 and a["indice"] < prec["indice"] + 15:
            continue
        etat[cle] = {"le": dt.date.today().isoformat(), "indice": a["indice"]}
        a_envoyer.append(a)
    return liste, a_envoyer

def notifie(carnet, a_envoyer, especes):
    push = carnet.get("push") or {}
    abonnements, cle = push.get("abonnements") or [], (push.get("vapid") or {}).get("d")
    if not a_envoyer or not abonnements or not cle:
        return []
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid02
    vapid = Vapid02.from_raw(cle.encode())
    erreurs = []
    for a in a_envoyer:
        jour = dt.date.fromisoformat(a["jour"])
        quand = "aujourd'hui" if jour == dt.date.today() else ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][jour.weekday()] + f" {jour.day}"
        corps = json.dumps({"title": f"Onddo · {a['nom']}",
                            "body": f"{especes[a['esp']]['nom']} : {a['indice']}/100 {quand}",
                            "coin": a["coin"], "esp": a["esp"]}, ensure_ascii=False)
        for ab in abonnements:
            try:
                webpush(subscription_info=ab, data=corps, vapid_private_key=vapid,
                        vapid_claims={"sub": "mailto:onddo@users.noreply.github.com"}, ttl=86400)
            except WebPushException as e:
                code = getattr(e.response, "status_code", None)
                erreurs.append({"endpoint": ab.get("endpoint", "")[-24:], "code": code})
            except Exception as e:  # noqa: BLE001  réseau, abonnement invalide…
                erreurs.append({"endpoint": ab.get("endpoint", "")[-24:], "code": type(e).__name__})
    return erreurs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--carnet", required=True, help="dossier du dépôt privé")
    ap.add_argument("--public", required=True, help="dossier du dépôt public onddo-app")
    ap.add_argument("--apprendre", action="store_true", help="forcer l'apprentissage")
    a = ap.parse_args()
    phrase = os.environ.get("ONDDO_PHRASE")
    if not phrase:
        sys.exit("::error::Secret ONDDO_PHRASE absent : Settings > Secrets and variables > Actions")
    lire = lambda nom: json.load(open(os.path.join(a.carnet, nom))) if os.path.exists(os.path.join(a.carnet, nom)) else None
    env = lire("carnet.enc")
    if not env:
        print("Carnet vide pour l'instant."); return
    try:
        carnet = dechiffre(env, phrase)
    except Exception:
        sys.exit("::error::Impossible de déchiffrer le carnet : le secret ONDDO_PHRASE ne correspond pas à la phrase de l'appli.")
    sel = env["sel"]
    pub = Public(a.public)
    sorties = carnet.get("sorties", [])
    print(f"Carnet : {len(sorties)} sorties, {len(carnet.get('coins', []))} coins.", flush=True)

    reg_env = lire("reglages.enc")
    reg = dechiffre(reg_env, phrase) if reg_env else {}
    empreinte = hashlib.sha256(json.dumps([(s.get("id"), s.get("date"), s.get("esp"), s.get("qte"), round(s.get("lat", 0), 4), round(s.get("lon", 0), 4))
                                           for s in sorties], sort_keys=True).encode()).hexdigest()
    vieux = not reg.get("genere") or (dt.date.today() - dt.date.fromisoformat(reg["genere"][:10])).days >= 7
    if a.apprendre or reg.get("empreinte") != empreinte or vieux:
        reg = {"genere": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"), "empreinte": empreinte,
               "reglages": apprend(pub, sorties)}
        json.dump(chiffre(reg, phrase, sel), open(os.path.join(a.carnet, "reglages.enc"), "w"))

    al_env = lire("alertes.enc")
    al = dechiffre(al_env, phrase) if al_env else {}
    etat = al.get("etat", {})
    liste, a_envoyer = alertes(pub, carnet, reg.get("reglages"), etat)
    erreurs = notifie(carnet, a_envoyer, pub.E["especes"])
    print(f"Alertes : {len(liste)} suivis, {len(a_envoyer)} notifications, {len(erreurs)} échecs d'envoi.", flush=True)
    al = {"genere": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"), "meteo": pub.M["genere"],
          "jours": pub.M["dates"][pub.M["aujourdhui"]:], "liste": liste, "envoyees": a_envoyer, "etat": etat, "erreurs_push": erreurs}
    json.dump(chiffre(al, phrase, sel), open(os.path.join(a.carnet, "alertes.enc"), "w"))


if __name__ == "__main__":
    main()
