"""Ajoute le relief (Copernicus DEM 30 m) aux couches d'habitat et écrit docs/data/habitat.png.

Canaux du PNG (pixel de 50 m, Web Mercator) :
  R = milieu * 4 + sol        (milieu et sol : voir docs/data/especes.json ; 0 = hors forêt)
  G = facteur de relief 0-250 (pente forte ou altitude au-dessus de la forêt productive)
  B = (altitude // 24 + 1) * 2 + forêt publique (0/1) ; altitude 0 = inconnue
"""
import argparse, json, os, sys, urllib.request
import numpy as np
from PIL import Image

TILES = [f"Copernicus_DSM_COG_10_N{lat:02d}_00_{ew}_00_DEM" for lat in (42, 43) for ew in ("W002", "W001", "E000")]
URL = "https://copernicus-dem-30m.s3.amazonaws.com/{t}/{t}.tif"

def load_dem(grid, cache):
    import rasterio
    from rasterio.warp import reproject, Resampling
    from rasterio.transform import from_origin
    W, H = grid["width"], grid["height"]; x0, y0, x1, y1 = grid["merc"]
    T = from_origin(x0, y1, (x1 - x0) / W, (y1 - y0) / H)
    dem = np.full((H, W), np.nan, dtype=np.float32)
    os.makedirs(cache, exist_ok=True)
    for t in TILES:
        p = f"{cache}/{t}.tif"
        if not os.path.exists(p):
            print("téléchargement", t, flush=True)
            try: urllib.request.urlretrieve(URL.format(t=t), p)
            except Exception as e: print("  absent :", e); continue
        with rasterio.open(p) as src:
            tmp = np.full((H, W), np.nan, dtype=np.float32)
            reproject(rasterio.band(src, 1), tmp, dst_transform=T, dst_crs="EPSG:3857",
                      dst_nodata=np.nan, resampling=Resampling.average)
            dem = np.where(np.isnan(dem), tmp, dem)
    return dem, (x1 - x0) / W * np.cos(np.radians(43.2))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--no-dem", action="store_true")
    ap.add_argument("--cache", default="/tmp/dem"); a = ap.parse_args()
    grid = json.load(open("docs/data/grid.json"))
    b = np.load("build/habitat_base.npz")
    milieu, sol, pub = b["milieu"], b["sol"], b["public"]
    rel = np.full(milieu.shape, 250.0)
    alt = np.zeros(milieu.shape, dtype=np.uint8)
    if not a.no_dem:
        dem, px = load_dem(grid, a.cache)
        ok = ~np.isnan(dem)
        print("relief couvert :", round(ok.mean() * 100, 1), "%")
        # Pente : au-delà de 35° le sol est maigre et la cueillette dangereuse
        gy, gx = np.gradient(np.nan_to_num(dem), px)
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        f = np.clip(1 - (slope - 35) / 20, 0.3, 1)
        # Au-dessus de 1900 m il n'y a plus de forêt productive
        f *= np.clip(1 - (np.nan_to_num(dem) - 1900) / 200, 0, 1)
        rel *= f
        alt = np.where(ok, np.clip(dem // 24 + 1, 1, 127), 0).astype(np.uint8)
        grid["dem"] = "Copernicus GLO-30"
    foret = milieu > 0
    R = np.where(foret, milieu.astype(np.uint16) * 4 + sol, 0).astype(np.uint8)
    G = np.where(foret, rel.round(), 0).astype(np.uint8)
    B = np.where(foret, alt.astype(np.uint16) * 2 + pub, 0).astype(np.uint8)
    img = np.dstack([R, G, B])
    Image.fromarray(img, "RGB").save("docs/data/habitat.png", optimize=True)
    json.dump(grid, open("docs/data/grid.json", "w"), indent=1)
    print("habitat.png", os.path.getsize("docs/data/habitat.png") // 1024, "Ko")

if __name__ == "__main__":
    main()
