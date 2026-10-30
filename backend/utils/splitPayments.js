// Fusion des règlements d'une addition séparée encaissée EN PLUSIEURS FOIS dans le temps.
//
// Un convive peut régler sa part et partir pendant que la table continue de consommer
// (recordPartPayment persiste alors son règlement dans `splitPayments[]`). À la clôture, la caisse
// envoie les règlements du reste de la table — qu'elle a composés SANS connaître les parts déjà
// encaissées. Les concaténer naïvement produirait deux « Part 1 » ; les remplacer effacerait
// l'argent déjà encaissé.
//
// Fonction PURE : aucune E/S, testable sans base (scripts/checkSplitMerge.js).

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Numéros de part distincts, dans leur ordre d'apparition. */
function distinctIndexes(parts) {
  const seen = [];
  for (const p of parts) {
    const idx = p.index != null ? Number(p.index) : null;
    if (idx != null && !seen.includes(idx)) seen.push(idx);
  }
  return seen;
}

/**
 * @param {Array} existing  parts déjà persistées sur le ticket (peut être vide/absent)
 * @param {Array} incoming  parts envoyées par la caisse à la clôture
 * @returns {{ splitPayments: Array, splitCount: number, merged: boolean }}
 *
 * ⚠️ INVARIANT DE NON-RÉGRESSION : sans part persistée, `splitPayments` est exactement le tableau
 * reçu (mêmes objets, même ordre, index intacts) et `merged` vaut false. Le comportement d'un
 * encaissement ordinaire est donc inchangé, à l'objet près.
 */
function mergeSplitPayments(existing, incoming) {
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const prior = (Array.isArray(existing) ? existing : []).filter(p => p && Number(p.amount) > 0);

  if (!prior.length) return { splitPayments: incomingList, splitCount: incomingList.length, merged: false };

  // Un règlement déjà persisté que la caisse renverrait (rechargement, reprise de ticket) ne doit
  // pas être compté deux fois. `partId` est posé par recordPartPayment et ne change jamais.
  const knownIds = new Set(prior.map(p => p.partId).filter(Boolean));
  const fresh = incomingList.filter(p => !(p.partId && knownIds.has(p.partId)));

  // Les parts de la caisse repartent de 1 : on les décale derrière les parts déjà encaissées, en
  // préservant les regroupements (une part réglée en plusieurs fois partage un même index).
  const offset = distinctIndexes(prior).length;
  const remap = new Map();
  distinctIndexes(fresh).forEach((idx, i) => remap.set(idx, offset + i + 1));

  const shifted = fresh.map((p, i) => ({
    ...p,
    index: p.index != null && remap.has(Number(p.index)) ? remap.get(Number(p.index)) : offset + i + 1,
  }));

  const splitPayments = [...prior, ...shifted];
  return { splitPayments, splitCount: distinctIndexes(splitPayments).length, merged: true };
}

/** Somme des montants bruts réellement encaissés sur un ticket (parts persistées). */
function prepaidTotal(parts) {
  return round2((Array.isArray(parts) ? parts : []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

module.exports = { mergeSplitPayments, prepaidTotal };
