"""Construit les couches fixes d'habitat pour les Pyrénées-Atlantiques (64).

Entrées (fichiers téléchargés à la main, non versionnés) :
  --bdforet  FORMATION_VEGETALE.shp (BD Forêt V2, IGN)
  --geol     GEO050K_HARM_064_S_FGEOL_2154.shp (BD Charm-50, BRGM)
  --pub      for_publ_fr.shp (forêts publiques, ONF)
Sorties :
  build/habitat_base.npz           milieu forestier, type de sol, masque forêt publique (grille 50 m, EPSG:3857)
  docs/data/forets_publiques.geojson
  docs/data/grid.json              géométrie de la grille
"""
import argparse, json, re
import numpy as np, geopandas as gpd
from rasterio import features
from rasterio.transform import from_origin

RES = 50.0  # taille du pixel au sol (m)

# Code BD Forêt -> numéro de milieu (voir « milieux » dans docs/data/especes.json)
MILIEU = {
    "FF1-09-09": 1, "FF1G01-01": 2, "FF1-10-10": 3, "FF1-00-00": 4, "FF1-00": 5,
    "FF1-49-49": 6, "FF1G06-06": 6, "FF1-14-14": 7, "FF31": 8, "FF32": 9,
    "FF2G61-61": 10, "FF2-51-51": 11, "FF2-52-52": 12, "FF2-80-80": 12, "FF2-81-81": 12, "FF2G58-58": 12,
    "FF2G53-53": 13, "FF2-00-00": 14, "FF2-00": 14, "FF2-90-90": 14, "FF2-91-91": 14,
    "FF2-64-64": 15, "FF2-63-63": 16, "FO1": 17, "FO2": 18, "FO3": 19, "FF0": 20, "FO0": 20, "FP": 21,
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

    unknown = set(foret.CODE_TFV) - set(MILIEU) - {"LA4", "LA6"}
    if unknown: print("codes non classés :", unknown)
    milieu = burn(foret, [MILIEU.get(c, 0) for c in foret.CODE_TFV])

    geol["cls"] = geol.DESCR.map(geol_class)
    print(geol.assign(ha=geol.area / 1e4 / k**2).groupby("cls").ha.sum().round(0).to_dict())
    order = {"acide": 1, "neutre": 2, "calcaire": 3, "eau": 4}
    sol = burn(geol, [order[c] for c in geol.cls])
    milieu[sol == 4] = 0          # plans d'eau
    sol[sol == 4] = 0
    pubm = burn(pub, [1] * len(pub))

    np.savez_compressed(f"{a.out}/build/habitat_base.npz", milieu=milieu, sol=sol, public=pubm)
    lon0, lat0 = gpd.points_from_xy([xmin], [ymin], crs=3857).to_crs(4326)[0].coords[0]
    lon1, lat1 = gpd.points_from_xy([xmin + W * step], [ymax], crs=3857).to_crs(4326)[0].coords[0]
    json.dump({"width": W, "height": H, "res_m": RES, "merc": [xmin, ymin, xmin + W * step, ymax],
               "bounds": [[lat0, lon0], [lat1, lon1]]}, open(f"{a.out}/docs/data/grid.json", "w"), indent=1)

    out = pub[["llib_frt", "cdom_frt", "geometry"]].rename(columns={"llib_frt": "nom", "cdom_frt": "domaniale"})
    out["geometry"] = out.to_crs(2154).geometry.simplify(25).to_crs(3857)
    out = out.to_crs(4326)
    out.to_file(f"{a.out}/docs/data/forets_publiques.geojson", driver="GeoJSON", COORDINATE_PRECISION=5)
    print("forêt (px)", int((milieu > 0).sum()), "publique (px)", int(pubm.sum()))

if __name__ == "__main__":
    main()
