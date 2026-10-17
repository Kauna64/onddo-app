"""Récupère la météo (Open-Meteo) sur une grille couvrant les forêts du 64 et écrit docs/data/meteo.json."""
import json, time, urllib.request, urllib.error, datetime as dt
import numpy as np
from indice import NIVEAUX, bouche_trous

LAT0, LON0, DLAT, DLON = 42.75, -1.80, 0.05, 0.05
NLAT, NLON = 19, 38
PASSE, FUTUR, AFFICHE = 45, 9, 7  # jours d'historique pour le bilan d'eau, de prévision, affichés de chaque côté
DAILY = "precipitation_sum,temperature_2m_mean,temperature_2m_min,et0_fao_evapotranspiration"

def points_actifs():
    """Garde les nœuds de la grille proches d'une forêt."""
    g = json.load(open("docs/data/grid.json"))
    hab = np.load("build/habitat_base.npz")["milieu"] > 0
    (la0, lo0), (la1, lo1) = g["bounds"]
    H, W = hab.shape
    # projection mercator -> lignes
    def row(lat):
        y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
        y0 = np.log(np.tan(np.pi / 4 + np.radians(la0) / 2)); y1 = np.log(np.tan(np.pi / 4 + np.radians(la1) / 2))
        return (y1 - y) / (y1 - y0) * H
    actifs = []
    for i in range(NLAT):
        for j in range(NLON):
            lat, lon = LAT0 + i * DLAT, LON0 + j * DLON
            r0, r1 = int(row(lat + DLAT)), int(row(lat - DLAT))
            c0 = int((lon - DLON - lo0) / (lo1 - lo0) * W); c1 = int((lon + DLON - lo0) / (lo1 - lo0) * W)
            r0, r1, c0, c1 = max(r0, 0), min(r1, H), max(c0, 0), min(c1, W)
            if r1 > r0 and c1 > c0 and hab[r0:r1, c0:c1].any():
                actifs.append((i, j, round(lat, 3), round(lon, 3)))
    return actifs

def appel(lats, lons):
    url = ("https://api.open-meteo.com/v1/forecast?latitude=" + ",".join(map(str, lats)) +
           "&longitude=" + ",".join(map(str, lons)) + f"&daily={DAILY}&past_days={PASSE}&forecast_days={FUTUR}"
           "&timezone=Europe%2FParis")
    for essai in range(10):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                d = json.load(r)
                return d if isinstance(d, list) else [d]
        except urllib.error.HTTPError as e:
            msg = f"HTTP {e.code} {e.read()[:300]!r}"
        except Exception as e:  # coupure réseau, délai dépassé…
            msg = repr(e)
        print(f"::warning::Open-Meteo, essai {essai + 1} : {msg}", flush=True)
        time.sleep(120)
    raise RuntimeError("Open-Meteo injoignable")

def main():
    pts = points_actifs()
    print(len(pts), "points météo", flush=True)
    res = []
    for k in range(0, len(pts), 40):
        lot = pts[k:k + 40]
        res += appel([p[2] for p in lot], [p[3] for p in lot])
        time.sleep(25)  # quota Open-Meteo : 600 appels pondérés par minute
    dates = res[0]["daily"]["time"]
    mois = [int(s[5:7]) for s in dates]
    auj = dates.index(dt.date.today().isoformat()) if dt.date.today().isoformat() in dates else PASSE
    fin = min(len(dates), auj + AFFICHE + 1)
    # L'appli recalcule l'indice elle-même (docs/indice.js) à partir des séries brutes :
    # elle peut ainsi l'évaluer à l'altitude exacte de chaque point et expliquer chaque facteur.
    out = {"genere": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
           "dates": dates[:fin], "aujourdhui": auj, "affiche": AFFICHE, "niveaux": NIVEAUX,
           "grille": {"lat0": LAT0, "lon0": LON0, "dlat": DLAT, "dlon": DLON, "nlat": NLAT, "nlon": NLON},
           "points": []}
    r1 = lambda a: [round(float(x), 1) for x in a[:fin]]
    for p, r in zip(pts, res):
        d = r["daily"]
        P, Tm, Tn, E = (np.array(d[v], dtype=float) for v in DAILY.split(","))
        Tm = bouche_trous(np.where(np.isnan(Tm), Tn + 5, Tm)); Tn = bouche_trous(Tn)
        P, E = np.nan_to_num(P), np.nan_to_num(bouche_trous(E))
        alt = r.get("elevation", 0) or 0
        out["points"].append({"i": p[0], "j": p[1], "lat": p[2], "lon": p[3], "alt": round(alt),
                              "p": r1(P), "tm": r1(Tm), "tn": r1(Tn), "e": r1(E)})
    json.dump(out, open("docs/data/meteo.json", "w"), separators=(",", ":"))
    print("meteo.json écrit", flush=True)

GRAD = -0.0065
if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        # les annotations « ::error:: » restent lisibles dans l'onglet Actions
        print("::error::" + traceback.format_exc().replace("\n", "%0A"), flush=True)
        raise
