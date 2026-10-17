# Onddo

Carte de pousse des cèpes et des girolles dans les Pyrénées-Atlantiques, consultable sur téléphone.

**Application : https://kauna64.github.io/onddo-app/** (une fois GitHub Pages activé)

## Fonctionnement
- **Carte fixe des habitats** (`build/habitat_base.npz`, `docs/data/habitat.png`) : essences forestières (BD Forêt V2, IGN),
  acidité du sol (BD Charm-50, BRGM), forêts publiques (ONF), pente et altitude (Copernicus DEM 30 m). Pixel de 50 m.
- **Météo quotidienne** (`docs/data/meteo.json`) : 464 points Open-Meteo (pas de 0,05°) sur les forêts du département,
  60 jours d'historique et 9 jours de prévision. L'indice de pousse (`scripts/indice.py`) est calculé pour 6 altitudes,
  puis interpolé sur la carte selon l'altitude de chaque pixel.
- **Application** (`docs/`) : page web installable sur l'écran d'accueil, utilisable hors connexion sur une zone enregistrée.

## Tâches automatiques (onglet Actions)
- *Météo quotidienne* : chaque matin vers 6 h.
- *Relief (une fois)* : ajoute le relief à la carte des habitats.
- *Calage Iraty* : compare l'indice aux récoltes connues d'Iraty (résultat dans `build/calage.txt`).

## Recalculer la carte des habitats
Télécharger la BD Forêt V2 (D064), la BD Charm-50 (064) et les forêts publiques ONF, puis :
```
python scripts/build_habitat.py --bdforet FORMATION_VEGETALE.shp --geol GEO050K_HARM_064_S_FGEOL_2154.shp --pub for_publ_fr.shp
python scripts/build_relief.py
```
