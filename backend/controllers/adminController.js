// backend/controllers/adminController.js
const asyncHandler = require('express-async-handler');
const { ordersCol } = require('../models/Order');
const { ingredientsCol } = require('../models/Ingredient');
const { getTaxConfig } = require('../models/Setting');
const { findAll: findAllProducts } = require('../models/Product');
const { findAll: findAllCategories } = require('../models/ProductCategory');
const { findAll: findAllBubbleTeas } = require('../models/BubbleTea');
const { findAll: findAllMilkshakes } = require('../models/Milkshake');
const { buildOrderTax } = require('../utils/tax');
const { POINTS_PER_EURO } = require('../utils/loyalty');
const { sanitizeCardPayments, sumKind, paymentIntentIdsOf } = require('../utils/cardPayments');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Convertit un Timestamp Firestore ou Date JS en objet Date JS. */
function toDate(val) {
  if (!val) return new Date(0);
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  return new Date(0);
}

/**
 * @desc    Récupérer les statistiques globales pour le Dashboard Admin
 * @route   GET /api/admin/stats
 * @access  Private (Admin)
 */
const getDashboardStats = asyncHandler(async (req, res) => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // --- KPI GLOBAUX ---
  // NOTE F2: fetch puis group-by JS. Acceptable pour le volume Café Verde (<100k orders).
  // À migrer vers BigQuery si volume explose.
  const allSnap = await ordersCol.get();
  const allOrders = allSnap.docs.map(doc => doc.data()).filter(o => o.status !== 'cancelled');

  const totalOrders  = allOrders.length;
  const totalRevenue = allOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
  const avgBasket    = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // --- GRAPHIQUE DES VENTES (7 derniers jours) ---
  // NOTE F2: fetch puis group-by JS. Acceptable pour le volume Café Verde (<100k orders).
  // À migrer vers BigQuery si volume explose.
  const recentSnap   = await ordersCol.where('createdAt', '>=', sevenDaysAgo).get();
  const recentOrders = recentSnap.docs.map(doc => doc.data()).filter(o => o.status !== 'cancelled');

  const chartGrouped = {};
  for (const order of recentOrders) {
    const dateStr = toDate(order.createdAt).toISOString().split('T')[0]; // YYYY-MM-DD
    if (!chartGrouped[dateStr]) chartGrouped[dateStr] = { _id: dateStr, dailyRevenue: 0, count: 0 };
    chartGrouped[dateStr].dailyRevenue += order.totalPrice || 0;
    chartGrouped[dateStr].count++;
  }
  const salesChart = Object.values(chartGrouped).sort((a, b) => a._id.localeCompare(b._id));

  // --- TOP & FLOP INGRÉDIENTS ---
  // NOTE F2: fetch puis group-by JS. Acceptable pour le volume Café Verde (<100k orders).
  // À migrer vers BigQuery si volume explose.
  // Réutilise allOrders (non-cancelled) — $unwind remplacé par flatMap JS
  const allIngredients = allOrders.flatMap(o => o.ingredients || []);
  const ingGrouped     = {};
  for (const ing of allIngredients) {
    const name = ing?.name || 'inconnu';
    ingGrouped[name] = (ingGrouped[name] || 0) + 1;
  }
  const ingredientStats = Object.entries(ingGrouped)
    .map(([name, count]) => ({ _id: name, count }))
    .sort((a, b) => b.count - a.count);

  const topIngredients  = ingredientStats.slice(0, 5);
  const flopIngredients = ingredientStats.slice(-5).reverse();

  // --- ALERTE STOCK (ingrédients populaires mais indisponibles) ---
  const unavailableSnap        = await ingredientsCol.where('isAvailable', '==', false).get();
  const unavailableIngredients = unavailableSnap.docs.map(doc => ({ id: doc.id, _id: doc.id, ...doc.data() }));

  const criticalStockAlerts = unavailableIngredients.filter(ing =>
    topIngredients.some(top => top._id === ing.name)
  );

  res.json({
    kpi: {
      revenue:   totalRevenue,
      orders:    totalOrders,
      avgBasket
    },
    chart:         salesChart,
    topIngredients,
    flopIngredients,
    alerts:        criticalStockAlerts
  });
});

// Une commande inclut-elle un menu (Solo/L/XL) ? menu legacy au top-level ou imbriqué par item.
const hasMenu = (o) => {
  if (o.menu) return true;
  if (Array.isArray(o.salads) && o.salads.some(s => s && s.menu)) return true;
  if (Array.isArray(o.dishes) && o.dishes.some(d => d && d.menu)) return true;
  return false;
};

// Catégorie exclusive d'une commande (priorité au menu pour le préciser).
const orderType = (o) => {
  const hasSalade = !!o.formula || (Array.isArray(o.salads) && o.salads.length > 0);
  const hasDish   = Array.isArray(o.dishes) && o.dishes.length > 0;
  if (hasMenu(o))           return 'menu';
  if (hasSalade && hasDish) return 'mixed';
  if (hasSalade)            return 'salade';
  if (hasDish)              return 'dish';
  return 'product';
};

// Moyens de paiement réellement encaissés (les points sont déjà déduits du finalPrice,
// ils n'encaissent rien → pas de bucket).
// `mealCard` = titre-restaurant passé au terminal (Swile, Edenred…) : versé par Stripe comme une
// carte bancaire, mais compté à part pour que chaque total se rapproche de son relevé
// (Stripe = card + mealCard, centrale des titres-restaurant = ticket papier).
const PAYMENT_BUCKETS = ['cash', 'card', 'mealCard', 'ticket', 'online'];

// Net encaissé d'une part d'addition séparée : montant de la part moins ses points.
const partNet = (p) => Math.max(0, (Number(p.amount) || 0) - (Number(p.pointsRedeemed) || 0) / POINTS_PER_EURO);

// Titres-restaurant passés au terminal sur un règlement (0 pour un règlement à l'ancien format).
const mealCardOf = (d) => sumKind(sanitizeCardPayments(d?.cardPayments), 'meal_card');

const addMixedInto = (acc, d) => {
  acc.card     += Math.max(0, Number(d?.cardAmount)   || 0);
  acc.mealCard += mealCardOf(d);
  acc.ticket   += Math.max(0, Number(d?.ticketAmount) || 0);
  acc.cash     += Math.max(0, Number(d?.cashAmount)   || 0);
};

// Règlement « titres-restaurant » : la part passée au terminal, le reste en papier.
const addTicketInto = (acc, d, net) => {
  const meal = Math.min(net, mealCardOf(d));
  acc.mealCard += meal;
  acc.ticket   += net - meal;
};

/**
 * Ventile le montant d'une commande par moyen de paiement réellement encaissé.
 * Une addition séparée ou un paiement mixte alimente plusieurs buckets (une part carte
 * + une part espèces = deux montants distincts), sinon le tiroir-caisse est faux.
 * Invariant : la somme des buckets vaut le finalPrice de la commande.
 */
const paymentSplitOf = (o) => {
  const acc = { cash: 0, card: 0, mealCard: 0, ticket: 0, online: 0 };
  const fp = o.finalPrice ?? o.totalPrice ?? 0;
  const m  = o.paymentMethod;

  if (o.isSplit && Array.isArray(o.splitPayments) && o.splitPayments.length) {
    for (const p of o.splitPayments) {
      if (p.method === 'mixed') addMixedInto(acc, p);
      else if (p.method === 'ticket') addTicketInto(acc, p, partNet(p));
      else if (p.method === 'cash' || p.method === 'card') acc[p.method] += partNet(p);
      // 'points' : part entièrement réglée en points, rien d'encaissé.
    }
  } else if (m === 'mixed') {
    addMixedInto(acc, o.paymentDetails);
  } else if (m === 'ticket') {
    addTicketInto(acc, o.paymentDetails, fp);
  } else if (m === 'cash' || m === 'card') {
    acc[m] += fp;
  } else if (m !== 'points') {
    acc.online += fp; // commande en ligne (pas de paymentMethod posé) ou moyen inconnu
  }

  // Garde-fou : un détail incomplet (part manquante, mixte sans paymentDetails) ne doit
  // pas faire diverger la répartition du CA net → l'écart part sur le bucket principal.
  const gap = fp - PAYMENT_BUCKETS.reduce((s, k) => s + acc[k], 0);
  if (Math.abs(gap) > 0.01) {
    acc[PAYMENT_BUCKETS.includes(m) ? m : (o.source === 'online' ? 'online' : 'cash')] += gap;
  }
  return acc;
};

/**
 * @desc    Données comptables sur une période donnée
 * @route   GET /api/admin/accounting?from=YYYY-MM-DD&to=YYYY-MM-DD
 * @access  Private (Admin)
 */
const getAccountingData = asyncHandler(async (req, res) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1); // 1er du mois courant
  const defaultTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); // dernier jour du mois

  // Les bornes reçues (YYYY-MM-DD) désignent des jours en heure Guadeloupe (UTC−4,
  // pas de changement d'heure). On les ancre explicitement pour éviter que JS ne les
  // interprète dans le fuseau du serveur (UTC en prod), ce qui décalait la période d'un jour.
  const from = req.query.from ? new Date(req.query.from + 'T00:00:00.000-04:00') : defaultFrom;
  const to   = req.query.to   ? new Date(req.query.to   + 'T23:59:59.999-04:00') : defaultTo;

  const snap   = await ordersCol.where('createdAt', '>=', from).where('createdAt', '<=', to).get();
  // Périmètre comptable : uniquement les commandes réellement encaissées (paid),
  // hors annulées. Les tickets ouverts / non réglés ne sont pas du chiffre d'affaires.
  const allInPeriod = snap.docs.map(doc => ({ id: doc.id, _id: doc.id, ...doc.data() }));
  const orders = allInPeriod.filter(o => o.paid === true && o.status !== 'cancelled');

  // Ventes annulées APRÈS encaissement dont l'argent n'a pas encore été rendu. Hors CA (la
  // commande est annulée) mais présentes physiquement en caisse : sans cette liste, l'écart
  // entre le tiroir et la comptabilité est invisible.
  const pendingRefunds = allInPeriod
    .filter(o => o.status === 'cancelled' && o.cancelType === 'refund_due')
    .map(o => ({
      _id:             o._id,
      customerName:    o.customerName || '—',
      createdAt:       toDate(o.createdAt).toISOString(),
      cancelledAmount: round2(o.cancelledAmount ?? 0),
      refundedAmount:  round2(o.refundedAmount ?? 0),
      due:             round2((o.cancelledAmount ?? 0) - (o.refundedAmount ?? 0)),
      // Moyens encaissés : indiquent si l'argent est dans le tiroir ou sur une carte.
      methods: [...new Set((o.cancelPayments || []).map(p => p.method).filter(Boolean))],
      payers:  [...new Set((o.cancelPayments || []).map(p => p.userName).filter(Boolean))],
    }))
    .filter(o => o.due > 0.001)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // TVA : config + catalogue actuel, pour recomposer à la volée la TVA des ANCIENNES commandes
  // (celles sans `taxBreakdown` figé). On retrouve le taux réel de chaque produit via son id.
  const taxConfig = await getTaxConfig();
  const [allProducts, allCats, allBubbleTeas, allMilkshakes] = await Promise.all([
    findAllProducts(), findAllCategories(), findAllBubbleTeas(), findAllMilkshakes(),
  ]);
  const productsById = Object.fromEntries(allProducts.map(p => [p._id || p.id, p]));
  const categoriesById = Object.fromEntries(allCats.map(c => [c._id || c.id, c]));
  const bubbleTeaCatById = Object.fromEntries(allBubbleTeas.map(b => [b._id || b.id, b.categoryId || null]));
  const milkshakeCatById = Object.fromEntries(allMilkshakes.map(m => [m._id || m.id, m.categoryId || null]));
  const enrichItems = (arr) => (arr || []).map(it => {
    const ref = productsById[it._id || it.id || it.productId];
    if (!ref) return it; // produit supprimé → retombera sur le taux par défaut du mode
    return {
      ...it,
      taxRate:         it.taxRate ?? ref.taxRate ?? null,
      taxRateDineIn:   it.taxRateDineIn ?? ref.taxRateDineIn ?? null,
      taxRateTakeaway: it.taxRateTakeaway ?? ref.taxRateTakeaway ?? null,
      categoryId:      it.categoryId ?? ref.categoryId ?? null,
    };
  });
  // Composables (bubble teas / milkshakes) : on injecte le categoryId de classement depuis le catalogue.
  const enrichComposable = (arr, idField, catById) => (arr || []).map(it => {
    const catId = it.categoryId ?? catById[it[idField] || it._id || it.id] ?? null;
    return catId ? { ...it, categoryId: catId } : it;
  });

  let grossRevenue  = 0;
  let netRevenue    = 0;
  let totalDiscounts = 0;
  const byPayment   = Object.fromEntries(PAYMENT_BUCKETS.map(k => [k, { count: 0, revenue: 0 }]));
  const byType      = {
    salade:  { count: 0, revenue: 0 },
    dish:    { count: 0, revenue: 0 },
    mixed:   { count: 0, revenue: 0 },
    menu:    { count: 0, revenue: 0 },
    product: { count: 0, revenue: 0 },
  };
  const byDay       = {};
  const taxByRate   = {}; // rate -> { rate, baseHT, tva, ttc } — TVA collectée, ajustée des remboursements

  for (const o of orders) {
    const fp = o.finalPrice ?? o.totalPrice ?? 0;
    const tp = o.totalPrice ?? 0;
    const dc = o.discountAmount ?? 0;
    const rf = o.refundedAmount ?? 0;
    // Revenu net réellement encaissé : montant final moins les remboursements.
    const net = fp - rf;

    grossRevenue   += tp;
    netRevenue     += net;
    totalDiscounts += dc;

    // TVA collectée.
    const bd = Array.isArray(o.taxBreakdown) ? o.taxBreakdown : [];
    if (bd.length) {
      // Commande récente : ventilation FIGÉE en base, abattue au prorata des remboursements.
      const taxFactor = fp > 0 ? Math.max(0, net / fp) : 0;
      for (const line of bd) {
        const r = Number(line.rate);
        if (!taxByRate[r]) taxByRate[r] = { rate: r, baseHT: 0, tva: 0, ttc: 0 };
        taxByRate[r].baseHT += (line.baseHT ?? 0) * taxFactor;
        taxByRate[r].tva    += (line.tva ?? 0) * taxFactor;
        taxByRate[r].ttc    += (line.ttc ?? 0) * taxFactor;
      }
    } else if (net > 0) {
      // Ancienne commande : recomposition à la volée depuis le détail réel + catalogue actuel
      // (override alcool exact ; mode = mode par défaut faute de l'info à l'époque).
      const recomposed = buildOrderTax({
        products: enrichItems(o.products),
        cartProducts: enrichItems(o.cartProducts),
        bubbleTeas: enrichComposable(o.bubbleTeas, 'bubbleTeaId', bubbleTeaCatById),
        milkshakes: enrichComposable(o.milkshakes, 'milkshakeId', milkshakeCatById),
        totalPrice: tp,
        finalPrice: net,
        consumptionMode: taxConfig.defaultMode,
        config: taxConfig,
        categoriesById,
      });
      for (const line of recomposed.breakdown) {
        const r = Number(line.rate);
        if (!taxByRate[r]) taxByRate[r] = { rate: r, baseHT: 0, tva: 0, ttc: 0 };
        taxByRate[r].baseHT += line.baseHT;
        taxByRate[r].tva    += line.tva;
        taxByRate[r].ttc    += line.ttc;
      }
    }

    // Répartition mode de paiement : ventilée par montant réellement encaissé
    // (une addition séparée alimente plusieurs buckets), abattue au prorata des
    // remboursements comme la TVA. `count` = commandes ayant touché ce moyen.
    const payFactor = fp > 0 ? Math.max(0, net / fp) : 0;
    const paySplit  = paymentSplitOf(o);
    for (const k of PAYMENT_BUCKETS) {
      const amount = paySplit[k] * payFactor;
      if (amount > 0.005) { byPayment[k].count++; byPayment[k].revenue += amount; }
    }

    // Répartition type de commande (catégories exclusives, couvrent 100% des commandes)
    const t = orderType(o);
    byType[t].count++;
    byType[t].revenue += net;

    // Répartition par jour
    const day = toDate(o.createdAt).toISOString().split('T')[0];
    if (!byDay[day]) byDay[day] = { date: day, orders: 0, netRevenue: 0, grossRevenue: 0 };
    byDay[day].orders++;
    byDay[day].netRevenue   += net;
    byDay[day].grossRevenue += tp;
  }

  const totalOrders = orders.length;
  const avgTicket   = totalOrders > 0 ? netRevenue / totalOrders : 0;

  const orderList = orders
    .map(o => ({
      _id:           o._id,
      customerName:  o.customerName || '—',
      createdAt:     toDate(o.createdAt).toISOString(),
      totalPrice:    o.totalPrice    ?? 0,
      finalPrice:    o.finalPrice    ?? o.totalPrice ?? 0,
      refundedAmount: o.refundedAmount ?? 0,
      discountAmount: o.discountAmount ?? 0,
      manualDiscount: o.manualDiscount ?? 0,
      pointsRedeemed: o.pointsRedeemed ?? 0,
      paymentMethod: o.paymentMethod || null, // null = réglée par carte sur le site
      status:        o.status,
      type:          orderType(o),
      // Rattachement à la transaction Stripe (pointage compta, pourboire du terminal).
      // Une addition séparée porte un PaymentIntent par part réglée en carte.
      // Un règlement peut aussi avoir passé plusieurs cartes au terminal (cardPayments).
      paymentIntentIds: [
        o.paymentIntentId,
        ...paymentIntentIdsOf(o.paymentDetails),
        ...(o.splitPayments || []).flatMap(paymentIntentIdsOf),
      ].filter((v, i, a) => v && a.indexOf(v) === i),
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    period:         { from: from.toISOString(), to: to.toISOString() },
    totalOrders,
    grossRevenue:   parseFloat(grossRevenue.toFixed(2)),
    netRevenue:     parseFloat(netRevenue.toFixed(2)),
    totalDiscounts: parseFloat(totalDiscounts.toFixed(2)),
    avgTicket:      parseFloat(avgTicket.toFixed(2)),
    byPayment: Object.fromEntries(
      PAYMENT_BUCKETS.map(k => [k, { count: byPayment[k].count, revenue: parseFloat(byPayment[k].revenue.toFixed(2)) }])
    ),
    byType,
    byDay:          Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    tax: {
      byRate: Object.values(taxByRate)
        .map(t => ({
          rate:   t.rate,
          baseHT: parseFloat(t.baseHT.toFixed(2)),
          tva:    parseFloat(t.tva.toFixed(2)),
          ttc:    parseFloat(t.ttc.toFixed(2)),
        }))
        .sort((a, b) => a.rate - b.rate),
      totalHT:  parseFloat(Object.values(taxByRate).reduce((s, t) => s + t.baseHT, 0).toFixed(2)),
      totalTVA: parseFloat(Object.values(taxByRate).reduce((s, t) => s + t.tva, 0).toFixed(2)),
    },
    orders:         orderList,
    // Hors CA : argent encaissé sur des ventes annulées, pas encore rendu au client.
    pendingRefunds,
    pendingRefundsTotal: round2(pendingRefunds.reduce((s, o) => s + o.due, 0)),
  });
});

module.exports = { getDashboardStats, getAccountingData };
