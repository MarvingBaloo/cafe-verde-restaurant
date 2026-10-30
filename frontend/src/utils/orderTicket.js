// Construction des props du composant Ticket à partir d'une commande Firestore.
// Source de vérité unique partagée par l'Espace Gérant (Admin) et l'Espace DEV
// → garantit un rendu de ticket strictement identique partout.

import { POINTS_PER_EURO } from './loyalty';
import { terminalLines } from './cardPayments';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => `${r2(n).toFixed(2)} €`;
const nameOf = (x) => (typeof x === 'object' ? (x?.name ?? '') : (x ?? ''));
// Nom du menu si ce n'est pas une formule sans menu (Solo / Sans Menu n'apportent rien à afficher).
const menuLabel = (menu) => {
  const n = nameOf(menu);
  return n && n !== 'Solo' && n !== 'Sans Menu' ? n : null;
};

// Libellé d'identification d'une commande — SOURCE UNIQUE, à utiliser partout (KDS, caisse,
// espace client, gérant, compta, ticket, email). Le backend attribue un code ALÉATOIRE
// (CA-XXXXXX en caisse / WB-XXXXXX sur le web), tiré dans un alphabet sans caractères
// ambigus et vérifié unique en base à chaque tirage : aucun ordre de passage ni volume
// d'activité ne doit être déductible du numéro — c'est une décision assumée, pas un
// compteur. Les commandes antérieures n'en ont pas et retombent sur les 4 derniers
// caractères de leur id. Ne JAMAIS redériver ce libellé localement : c'est ce qui avait
// fait diverger la cuisine (slice -4) et l'espace client (slice -6).
export const orderLabel = (order) =>
  order?.orderNumber || `#${String(order?._id || order?.id || '').slice(-4).toUpperCase()}`;

// Convertit une valeur date Firestore (Timestamp sérialisé {_seconds}, ISO, ou Date) en Date JS.
export const tsToDate = (val) => {
  if (!val) return null;
  if (typeof val === 'object' && typeof val._seconds === 'number') return new Date(val._seconds * 1000);
  if (typeof val.toDate === 'function') return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const methodLabel = (m) => ({
  cash: 'Espèces', card: 'Carte', ticket: 'Tickets resto', mixed: 'Mixte',
  points: 'Points fidélité', split: 'Addition séparée', onsite: 'À régler sur place',
}[m] || (m || '—'));

export const orderToLines = (order) => {
  const qtyLabel = (q, name) => `${q > 1 ? `${q}× ` : ''}${name}`;
  const lines = [];

  const salList = order.salads?.length
    ? order.salads
    : (order.formula ? [{ formula: order.formula, quantity: order.formulaQuantity, menu: order.menu, menuProducts: order.menuProducts }] : []);
  salList.forEach((s, i) => {
    const name = typeof s.formula === 'object' ? s.formula?.name : s.formula;
    const qty = s.quantity || 1;
    const price = r2(s.subtotal != null ? s.subtotal : (typeof s.formula === 'object' ? (s.formula?.price || 0) * qty : 0));
    const menu = menuLabel(s.menu);
    const details = menu && s.menuProducts?.length ? `Menu : ${s.menuProducts.map(nameOf).join(', ')}` : (menu || undefined);
    lines.push({ key: `salad-${i}`, label: qtyLabel(qty, `Salade ${name || ''}`.trim()) + (menu ? ` — ${menu}` : ''), price, details });
  });
  (order.dishes || []).forEach((d, i) => {
    const qty = d.quantity || 1;
    const price = r2(d.subtotal != null ? d.subtotal : (d.price || 0) * qty);
    const menu = menuLabel(d.menu);
    const parts = [];
    if (d.selectedSides?.length) parts.push(`+ ${d.selectedSides.map(nameOf).join(', ')}`);
    if (menu) parts.push(d.menuProducts?.length ? `Menu : ${d.menuProducts.map(nameOf).join(', ')}` : menu);
    lines.push({ key: `dish-${i}`, label: qtyLabel(qty, d.name || 'Plat') + (menu ? ` — ${menu}` : ''), price, details: parts.length ? parts.join(' · ') : undefined });
  });
  (order.bubbleTeas || []).forEach((b, i) => {
    const qty = b.quantity || 1;
    const price = r2(b.subtotal != null ? b.subtotal : (b.price || 0) * qty);
    const details = Object.entries((b.selections || []).reduce((acc, s) => {
      const c = s.category || 'Options'; (acc[c] = acc[c] || []).push(s.name); return acc;
    }, {})).map(([c, names]) => `${c}: ${names.join(', ')}`).join(' · ');
    lines.push({ key: `bt-${i}`, label: qtyLabel(qty, b.name || 'Bubble tea'), price, details: details || undefined });
  });
  (order.milkshakes || []).forEach((m, i) => {
    const qty = m.quantity || 1;
    const price = r2(m.subtotal != null ? m.subtotal : (m.price || 0) * qty);
    const details = Object.entries((m.selections || []).reduce((acc, s) => {
      const c = s.category || 'Options'; (acc[c] = acc[c] || []).push(s.name); return acc;
    }, {})).map(([c, names]) => `${c}: ${names.join(', ')}`).join(' · ');
    lines.push({ key: `ms-${i}`, label: qtyLabel(qty, m.name || 'Milkshake'), price, details: details || undefined });
  });
  const extrasDetails = (p) => (p.selectedExtras?.length ? `+ ${p.selectedExtras.map(nameOf).join(', ')}` : undefined);
  (order.products || []).forEach((p, i) => {
    const qty = p.quantity || 1;
    lines.push({ key: `product-${i}`, label: qtyLabel(qty, p.name || 'Produit'), price: r2((p.price || 0) * qty), details: extrasDetails(p) });
  });
  (order.cartProducts || []).forEach((p, i) => {
    const qty = p.quantity || 1;
    lines.push({ key: `cart-${i}`, label: qtyLabel(qty, p.name || 'Produit'), price: r2((p.price || 0) * qty), details: extrasDetails(p) });
  });
  return lines;
};

// Construit les props du composant Ticket à partir d'une commande Firestore (même rendu qu'en caisse).
export const orderToTicket = (order) => {
  // Remise commerciale / points : détaillés dans le bloc articles (sous-total → remise → total net),
  // pour que le TOTAL en gras corresponde au montant réellement payé.
  const hasReduction = (order.manualDiscount || 0) > 0 || (order.pointsRedeemed || 0) > 0;
  const net = r2(order.finalPrice != null ? order.finalPrice : order.totalPrice);
  const breakdownLines = hasReduction
    ? [
        { key: 'subtotal', label: 'Sous-total', price: r2(order.totalPrice) },
        ...((order.manualDiscount || 0) > 0 ? [{ key: 'discount', label: 'Remise', price: -r2(order.manualDiscount) }] : []),
        ...((order.pointsRedeemed || 0) > 0 ? [{ key: 'points', label: `Points (${order.pointsRedeemed} pts)`, price: -r2(order.discountAmount) }] : []),
      ]
    : [];

  const paymentLines = [];
  if (order.isSplit) {
    paymentLines.push(`Paiement : addition séparée${order.splitCount ? ` (${order.splitCount} parts)` : ''}`);
  } else {
    paymentLines.push(`Paiement : ${methodLabel(order.paymentMethod)}`);
    const pd = order.paymentDetails;
    if (order.paymentMethod === 'mixed' && pd) {
      paymentLines.push(...terminalLines(pd, fmt));
      if (pd.ticketAmount > 0) paymentLines.push(`Tickets resto : ${fmt(pd.ticketAmount)}`);
      if (pd.cashAmount > 0) paymentLines.push(`Espèces : ${fmt(pd.cashAmount)}`);
      if (pd.change > 0) paymentLines.push(`Rendu : ${fmt(pd.change)}`);
    }
    // Titre-restaurant passé au terminal (carte Swile, Edenred…) : le préciser, « Tickets resto »
    // seul laisserait croire à des tickets papier.
    if (order.paymentMethod === 'ticket' && pd) paymentLines.push(...terminalLines(pd, fmt));
  }

  const TZ = { timeZone: 'America/Guadeloupe' };
  const paidDate = tsToDate(order.paidAt);
  if (!order.paid) {
    paymentLines.push('Non réglé (à payer sur place)');
  } else if (paidDate) {
    paymentLines.push(`Payé le ${paidDate.toLocaleString('fr-FR', TZ)}`);
  } else {
    const fallback = tsToDate(order.updatedAt);
    if (fallback) paymentLines.push(`Payé le ${fallback.toLocaleString('fr-FR', TZ)} (estimé)`);
  }

  let extraTitle, extraLines;
  if ((order.refundedAmount || 0) > 0) {
    extraTitle = 'Remboursement';
    extraLines = [{ label: 'Remboursé', value: fmt(order.refundedAmount) }];
  }

  // Heure de retrait choisie par le client — n'existe que sur une commande en ligne
  // programmée (cf. backend/utils/hours.js). `order.scheduledFor` absent → pas de ligne.
  const pickupAt = tsToDate(order.scheduledFor);
  const pickupLabel = pickupAt
    ? `Retrait prévu à ${pickupAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...TZ })}`
    : null;

  return {
    subheading: `Commande ${orderLabel(order)}`,
    createdAt: tsToDate(order.createdAt) || new Date(),
    customerName: order.customerName,
    pickupLabel,
    lines: [...orderToLines(order), ...breakdownLines],
    total: hasReduction ? net : r2(order.totalPrice),
    totalLabel: 'Total',
    paymentLines,
    extraTitle,
    extraLines,
    tax: (order.totalTVA > 0 && Array.isArray(order.taxBreakdown) && order.taxBreakdown.length)
      ? { breakdown: order.taxBreakdown, totalTVA: r2(order.totalTVA), totalHT: r2(order.totalHT), consumptionMode: order.consumptionMode }
      : null,
    serviceRate: order.serviceRate || 0,
  };
};

/**
 * Ticket d'UNE part encaissée en cours de service (convive parti avant la fin du repas).
 * Même forme que `orderToTicket`, donc le composant `Ticket` le rend sans rien savoir de plus.
 *
 * ⚠️ Miroir EXACT de `partToTicket` dans backend/services/receiptRenderer.js, qui alimente
 * l'email et le SMS. Toute évolution ici doit y être reportée : la divergence silencieuse des
 * renderers s'est déjà produite sur ce projet.
 *
 * La TVA est ventilée AU PRORATA de la part : la ventilation figée de la table n'existe qu'à sa
 * clôture, et un justificatif sans TVA ne servirait à rien au client.
 */
export const partToTicket = (order, part) => {
  const gross = r2(part.amount);
  const pts = Math.max(0, Math.floor(Number(part.pointsRedeemed) || 0));
  const net = r2(Math.max(0, gross - pts / POINTS_PER_EURO));

  const lines = Array.isArray(part.items) && part.items.length
    ? part.items.map((it) => ({ label: it.label, price: r2(it.price) }))
    : [{ label: 'Part sur addition', price: gross }];
  if (pts > 0) {
    lines.push({ label: 'Sous-total', price: gross });
    lines.push({ label: `Points (${pts} pts)`, price: -r2(pts / POINTS_PER_EURO) });
  }

  const m = part.method;
  const paymentLines = m === 'points'
    ? ['Réglé intégralement en points']
    : m === 'ticket'
      ? (terminalLines(part, fmt).length ? terminalLines(part, fmt) : ['Réglé en tickets restaurant'])
      : m === 'cash'
        ? [`Espèces — donné ${fmt(part.cashGiven || 0)}, rendu ${fmt(part.change || 0)}`]
        : m === 'mixed'
          ? [
              ...terminalLines(part, fmt),
              ...((part.cashAmount || 0) > 0 ? [`Espèces : ${fmt(part.cashAmount)} — donné ${fmt(part.cashGiven || 0)}, rendu ${fmt(part.change || 0)}`] : []),
              ...((part.ticketAmount || 0) > 0 ? [`Tickets resto : ${fmt(part.ticketAmount)}`] : []),
            ]
          : ['Réglé par carte'];

  const total = r2(order.totalPrice || 0);
  const factor = total > 0 ? gross / total : 0;
  const bd = Array.isArray(order.taxBreakdown) ? order.taxBreakdown : [];
  const tax = bd.length
    ? {
        consumptionMode: order.consumptionMode || 'dineIn',
        breakdown: bd.map((x) => ({ rate: x.rate, baseHT: r2(x.baseHT * factor), tva: r2(x.tva * factor) })),
        totalHT: r2((order.totalHT || 0) * factor),
        totalTVA: r2((order.totalTVA || 0) * factor),
      }
    : null;

  const paidSoFar = r2((order.splitPayments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0));
  // Une addition séparée est toujours une commande de caisse (jamais 'scheduledFor') : ce champ
  // reste null en pratique. Calculé quand même pour ne pas faire diverger la forme des deux tickets.
  const pickupAt = tsToDate(order.scheduledFor);
  const pickupLabel = pickupAt
    ? `Retrait prévu à ${pickupAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Guadeloupe' })}`
    : null;
  return {
    subheading: 'Justificatif de part',
    createdAt: tsToDate(part.paidAt) || tsToDate(order.createdAt) || new Date(),
    customerName: part.userName || null,
    pickupLabel,
    lines,
    total: net,
    totalLabel: 'Payé',
    paymentLines,
    tax,
    serviceRate: order.serviceRate || 0,
    // Une table close n'a plus de « reste à payer » : le rappel ne vaut que pendant le service.
    extraTitle: order.paid ? null : 'Addition en cours',
    extraLines: order.paid ? [] : [
      { label: 'Ticket', value: order.customerName || 'Table' },
      { label: 'Reste à payer', value: fmt(Math.max(0, total - paidSoFar)) },
    ],
  };
};

/** Parts distinctes d'une addition séparée, fusionnées si une part a été réglée en plusieurs fois. */
export const orderParts = (order) => {
  if (!order?.isSplit || !Array.isArray(order.splitPayments)) return [];
  const byIndex = new Map();
  order.splitPayments.forEach((p, i) => {
    const idx = p.index != null ? Number(p.index) : i + 1;
    const cur = byIndex.get(idx);
    if (cur) cur.amount = r2(cur.amount + (Number(p.amount) || 0));
    else byIndex.set(idx, { ...p, index: idx, amount: r2(Number(p.amount) || 0) });
  });
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
};
