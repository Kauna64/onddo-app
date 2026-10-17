"""Construit les couches fixes d'habitat pour les Pyrénées-Atlantiques (64).

Entrées (fichiers téléchargés à la main, non versionnés) :
  --bdforet  FORMATION_VEGETALE.shp (BD Forêt V2, IGN)
  --geol     GEO050K_HARM_064_S_FGEOL_2154.shp (BD Charm-50, BRGM)
  --pub      for_publ_fr.shp (forêts publiques, ONF)
Sorties :
  build/habitat_base.npz           scores cèpes / girolles + masque forêt publique (grille 50 m, EPSG:3857)
  docs/data/forets_publiques.geojson
  docs/data/grid.json              géométrie de la grille
"""
import argparse, json, re
import numpy as np, geopandas as gpd
from rasterio import features
from rasterio.transform import from_origin

RES = 50.0  # taille du pixel au sol (m)

# Score d'habitat par code BD Forêt : (cèpes, girolles) entre 0 et 1
ESSENCE = {
    "FF1-09-09": (1.00, 0.95),  # hêtre
    "FF1G01-01": (1.00, 1.00),  # chênes décidus
    "FF1-10-10": (1.00, 1.00),  # châtaignier
    "FF1-00-00": (0.85, 0.85),  # mélange de feuillus
    "FF1-00":    (0.75, 0.75),  # feuillus en îlots
    "FF1-49-49": (0.50, 0.50),  # autre feuillu pur
    "FF1-14-14": (0.10, 0.10),  # robinier
    "FF1G06-06": (0.30, 0.30),  # chênes sempervirents
    "FF31":      (0.90, 0.85),  # mixte à feuillus prépondérants
    "FF32":      (0.85, 0.75),  # mixte à conifères prépondérants
    "FF2G61-61": (0.85, 0.70),  # sapin, épicéa
    "FF2-51-51": (0.70, 0.50),  # pin maritime
    "FF2-52-52": (0.70, 0.55),  # pin sylvestre
    "FF2G53-53": (0.55, 0.40),  # pin laricio / noir
    "FF2G58-58": (0.50, 0.40),  # pin à crochets
    "FF2-80-80": (0.60, 0.45), "FF2-81-81": (0.60, 0.45),
    "FF2-00-00": (0.55, 0.45), "FF2-00": (0.50, 0.40),
    "FF2-90-90": (0.45, 0.35), "FF2-91-91": (0.45, 0.35),
    "FF2-64-64": (0.40, 0.30),  # douglas
    "FF2-63-63": (0.35, 0.25),  # mélèze
    "FO1":       (0.65, 0.60),  # forêt ouverte de feuillus (lisières, clairières)
    "FO3":       (0.60, 0.55), "FO2": (0.50, 0.40),
    "FF0":       (0.20, 0.20), "FO0": (0.10, 0.10),
    "FP":        (0.05, 0.05),  # peupleraie
}

def geol_class(descr: str) -> str:
    """Classe grossière d'acidité du sol à partir de la description BRGM."""
    d = (descr or "").lower()
    if re.search(r"etang|lac|rivi", d):
        return "eau"
    acid = re.search(r"gr[eè]s|schiste|quartzite|granit|gneiss|micaschiste|pélite|pelite|psam|sable|galet|"
                     r"cailloutis|poudingue|silex|grauwacke|conglom|ophite|volcan|tourbe|argile", d)
    calc = re.search(r"calcaire|dolomie|craie|marno-calcaire|cargneule|calcschiste|urgonien", d)
    marne = "marne" in d
    if calc and not acid:
        return "calcaire"
    if calc or marne:
        return "neutre"
    if acid:
        return "acide"
    return "neutre"

GEOL = {"acide": (1.0, 1.0), "neutre": (0.85, 0.70), "calcaire": (0.65, 0.45), "eau": (0.0, 0.0)}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bdforet", required=True); ap.add_argument("--geol", required=True)
    ap.add_argument("--pub", required=True); ap.add_argument("--out", default=".")
    a = ap.parse_args()

    foret = gpd.read_file(a.bdforet).to_crs(3857)
    geol = gpd.read_file(a.geol, encoding="latin1").set_crs(2154, allow_override=True).to_crs(3857)
    pub = gpd.read_file(a.pub, where="cinse_dep='64'").to_crs(3857)

    # Grille en Web Mercator : le pas mercator vaut RES / cos(latitude moyenne)
    xmin, ymin, xmax, ymax = foret.total_bounds
    k = 1 / np.cos(np.radians(43.2))
    step = RES * k
    xmin, ymin = np.floor(xmin / step) * step, np.floor(ymin / step) * step
    W, H = int(np.ceil((xmax - xmin) / step)), int(np.ceil((ymax - ymin) / step))
    T = from_origin(xmin, ymax := ymin + H * step, step, step)
    print("grille", W, "x", H)

    def burn(gdf, vals):
        shapes = [(g, v) for g, v in zip(gdf.geometry, vals) if g is not None and v > 0]
        return features.rasterize(shapes, out_shape=(H, W), transform=T, fill=0, dtype="uint8")

    unknown = set(foret.CODE_TFV) - set(ESSENCE) - {"LA4", "LA6"}
    if unknown: print("codes non notés :", unknown)
    ce = burn(foret, [int(ESSENCE.get(c, (0, 0))[0] * 250) for c in foret.CODE_TFV])
    gi = burn(foret, [int(ESSENCE.get(c, (0, 0))[1] * 250) for c in foret.CODE_TFV])

    geol["cls"] = geol.DESCR.map(geol_class)
    print(geol.assign(ha=geol.area / 1e4 / k**2).groupby("cls").ha.sum().round(0).to_dict())
    order = {"acide": 1, "neutre": 2, "calcaire": 3, "eau": 4}
    gc = burn(geol, [order[c] for c in geol.cls])
    fac = np.ones((5, 2), dtype=np.float32); fac[0] = (0.85, 0.75)  # hors carte géol. : neutre
    for c, i in order.items(): fac[i] = GEOL[c]
    ce = (ce * fac[gc, 0]).round().astype("uint8")
    gi = (gi * fac[gc, 1]).round().astype("uint8")
    pubm = burn(pub, [1] * len(pub))

    np.savez_compressed(f"{a.out}/build/habitat_base.npz", cepes=ce, girolles=gi, public=pubm)
    lon0, lat0 = gpd.points_from_xy([xmin], [ymin], crs=3857).to_crs(4326)[0].coords[0]
    lon1, lat1 = gpd.points_from_xy([xmin + W * step], [ymax], crs=3857).to_crs(4326)[0].coords[0]
    json.dump({"width": W, "height": H, "res_m": RES, "merc": [xmin, ymin, xmin + W * step, ymax],
               "bounds": [[lat0, lon0], [lat1, lon1]]}, open(f"{a.out}/docs/data/grid.json", "w"), indent=1)

    out = pub[["llib_frt", "cdom_frt", "geometry"]].rename(columns={"llib_frt": "nom", "cdom_frt": "domaniale"})
    out["geometry"] = out.to_crs(2154).geometry.simplify(25).to_crs(3857)
    out = out.to_crs(4326)
    out.to_file(f"{a.out}/docs/data/forets_publiques.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    print("forêt (px)", int((ce > 0).sum()), "publique (px)", int(pubm.sum()))

if __name__ == "__main__":
    main()
