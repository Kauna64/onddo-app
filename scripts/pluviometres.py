"""Pluie réellement mesurée : pluviomètres Météo-France du 64 (données climatologiques quotidiennes, open data).

Pour les jours passés, la pluie du modèle Open-Meteo est remplacée en partie par la pluie mesurée aux
pluviomètres proches : d'autant plus que la station est proche et à une altitude semblable.
Si le fichier est inaccessible, la météo reste celle du modèle (rien ne casse).
"""
import csv, gzip, io, json, math, urllib.request

JEU = "https://www.data.gouv.fr/api/2/datasets/6569b51ae64326786e4e8e1a/resources/?page_size=200&page={}"
PORTEE_KM, DEMI_KM, ALT_M = 15.0, 6.0, 400.0


def url_fichier():
    """Trouve le fichier quotidien le plus récent du département 64 (pluie, températures, vent)."""
    cands = []
    for page in range(1, 30):
        with urllib.request.urlopen(JEU.format(page), timeout=60) as r:
            d = json.load(r)
        for res in d.get("data", []):
            t = f'{res.get("title", "")} {res.get("url", "")}'
            if "RR-T-Vent" in t and ("_64_" in t or "departement_64" in t) and "1950" not in t:
                cands.append(res)
        if not d.get("next_page"):
            break
    if not cands:
        return None
    # le fichier « latest » (années récentes, mis à jour en continu) en priorité, sinon le plus récent
    cands.sort(key=lambda r: ("latest" in (r.get("url", "") + r.get("title", "")).lower(), r.get("last_modified", "")), reverse=True)
    return cands[0]["url"]


def lit_stations(contenu: bytes, dates):
    """{poste: {nom, lat, lon, alt, rr: {date: mm}}} limité aux dates voulues."""
    voulu = {d.replace("-", ""): d for d in dates}
    texte = gzip.decompress(contenu).decode("utf-8", "replace") if contenu[:2] == b"\x1f\x8b" else contenu.decode("utf-8", "replace")
    stations = {}
    nombre = lambda x: float(x.replace(",", ".")) if x not in ("", None) else None
    for l in csv.DictReader(io.StringIO(texte), delimiter=";"):
        j = (l.get("AAAAMMJJ") or "").strip()
        if j not in voulu:
            continue
        rr = nombre((l.get("RR") or "").strip())
        if rr is None:
            continue
        s = stations.setdefault(l["NUM_POSTE"], {"nom": (l.get("NOM_USUEL") or "").strip().title(), "lat": nombre(l["LAT"]),
                                                "lon": nombre(l["LON"]), "alt": nombre(l.get("ALTI") or "") or 0, "rr": {}})
        s["rr"][voulu[j]] = rr
    return stations


def km(la1, lo1, la2, lo2):
    x = math.radians(lo2 - lo1) * math.cos(math.radians((la1 + la2) / 2)); y = math.radians(la2 - la1)
    return 6371 * math.hypot(x, y)


def corrige(points, dates, aujourdhui, stations):
    """Corrige sur place la pluie (clé « p ») des points pour les jours passés où des pluviomètres ont mesuré."""
    if not stations:
        return {}
    dernier = max(d for s in stations.values() for d in s["rr"])
    for pt in points:
        proches = [(km(pt["lat"], pt["lon"], s["lat"], s["lon"]), s) for s in stations.values()]
        proches = [(dk, s) for dk, s in proches if dk <= PORTEE_KM]
        if not proches:
            continue
        proches.sort(key=lambda x: x[0])
        pt["pluvio"] = {"nom": proches[0][1]["nom"], "km": round(proches[0][0], 1)}
        parts = []
        for j, d in enumerate(dates[:aujourdhui]):
            mes = [(dk, s, s["rr"][d]) for dk, s in proches if d in s["rr"]]
            if not mes:
                continue
            w = [math.exp(-abs(s["alt"] - pt["alt"]) / ALT_M) / max(dk, 1.0) ** 2 for dk, s, _ in mes]
            estime = sum(wi * rr for wi, (_, _, rr) in zip(w, mes)) / sum(w)
            confiance = min(1.0, sum(math.exp(-dk / DEMI_KM) * math.exp(-abs(s["alt"] - pt["alt"]) / ALT_M) for dk, s, _ in mes))
            pt["p"][j] = round(confiance * estime + (1 - confiance) * pt["p"][j], 1)
            parts.append(confiance)
        if parts:
            pt["pluvio"]["part"] = round(sum(parts) / len(parts), 2)
    return {"stations": len(stations), "jusqu_au": dernier,
            "source": "Météo-France, données climatologiques de base quotidiennes (licence ouverte)"}


def applique(points, dates, aujourdhui):
    try:
        url = url_fichier()
        if not url:
            print("::warning::pluviomètres : fichier du 64 introuvable", flush=True); return None
        with urllib.request.urlopen(url, timeout=180) as r:
            contenu = r.read()
        st = lit_stations(contenu, dates[:aujourdhui])
        info = corrige(points, dates, aujourdhui, st)
        print(f"Pluviomètres : {info.get('stations', 0)} stations, mesures jusqu'au {info.get('jusqu_au')}", flush=True)
        return info
    except Exception as e:  # noqa: BLE001
        print(f"::warning::pluviomètres indisponibles ({type(e).__name__}: {e}) : pluie du modèle conservée", flush=True)
        return None
