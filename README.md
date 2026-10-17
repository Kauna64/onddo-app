# Onddo

Carte de pousse de sept champignons dans les Pyrénées-Atlantiques, consultable sur téléphone : cèpe de Bordeaux, tête de nègre, cèpe d'été, cèpe des pins, girolle, pied de mouton, trompette de la mort.

Les réglages de chaque espèce (arbres, sols, délai après la pluie, températures, saison) sont dans `docs/data/especes.json`.

**Application : https://kauna64.github.io/onddo-app/** (une fois GitHub Pages activé)

## Fonctionnement
- **Carte fixe des milieux** (`build/habitat_base.npz`, `docs/data/habitat.png`) : type de forêt (BD Forêt V2, IGN),
  acidité du sol (BD Charm-50, BRGM), forêts publiques (ONF), pente et altitude (Copernicus DEM 30 m). Pixel de 50 m.
- **Météo quotidienne** (`docs/data/meteo.json`) : 464 points Open-Meteo (pas de 0,05°) sur les forêts du département,
  45 jours d'historique et 9 jours de prévision (séries brutes). L'appli calcule l'indice elle-même (`docs/indice.js`,
  identique à `scripts/indice.py` qui sert au calage) : pour 6 altitudes sur la carte, et à l'altitude exacte au toucher,
  avec le détail de chaque facteur.
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

## Chasse
`docs/data/chasse.json` : dates de la campagne 2026-2027, jours de chasse courants et contacts locaux (Ustaritz, Saint-Pée, Iraty, bois de Mixe). Aucun calendrier de battues n'est publié en ligne par ces communes : à mettre à jour chaque saison.

## Carnet de coins (privé et chiffré)
- `docs/carnet.js`, `docs/carnet-ui.js` : les sorties sont chiffrées sur le téléphone (AES-GCM 256, clé dérivée de la phrase secrète
  par PBKDF2-SHA256, 210 000 itérations) puis rangées dans un dépôt GitHub **privé** (`onddo-carnet`). Rien n'est stocké ici.
- `carnet/tache.py` : exécuté chaque matin **dans le dépôt privé** (fichier `.github/workflows/onddo.yml` installé par l'appli) avec le
  secret `ONDDO_PHRASE` : recalage par espèce et secteur à partir des sorties, alertes Web Push sur les coins suivis.
  Seuls les nœuds de la grille publique (pas de 0,05°) sont envoyés à Open-Meteo, jamais la position d'un coin.

## Pluie mesurée
`scripts/pluviometres.py` : pour les jours passés, la pluie du modèle est corrigée par les pluviomètres Météo-France du 64
(données climatologiques de base quotidiennes, open data), selon la distance et l'écart d'altitude.

## Versant
`build_relief.py` calcule l'orientation du versant ; `indice.py` / `indice.js` rafraîchissent un versant nord (et réchauffent
un versant sud) de 2 à 5 °C selon la saison pour une pente « pure », et ralentissent l'assèchement du versant nord.

## Sur le terrain
`docs/terrain.js` : position de la voiture, flèche de retour, tracé (export GPX) — stockés sur le téléphone uniquement ;
préchargement automatique des tuiles autour de la position et des coins.
