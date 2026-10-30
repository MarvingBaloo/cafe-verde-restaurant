// backend/services/receiptRenderer.js
// Rend le contenu d'un ticket de commande pour l'envoi email (HTML) et SMS (texte court).
//
// ⚠️ Source de vérité : ce module reproduit fidèlement la logique du ticket IMPRIMÉ
// (frontend/src/utils/orderTicket.js → orderToTicket/orderToLines + composant Ticket.jsx).
// Le ticket envoyé par email/SMS doit être IDENTIQUE au ticket imprimé. Toute évolution
// du ticket imprimé doit être répercutée ici (et inversement).

const PAY_LABELS = {
  cash: 'Espèces', card: 'Carte', ticket: 'Tickets resto', mixed: 'Mixte',
  points: 'Points fidélité', split: 'Addition séparée', onsite: 'À régler sur place',
  online: 'En ligne',
};
const methodLabel = (m) => PAY_LABELS[m] || (m || '—');

// Mentions légales fixes de l'établissement (affichées en pied de ticket).
const SIRET = '10640501200027';
const TVA_INTRA = 'FR76106405012';
const ADDRESS_LINES = ['10, Les Poiriers de la Marina,', 'Marina Bas-du-Fort', '97110 Pointe-à-Pitre'];

const { POINTS_PER_EURO } = require('../utils/loyalty');
const { terminalLines } = require('../utils/cardPayments');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const eur = (n) => `${r2(n).toFixed(2)} €`;
const nameOf = (x) => (typeof x === 'object' ? (x?.name ?? '') : (x ?? ''));
// Nom du menu si ce n'est pas une formule sans menu (Solo / Sans Menu n'apportent rien à afficher).
const menuLabel = (menu) => {
  const n = nameOf(menu);
  return n && n !== 'Solo' && n !== 'Sans Menu' ? n : null;
};

function toJsDate(val) {
  if (!val) return new Date();
  if (typeof val.toDate === 'function') return val.toDate();
  if (val._seconds != null) return new Date(val._seconds * 1000);
  if (val.seconds != null) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
}

const TZ = { timeZone: 'America/Guadeloupe' };
// Miroir de frontend/src/utils/orderTicket.js → orderLabel. Toute évolution ici doit y être
// répercutée (règle de propagation multi-renderer : print / email / SMS / modale historique).
const orderLabel = (order) =>
  order.orderNumber || `#${String(order._id || order.id || '').slice(-4).toUpperCase()}`;

// → [{ label, price, details }] — strictement aligné sur orderToLines (ticket imprimé).
function orderToLines(order) {
  const qtyLabel = (q, name) => `${q > 1 ? `${q}× ` : ''}${name}`;
  const lines = [];

  const salList = order.salads?.length
    ? order.salads
    : (order.formula ? [{ formula: order.formula, quantity: order.formulaQuantity, subtotal: order.subtotal, menu: order.menu, menuProducts: order.menuProducts }] : []);
  salList.forEach((s) => {
    const name = typeof s.formula === 'object' ? s.formula?.name : s.formula;
    const qty = s.quantity || 1;
    const price = r2(s.subtotal != null ? s.subtotal : (typeof s.formula === 'object' ? (s.formula?.price || 0) * qty : 0));
    const menu = menuLabel(s.menu);
    const details = menu && s.menuProducts?.length ? `Menu : ${s.menuProducts.map(nameOf).join(', ')}` : (menu || undefined);
    lines.push({ label: qtyLabel(qty, `Salade ${name || ''}`.trim()) + (menu ? ` — ${menu}` : ''), price, details });
  });
  (order.dishes || []).forEach((d) => {
    const qty = d.quantity || 1;
    const price = r2(d.subtotal != null ? d.subtotal : (d.price || 0) * qty);
    const menu = menuLabel(d.menu);
    const parts = [];
    if (d.selectedSides?.length) parts.push(`+ ${d.selectedSides.map(nameOf).join(', ')}`);
    if (menu) parts.push(d.menuProducts?.length ? `Menu : ${d.menuProducts.map(nameOf).join(', ')}` : menu);
    lines.push({ label: qtyLabel(qty, d.name || 'Plat') + (menu ? ` — ${menu}` : ''), price, details: parts.length ? parts.join(' · ') : undefined });
  });
  const groupSelections = (selections) =>
    Object.entries((selections || []).reduce((acc, s) => {
      const c = s.category || 'Options'; (acc[c] = acc[c] || []).push(s.name); return acc;
    }, {})).map(([c, names]) => `${c}: ${names.join(', ')}`).join(' · ');
  (order.bubbleTeas || []).forEach((b) => {
    const qty = b.quantity || 1;
    const price = r2(b.subtotal != null ? b.subtotal : (b.price || 0) * qty);
    const details = groupSelections(b.selections);
    lines.push({ label: qtyLabel(qty, b.name || 'Bubble tea'), price, details: details || undefined });
  });
  (order.milkshakes || []).forEach((m) => {
    const qty = m.quantity || 1;
    const price = r2(m.subtotal != null ? m.subtotal : (m.price || 0) * qty);
    const details = groupSelections(m.selections);
    lines.push({ label: qtyLabel(qty, m.name || 'Milkshake'), price, details: details || undefined });
  });
  const extrasDetails = (p) => (p.selectedExtras?.length ? `+ ${p.selectedExtras.map(nameOf).join(', ')}` : undefined);
  (order.products || []).forEach((p) => {
    const qty = p.quantity || 1;
    lines.push({ label: qtyLabel(qty, p.name || 'Produit'), price: r2((p.price || 0) * qty), details: extrasDetails(p) });
  });
  (order.cartProducts || []).forEach((p) => {
    const qty = p.quantity || 1;
    lines.push({ label: qtyLabel(qty, p.name || 'Produit'), price: r2((p.price || 0) * qty), details: extrasDetails(p) });
  });
  return lines;
}

// Props du ticket — strictement aligné sur orderToTicket (ticket imprimé).
function orderToTicket(order) {
  const hasReduction = (order.manualDiscount || 0) > 0 || (order.pointsRedeemed || 0) > 0;
  const net = r2(order.finalPrice != null ? order.finalPrice : order.totalPrice);
  const breakdownLines = hasReduction
    ? [
        { label: 'Sous-total', price: r2(order.totalPrice) },
        ...((order.manualDiscount || 0) > 0 ? [{ label: 'Remise', price: -r2(order.manualDiscount) }] : []),
        ...((order.pointsRedeemed || 0) > 0 ? [{ label: `Points (${order.pointsRedeemed} pts)`, price: -r2(order.discountAmount) }] : []),
      ]
    : [];

  const paymentLines = [];
  if (order.isSplit) {
    paymentLines.push(`Paiement : addition séparée${order.splitCount ? ` (${order.splitCount} parts)` : ''}`);
  } else {
    paymentLines.push(`Paiement : ${methodLabel(order.paymentMethod)}`);
    const pd = order.paymentDetails;
    if (order.paymentMethod === 'mixed' && pd) {
      paymentLines.push(...terminalLines(pd, eur));
      if (pd.ticketAmount > 0) paymentLines.push(`Tickets resto : ${eur(pd.ticketAmount)}`);
      if (pd.cashAmount > 0) paymentLines.push(`Espèces : ${eur(pd.cashAmount)}`);
      if (pd.change > 0) paymentLines.push(`Rendu : ${eur(pd.change)}`);
    }
    // Titre-restaurant passé au terminal (carte Swile, Edenred…) : le préciser, « Tickets resto »
    // seul laisserait croire à des tickets papier.
    if (order.paymentMethod === 'ticket' && pd) paymentLines.push(...terminalLines(pd, eur));
  }

  if (!order.paid) {
    paymentLines.push('Non réglé (à payer sur place)');
  } else if (order.paidAt) {
    paymentLines.push(`Payé le ${toJsDate(order.paidAt).toLocaleString('fr-FR', TZ)}`);
  } else if (order.updatedAt) {
    paymentLines.push(`Payé le ${toJsDate(order.updatedAt).toLocaleString('fr-FR', TZ)} (estimé)`);
  }

  let extraTitle, extraLines;
  if ((order.refundedAmount || 0) > 0) {
    extraTitle = 'Remboursement';
    extraLines = [{ label: 'Remboursé', value: eur(order.refundedAmount) }];
  }

  // Heure de retrait choisie par le client — n'existe que sur une commande en ligne
  // programmée (cf. backend/utils/hours.js). `order.scheduledFor` absent → pas de ligne.
  const pickupAt = order.scheduledFor ? toJsDate(order.scheduledFor) : null;
  const pickupLabel = pickupAt
    ? `Retrait prévu à ${pickupAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...TZ })}`
    : null;

  return {
    subheading: `Commande ${orderLabel(order)}`,
    createdAt: toJsDate(order.createdAt),
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
  };
}

// Nombre total d'articles (somme des quantités), pour le ticket « sans détail ».
/**
 * Ticket d'UNE part encaissée en cours de service (convive parti avant la fin du repas).
 * Même forme que `orderToTicket`, donc email et SMS le rendent avec le MÊME moteur : le
 * justificatif ne peut pas diverger du ticket de la table.
 *
 * ⚠️ Miroir de `buildPartSlip` dans frontend/src/pages/Caisse.jsx (version imprimée). Toute
 * évolution de l'un doit être reportée sur l'autre — la divergence silencieuse des renderers
 * s'est déjà produite sur ce projet.
 *
 * La TVA est ventilée AU PRORATA : la ventilation figée de la table n'existe qu'à sa clôture.
 */
function partToTicket(order, part) {
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
      ? (terminalLines(part, eur).length ? terminalLines(part, eur) : ['Réglé en tickets restaurant'])
      : m === 'cash'
        ? [`Espèces — donné ${eur(part.cashGiven || 0)}, rendu ${eur(part.change || 0)}`]
        : m === 'mixed'
          ? [
              ...terminalLines(part, eur),
              ...((part.cashAmount || 0) > 0 ? [`Espèces : ${eur(part.cashAmount)} — donné ${eur(part.cashGiven || 0)}, rendu ${eur(part.change || 0)}`] : []),
              ...((part.ticketAmount || 0) > 0 ? [`Tickets resto : ${eur(part.ticketAmount)}`] : []),
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

  const paidSoFar = r2((order.splitPayments || []).reduce((s2, x) => s2 + (Number(x.amount) || 0), 0));
  // Une addition séparée est toujours une commande de caisse (jamais 'scheduledFor') : ce champ
  // reste null en pratique. Calculé quand même pour ne pas faire diverger la forme des deux tickets.
  const pickupAt = order.scheduledFor ? toJsDate(order.scheduledFor) : null;
  const pickupLabel = pickupAt
    ? `Retrait prévu à ${pickupAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', ...TZ })}`
    : null;
  return {
    subheading: 'Justificatif de part',
    createdAt: toJsDate(part.paidAt) || toJsDate(order.createdAt) || new Date(),
    customerName: part.userName || null,
    pickupLabel,
    lines,
    total: net,
    totalLabel: 'Payé',
    paymentLines,
    tax,
    extraTitle: order.paid ? null : 'Addition en cours',
    extraLines: order.paid ? [] : [
      { label: 'Ticket', value: order.customerName || 'Table' },
      { label: 'Reste à payer', value: eur(Math.max(0, total - paidSoFar)) },
    ],
  };
}

function countItems(order) {
  const sum = (arr) => (Array.isArray(arr) ? arr : []).reduce((n, x) => n + (x.quantity || 1), 0);
  const salads = order.salads?.length
    ? order.salads
    : (order.formula ? [{ quantity: order.formulaQuantity }] : []);
  return salads.reduce((n, s) => n + (s.quantity || 1), 0)
    + sum(order.dishes) + sum(order.bubbleTeas) + sum(order.milkshakes)
    + sum(order.products) + sum(order.cartProducts);
}

// Libellé de type d'un produit (champ category = racine drink/coffee/dessert/side).
const PRODUCT_TYPE_LABELS = { drink: 'Boisson', coffee: 'Boisson', dessert: 'Dessert', side: 'Accompagnement' };
const productTypeLabel = (p) => PRODUCT_TYPE_LABELS[p && p.category] || 'Produit';

// Regroupe les articles par type/nature avec quantité — pour le ticket « sans détail ».
function typeSummary(order) {
  const counts = {};
  const order_ = [];
  const add = (label, qty) => {
    if (!(label in counts)) order_.push(label);
    counts[label] = (counts[label] || 0) + qty;
  };
  const salads = order.salads?.length
    ? order.salads
    : (order.formula ? [{ quantity: order.formulaQuantity }] : []);
  salads.forEach((s) => {
    add('Salade', s.quantity || 1);
    (s.menuProducts || []).forEach((mp) => add(productTypeLabel(mp), s.quantity || 1));
  });
  (order.dishes || []).forEach((d) => {
    add('Plat chaud', d.quantity || 1);
    (d.menuProducts || []).forEach((mp) => add(productTypeLabel(mp), d.quantity || 1));
  });
  (order.bubbleTeas || []).forEach((b) => add('Bubble tea', b.quantity || 1));
  (order.milkshakes || []).forEach((m) => add('Milkshake', m.quantity || 1));
  (order.products || []).forEach((p) => add(productTypeLabel(p), p.quantity || 1));
  (order.cartProducts || []).forEach((p) => add(productTypeLabel(p), p.quantity || 1));
  return order_.map((label) => ({ label, qty: counts[label] }));
}

function renderEmailHtml(order, { detail = true, part = null } = {}) {
  const t = part ? partToTicket(order, part) : orderToTicket(order);
  const date = t.createdAt.toLocaleString('fr-FR', TZ);

  // Un justificatif de part est toujours détaillé : `typeSummary` résumerait la TABLE entière,
  // pas la part — le client lirait des articles qu'il n'a pas payés.
  const itemRows = (part ? true : detail)
    ? t.lines.map((l) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee;">
        <div style="display:flex;justify-content:space-between;">
          <span style="font-weight:600;color:#111;">${escapeHtml(l.label)}</span>
          ${l.price != null ? `<span style="color:#111;white-space:nowrap;padding-left:12px;">${eur(l.price)}</span>` : ''}
        </div>
        ${l.details ? `<div style="font-size:12px;color:#666;">${escapeHtml(l.details)}</div>` : ''}
      </td>
    </tr>`).join('')
    : typeSummary(order).map((t) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee;">
        <div style="font-weight:600;color:#111;">${t.qty}× ${escapeHtml(t.label)}</div>
      </td>
    </tr>`).join('');

  const payRows = t.paymentLines.map((p) =>
    `<tr><td style="padding:2px 0;color:#999;font-size:12px;" colspan="2">${escapeHtml(p)}</td></tr>`).join('');

  const taxRows = t.tax
    ? `<tr><td colspan="2" style="padding-top:8px;border-top:1px dashed #ddd;color:#666;font-size:12px;">${t.tax.consumptionMode === 'takeaway' ? 'À emporter' : 'Sur place'}</td></tr>`
      + t.tax.breakdown.map((x) =>
        `<tr><td style="padding:1px 0;color:#666;font-size:12px;">TVA ${x.rate}% (HT ${eur(x.baseHT)})</td><td style="padding:1px 0;text-align:right;color:#666;font-size:12px;">${eur(x.tva)}</td></tr>`).join('')
      + `<tr><td style="padding:1px 0;font-size:12px;font-weight:bold;">Total TVA</td><td style="padding:1px 0;text-align:right;font-size:12px;font-weight:bold;">${eur(t.tax.totalTVA)}</td></tr>`
    : '';

  const refundRows = t.extraTitle
    ? `<tr><td colspan="2" style="padding-top:10px;border-top:1px dashed #ccc;font-weight:bold;">${escapeHtml(t.extraTitle)}</td></tr>`
      + t.extraLines.map((e) =>
        `<tr><td style="padding:2px 0;color:#b45309;">${escapeHtml(e.label)}</td><td style="padding:2px 0;text-align:right;color:#b45309;">${escapeHtml(e.value)}</td></tr>`).join('')
    : '';

  return `<!doctype html>
<html lang="fr"><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111;">
  <div style="max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
      <div style="background:#166534;color:#fff;padding:20px 24px;text-align:center;">
        <div style="font-size:22px;font-weight:bold;">Café Verde</div>
        <div style="font-size:13px;opacity:.85;">Votre ticket de commande</div>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 4px;font-size:15px;"><strong>${escapeHtml(t.subheading)}</strong></p>
        <p style="margin:0 0 2px;color:#666;font-size:13px;">${escapeHtml(date)}</p>
        ${t.customerName ? `<p style="margin:0 0 ${t.pickupLabel ? '8px' : '16px'};color:#666;font-size:13px;">${escapeHtml(t.customerName)}</p>` : ''}
        ${t.pickupLabel ? `<p style="margin:0 0 16px;padding:8px 12px;background:#f0fdf4;border-radius:8px;color:#166534;font-size:13px;font-weight:bold;">${escapeHtml(t.pickupLabel)}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;margin-top:8px;">${itemRows}</table>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px;">
          <tr>
            <td style="padding:6px 0;font-weight:bold;font-size:16px;">${escapeHtml(t.totalLabel)}</td>
            <td style="padding:6px 0;text-align:right;font-weight:bold;font-size:16px;">${eur(t.total)}</td>
          </tr>
          ${taxRows}
          ${payRows}
          ${refundRows}
        </table>
      </div>
      <div style="background:#f9fafb;padding:16px 24px;text-align:center;color:#888;font-size:12px;line-height:1.6;">
        Merci de votre visite ! · Café Verde<br>
        ${ADDRESS_LINES.join('<br>')}<br>
        <a href="https://www.cafeverde.gp" style="color:#166534;text-decoration:none;">www.cafeverde.gp</a> · 0590 02 07 23<br>
        Service compris<br>
        SIRET : ${SIRET} · TVA : ${TVA_INTRA}
      </div>
    </div>
  </div>
</body></html>`;
}

function renderSmsText(order, { detail = true, part = null } = {}) {
  const t = part ? partToTicket(order, part) : orderToTicket(order);
  const date = t.createdAt.toLocaleDateString('fr-FR', TZ);

  let itemsBlock;
  if (part ? true : detail) {
    const lines = t.lines.map((l) => {
      const price = l.price != null ? ` ${eur(l.price)}` : '';
      const det = l.details ? `\n  ${l.details}` : '';
      return `- ${l.label}${price}${det}`;
    });
    itemsBlock = lines.join('\n');
  } else {
    itemsBlock = typeSummary(order).map((t) => `${t.qty}× ${t.label}`).join('\n');
  }

  return [
    `Café Verde — ${t.subheading}`,
    date,
    t.customerName || null,
    t.pickupLabel || null,
    itemsBlock,
    `${t.totalLabel} : ${eur(t.total)}`,
    ...(t.tax ? [
      t.tax.consumptionMode === 'takeaway' ? 'À emporter' : 'Sur place',
      ...t.tax.breakdown.map((x) => `TVA ${x.rate}% : ${eur(x.tva)} (HT ${eur(x.baseHT)})`),
      `Total TVA : ${eur(t.tax.totalTVA)}`,
    ] : []),
    ...t.paymentLines,
    ...(t.extraTitle ? t.extraLines.map((e) => `${e.label} : ${e.value}`) : []),
    'Service compris',
    ...ADDRESS_LINES,
    `SIRET ${SIRET} - TVA ${TVA_INTRA}`,
    'Merci de votre visite !',
  ].filter(Boolean).join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { renderEmailHtml, renderSmsText, orderLabel, partToTicket };
