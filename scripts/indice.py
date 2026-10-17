"""Indice de pousse (0-1) calculé à partir de séries météo journalières.

Le modèle est volontairement simple et lisible, pour pouvoir être recalé à la main :
  pousse = déclenchement par la pluie × humidité du sol × température du sol × gel × saison
"""
import numpy as np

ESPECES = {
    # fenêtre de pluie déclenchante (jours avant), plage de température du sol (°C)
    "cepes":    dict(lag=(6, 14),  t=(7, 12, 18, 23), saison=[.05, .05, .1, .25, .6, .7, .6, .7, 1, 1, .85, .3]),
    "girolles": dict(lag=(8, 21),  t=(10, 14, 21, 26), saison=[0, 0, 0, .1, .4, .8, .9, .9, 1, .9, .6, .15]),
}
NIVEAUX = [100, 400, 700, 1000, 1300, 1600]  # altitudes (m) pour lesquelles l'indice est calculé
GRADIENT = -0.0065                            # °C par mètre
RESERVE = 60.0                                # réserve utile du sol forestier (mm)

def trapeze(x, a, b, c, d):
    return np.clip(np.minimum((x - a) / (b - a), (d - x) / (d - c)), 0, 1)

def series_sol(P, Tm, ET0):
    """Réserve en eau du sol (bilan pluie - évapotranspiration) et température du sol (moyenne glissante)."""
    n = len(P); W = np.zeros(n); Ts = np.zeros(n)
    w, ts = RESERVE / 2, Tm[0]
    for i in range(n):
        w = min(RESERVE, max(0.0, w + P[i] - 0.7 * ET0[i]))
        ts = ts + 0.25 * (Tm[i] - ts)
        W[i], Ts[i] = w, ts
    return W, Ts

def indice(P, Tm, Tn, ET0, mois, espece, dT=0.0):
    """Renvoie l'indice jour par jour. dT : correction de température pour l'altitude visée."""
    e = ESPECES[espece]
    P, ET0 = np.nan_to_num(np.asarray(P, float)), np.nan_to_num(np.asarray(ET0, float))
    Tm, Tn = np.asarray(Tm, float) + dT, np.asarray(Tn, float) + dT
    ET0 = ET0 * np.clip(1 + dT * 0.04, 0.5, 1.5)  # il fait plus frais en altitude : moins d'évaporation
    W, Ts = series_sol(P, Tm, ET0)
    n = len(P); out = np.zeros(n)
    l0, l1 = e["lag"]
    for d in range(n):
        if d < l1 + 1:
            out[d] = np.nan; continue
        pluie = P[d - l1:d - l0 + 1].sum()
        declenche = np.clip((pluie - 15) / 35, 0, 1) ** 0.6
        humide = 0.3 + 0.7 * np.clip((W[d - 5:d + 1].mean() - 10) / 25, 0, 1)
        temp = trapeze(Ts[d - 7:d + 1].mean(), *e["t"])
        tmin = Tn[d - 4:d + 1].min()
        gel = 0.2 if tmin < -2 else (0.6 if tmin < 0.5 else 1.0)
        out[d] = declenche * humide * temp * gel * e["saison"][mois[d] - 1]
    return out
