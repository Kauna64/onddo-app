"""Indice de pousse (0-1) calculé à partir de séries météo journalières.

Le modèle est volontairement simple et lisible, pour pouvoir être recalé à la main :
  pousse = pluie déclenchante (pondérée selon le délai) × humidité du sol × température du sol × gel
  puis persistance de la poussée quelques jours, et pondération par la saison.
Calage initial (octobre 2026) sur les récoltes d'Iraty : 03/09/2022, 17/09/2023, 24/09/2023, 22/09/2024.
"""
import numpy as np

ESPECES = {
    # lag : délai (jours) entre la pluie et la pousse (début montée, début plateau, fin plateau, fin)
    # t : plage de température du sol (°C) ; persist : part de l'indice conservée d'un jour sur l'autre
    "cepes":    dict(lag=(4, 9, 16, 24), seuil=15, plage=50, t=(6, 10, 17, 22), persist=0.85,
                     saison=[.05, .05, .1, .25, .6, .7, .6, .7, 1, 1, .85, .3]),
    "girolles": dict(lag=(6, 12, 20, 30), seuil=15, plage=50, t=(9, 13, 21, 26), persist=0.9,
                     saison=[0, 0, 0, .1, .4, .8, .9, .9, 1, .9, .6, .15]),
}
NIVEAUX = [100, 400, 700, 1000, 1300, 1600]  # altitudes (m) pour lesquelles l'indice est calculé
RESERVE = 60.0                                # réserve utile du sol forestier (mm)

def trapeze(x, a, b, c, d):
    return np.clip(np.minimum((x - a) / (b - a), (d - x) / (d - c)), 0, 1)

def bouche_trous(x):
    x = np.asarray(x, float).copy()
    for i in range(1, len(x)):
        if np.isnan(x[i]): x[i] = x[i - 1]
    return x

def indice(P, Tm, Tn, ET0, mois, espece, dT=0.0):
    """Indice jour par jour. dT : correction de température pour l'altitude visée (°C)."""
    e = ESPECES[espece]
    P, ET0 = np.nan_to_num(np.asarray(P, float)), bouche_trous(ET0)
    Tm, Tn = bouche_trous(Tm) + dT, bouche_trous(Tn) + dT
    ET0 = np.nan_to_num(ET0) * np.clip(1 + dT * 0.04, 0.5, 1.5)  # plus frais en altitude : moins d'évaporation
    n = len(P)
    # réserve en eau du sol et température du sol (moyenne glissante de l'air)
    W, Ts = np.zeros(n), np.zeros(n)
    w, ts = RESERVE / 2, Tm[0]
    for i in range(n):
        w = min(RESERVE, max(0.0, w + P[i] - 0.7 * ET0[i])); ts += 0.25 * (Tm[i] - ts)
        W[i], Ts[i] = w, ts
    a, b, c, d = e["lag"]
    k = np.arange(d + 1)
    poids = np.clip(np.minimum((k - a) / (b - a), (d - k) / (d - c)), 0, 1)
    out, m = np.full(n, np.nan), 0.0
    for j in range(d + 1, n):
        pluie = float(poids @ P[j - d:j + 1][::-1])
        declenche = np.clip((pluie - e["seuil"]) / e["plage"], 0, 1) ** 0.6
        humide = 0.3 + 0.7 * np.clip((W[j - 5:j + 1].mean() - 10) / 25, 0, 1)
        temp = trapeze(Ts[j - 10:j + 1].mean(), *e["t"])
        tmin = Tn[j - 4:j + 1].min()
        gel = 0.2 if tmin < -2 else (0.6 if tmin < 0.5 else 1.0)
        m = max(declenche * humide * temp * gel, m * e["persist"])
        out[j] = m * e["saison"][mois[j] - 1]
    return out
