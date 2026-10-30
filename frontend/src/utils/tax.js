// frontend/src/utils/tax.js
// Miroir d'affichage du calcul TVA backend (backend/utils/tax.js fait foi et stocke le résultat).
// Prix TTC : HT = TTC / (1 + taux/100) ; TVA = TTC − HT. Remises/points répartis au prorata.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function rateForMode(config, mode) {
  const m = mode === 'takeaway' ? 'takeaway' : 'dineIn';
  return Number(config?.rates?.[m] ?? 0);
}

export function computeTax({ grossTotal = 0, netTotal = 0, modeRate = 0, overrideLines = [] }) {
  const gross = Math.max(0, Number(grossTotal) || 0);
  const net = Math.max(0, Number(netTotal) || 0);
  if (gross <= 0) return { breakdown: [], totalHT: 0, totalTVA: 0 };

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
  if (defaultTTC > 0) byRate.set(Number(modeRate), (byRate.get(Number(modeRate)) || 0) + defaultTTC);

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

/** Taux forcé d'un objet (produit ou catégorie) pour un mode : champ du mode > legacy unique > undefined. */
function pickModeRate(obj, mode) {
  if (!obj) return undefined;
  const key = mode === 'takeaway' ? 'taxRateTakeaway' : 'taxRateDineIn';
  const v = obj[key];
  if (v !== undefined && v !== null) return Number(v);
  if (obj.taxRate !== undefined && obj.taxRate !== null) return Number(obj.taxRate);
  return undefined;
}

/** Taux effectif d'un produit pour un mode : override produit > catégorie (héritée) > null (suit le mode). */
export function resolveProductRate(product, categoriesById = {}, mode = 'dineIn') {
  const own = pickModeRate(product, mode);
  if (own !== undefined) return own;
  let catId = product?.categoryId || null;
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

/** Ventilation TVA d'un panier caisse : taux forcé sur produits (override > catégorie) et composables (catégorie de classement). */
export function buildCartTax(cart, grossTotal, netTotal, consumptionMode, config, categoriesById = {}) {
  const overrideLines = [];
  for (const item of cart || []) {
    const ref = item.type === 'product' ? item.product
      : item.type === 'bubbletea' ? item.bubbleTea
      : item.type === 'milkshake' ? item.milkshake
      : null;
    if (!ref) continue;
    const rate = resolveProductRate(ref, categoriesById, consumptionMode);
    if (rate === null) continue;
    overrideLines.push({ rate, ttc: (Number(item.price) || 0) * (Number(item.quantity) || 1) });
  }
  return computeTax({ grossTotal, netTotal, modeRate: rateForMode(config, consumptionMode), overrideLines });
}
