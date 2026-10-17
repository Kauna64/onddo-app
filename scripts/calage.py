"""Calage : indice calculé sur l'historique d'Iraty comparé aux dates de récolte connues."""
import json, urllib.request
import numpy as np
from indice import indice

LAT, LON = 43.035, -1.06           # chalets d'Iraty
RECOLTES = ["2022-09-03", "2023-09-17", "2023-09-24", "2024-09-22"]
DAILY = "precipitation_sum,temperature_2m_mean,temperature_2m_min,et0_fao_evapotranspiration"

HIST = {}
for an in (2022, 2023, 2024, 2025):
    url = (f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}"
           f"&start_date={an}-06-01&end_date={an}-11-30&daily={DAILY}&timezone=Europe%2FParis")
    d = json.load(urllib.request.urlopen(url, timeout=120))
    alt = d["elevation"]; dd = d["daily"]; dates = dd["time"]
    P, Tm, Tn, E = (np.array(dd[v], dtype=float) for v in DAILY.split(","))
    mois = [int(s[5:7]) for s in dates]
    HIST[an] = {"alt": alt, **dd}
    print(f"\n=== {an} (altitude du point météo {alt:.0f} m) ===")
    for lv in (1000, 1300):
        ix = indice(P, Tm, Tn, E, mois, "cepes", -0.0065 * (lv - alt))
        top = [dates[i] for i in np.argsort(np.nan_to_num(ix))[::-1][:8]]
        print(f"  {lv} m : 8 meilleurs jours {sorted(top)}")
        for r in RECOLTES:
            if r.startswith(str(an)):
                i = dates.index(r); rang = int((np.nan_to_num(ix[92:]) > ix[i]).sum()) + 1  # rang parmi les 91 jours sept-nov
                print(f"    récolte {r} : indice {ix[i]:.2f} (max saison {np.nanmax(ix):.2f}, rang {rang} sur sept-nov)")
    sem = [f"{dates[i][5:]}:{100*np.nan_to_num(indice(P, Tm, Tn, E, mois, 'cepes', -0.0065*(1100-alt)))[i]:.0f}"
           for i in range(76, 183, 4)]
    print("  1100 m, tous les 4 jours (août-nov) :", " ".join(sem))
    print("  pluie mensuelle (mm) :", {m: round(float(P[[k for k in range(len(dates)) if mois[k]==m]].sum())) for m in range(6, 12)})

json.dump(HIST, open("build/iraty_historique.json", "w"))
