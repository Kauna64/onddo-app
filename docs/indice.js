/* Indice de pousse : même calcul que scripts/indice.py (qui sert au calage), avec le détail de chaque facteur.
   pousse = pluie déclenchante × humidité du sol × température du sol × gel, avec persistance, × saison */
"use strict";
const RESERVE = 100; // réserve utile du sol forestier (mm)

function trapeze(x, a, b, c, d) {
  return Math.min(Math.max(Math.min((x - a) / (b - a), (d - x) / (d - c)), 0), 1);
}

/* P, Tm, Tn, E : séries journalières (mm, °C, °C, mm) ; mois : mois (1-12) de chaque jour ;
   e : paramètres « meteo » de l'espèce ; dT : correction de température pour l'altitude (°C).
   detail = true : renvoie aussi les facteurs de chaque jour. */
function calculIndice(P, Tm, Tn, E, mois, e, dT, detail) {
  const n = P.length;
  const W = new Float32Array(n), Ts = new Float32Array(n);
  const kE = Math.min(Math.max(1 + dT * 0.04, 0.5), 1.5);
  let w = RESERVE / 2, ts = Tm[0] + dT;
  for (let i = 0; i < n; i++) {
    w = Math.min(RESERVE, Math.max(0, w + P[i] - 0.7 * E[i] * kE));
    ts += 0.25 * (Tm[i] + dT - ts);
    W[i] = w; Ts[i] = ts;
  }
  const [a, b, c, d] = e.lag, hm = e.humide_min ?? 0.3;
  const poids = [];
  for (let k = 0; k <= d; k++) poids.push(Math.min(Math.max(Math.min((k - a) / (b - a), (d - k) / (d - c)), 0), 1));
  const out = new Float32Array(n).fill(NaN), det = detail ? new Array(n) : null;
  let m = 0, debut = -1;
  for (let j = d + 1; j < n; j++) {
    let pluie = 0;
    for (let k = 0; k <= d; k++) pluie += poids[k] * P[j - k];
    const declenche = Math.pow(Math.min(Math.max((pluie - e.seuil) / e.plage, 0), 1), 0.6);
    let wm = 0; for (let k = j - 5; k <= j; k++) wm += W[k]; wm /= 6;
    const humide = hm + (1 - hm) * Math.min(Math.max((wm - 10) / 25, 0), 1);
    let tsm = 0; for (let k = j - 10; k <= j; k++) tsm += Ts[k]; tsm /= 11;
    const temp = trapeze(tsm, ...e.t);
    let tmin = Infinity, jgel = -1;
    for (let k = j - 4; k <= j; k++) if (Tn[k] + dT < tmin) { tmin = Tn[k] + dT; jgel = k; }
    const gel = tmin < -2 ? 0.2 : tmin < 0.5 ? 0.6 : 1;
    const brut = declenche * humide * temp * gel;
    if (brut >= m * e.persist) { if (brut > 0.05 && (m * e.persist < 0.05 || debut < 0)) debut = j; m = brut; }
    else m *= e.persist;
    if (m < 0.05) debut = -1;
    const saison = e.saison[mois[j] - 1];
    out[j] = m * saison;
    if (detail) det[j] = { pluie, declenche, reserve: wm, humide, tsol: tsm, temp, tmin, jgel, gel, brut, persiste: m, debut, saison };
  }
  return detail ? { indice: out, detail: det } : out;
}

if (typeof module !== "undefined") module.exports = { calculIndice };
