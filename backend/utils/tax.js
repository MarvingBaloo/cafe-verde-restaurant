// backend/utils/tax.js
// Calcul de la TVA sur des prix TTC, avec répartition des remises/points au prorata.
// Hypothèse métier validée : les prix du catalogue sont TTC (TVA incluse).
//   HT  = TTC / (1 + taux/100)
//   TVA = TTC − HT
// La base imposable est le montant NET réellement encaissé (finalPrice). Les remises
// (commerciale + points) sont réparties au prorata des taux pour que Σ HT + Σ TVA = net.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Taux par défaut (%) du mode de consommation. */
function rateForMode(config, mode) {
  const m = mode === 'takeaway' ? 'takeaway' : 'dineIn';
  return Number(config?.rates?.[m] ?? 0);
}

/**
 * Ventile la TVA d'une commande TTC.
 * @param {Object}  p
 * @param {number}  p.grossTotal     Total TTC brut (avant remises) = totalPrice
 * @param {number}  p.netTotal       Total TTC net encaissé (après remises/points) = finalPrice
 * @param {number}  p.modeRate       Taux par défaut du mode (sur place / à emporter), en %
 * @param {Array}   p.overrideLines  Lignes à taux forcé : [{ rate, ttc }] (ttc = prix catalogue × qté)
 * @returns {{ breakdown: Array<{rate,baseHT,tva,ttc}>, totalHT:number, totalTVA:number }}
 */
function computeTax({ grossTotal = 0, netTotal = 0, modeRate = 0, overrideLines = [] }) {
  const gross = Math.max(0, Number(grossTotal) || 0);
  const net = Math.max(0, Number(netTotal) || 0);
  if (gross <= 0) return { breakdown: [], totalHT: 0, totalTVA: 0 };

  // 1) Regroupe le TTC brut par taux : d'abord les overrides, puis tout le reste au taux du mode.
  const byRate = new Map();
  let overrideSum = 0;
  for (const { rate, ttc } of overrideLines) {
    const r = Number(rate);
    const v = Math.max(0, Number(ttc) || 0);
    if (!v || !Number.isFinite(r)) continue;
    byRate.set(r, (byRate.get(r) || 0) + v);
    overrideSum += v;
  }
  const defaultTTC = Math.max(0, gross - overrideSum);
  if (defaultTTC > 0) {
    const r = Number(modeRate);
    byRate.set(r, (byRate.get(r) || 0) + defaultTTC);
  }

  // 2) Applique la remise globale au prorata (net / brut) sur chaque bucket de taux.
  const factor = gross > 0 ? net / gross : 1;

  const breakdown = [];
  let totalHT = 0;
  let totalTVA = 0;
  for (const [rate, grossTTC] of byRate) {
    const ttc = round2(grossTTC * factor);
    const baseHT = round2(ttc / (1 + rate / 100));
    const tva = round2(ttc - baseHT);
    breakdown.push({ rate, baseHT, tva, ttc });
    totalHT += baseHT;
    totalTVA += tva;
  }
  breakdown.sort((a, b) => a.rate - b.rate);
  return { breakdown, totalHT: round2(totalHT), totalTVA: round2(totalTVA) };
}

/**
 * Taux forcé d'un objet (produit OU catégorie) pour un mode donné.
 * Priorité : champ du mode (taxRateDineIn / taxRateTakeaway) > champ legacy unique (taxRate).
 * Le fallback legacy assure la rétrocompat des données saisies avant le double taux.
 * @returns {number|undefined} undefined = non défini (laisse remonter l'héritage)
 */
function pickModeRate(obj, mode) {
  if (!obj) return undefined;
  const key = mode === 'takeaway' ? 'taxRateTakeaway' : 'taxRateDineIn';
  const v = obj[key];
  if (v !== undefined && v !== null) return Number(v);
  if (obj.taxRate !== undefined && obj.taxRate !== null) return Number(obj.taxRate);
  return undefined;
}

/**
 * Taux effectif d'un produit pour un mode (priorité décroissante) :
 *   1. override produit (taxRateDineIn/Takeaway, fallback taxRate)
 *   2. taux de sa catégorie pour ce mode, hérité en remontant l'arbre (categoriesById par id)
 *   3. null → suit le taux par défaut du mode
 */
function resolveProductRate(item, categoriesById = {}, mode = 'dineIn') {
  const own = pickModeRate(item, mode);
  if (own !== undefined) return own;
  let catId = item?.categoryId || null;
  const seen = new Set();
  while (catId && !seen.has(catId)) {
    seen.add(catId);
    const cat = categoriesById[catId];
    if (!cat) break;
    const r = pickModeRate(cat, mode);
    if (r !== undefined) return r;
    catId = cat.parentId || null;
  }
  return null;
}

/**
 * Construit la ventilation TVA d'une commande à partir de ses lignes.
 * Le taux forcé concerne les produits (`products`/`cartProducts` : override produit puis catégorie héritée)
 * ET les composables (`bubbleTeas`/`milkshakes` : catégorie de classement héritée — items enrichis du
 * `categoryId` en amont). Le reste suit le taux par défaut du mode.
 * Pour les composables, le prix de ligne TTC = `subtotal × quantité` (subtotal = prix unitaire base+suppléments).
 */
function buildOrderTax({ products = [], cartProducts = [], bubbleTeas = [], milkshakes = [], totalPrice = 0, finalPrice = 0, consumptionMode = 'dineIn', config, categoriesById = {} }) {
  const modeRate = rateForMode(config, consumptionMode);
  const overrideLines = [];
  const pushLines = (items, unitField) => {
    for (const item of items || []) {
      const rate = resolveProductRate(item, categoriesById, consumptionMode);
      if (rate === null) continue; // suit le taux du mode
      const qty = Number(item.quantity) || 1;
      const unit = Number(item[unitField]) || 0;
      overrideLines.push({ rate, ttc: unit * qty });
    }
  };
  pushLines(products, 'price');
  pushLines(cartProducts, 'price');
  pushLines(bubbleTeas, 'subtotal');
  pushLines(milkshakes, 'subtotal');
  return computeTax({ grossTotal: totalPrice, netTotal: finalPrice, modeRate, overrideLines });
}

module.exports = { computeTax, buildOrderTax, resolveProductRate, rateForMode, round2 };
