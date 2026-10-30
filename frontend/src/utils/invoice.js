// Construction d'une FACTURE à partir d'une commande Firestore.
//
// ⚠️ La logique métier n'est PAS redéfinie ici : lignes d'articles, ventilation TVA,
// décomposition remise/points et lignes de règlement sont reprises telles quelles de
// `orderTicket.js`. Une facture et un ticket portant des montants différents pour la
// même commande seraient un défaut de conformité — seule la PRÉSENTATION diffère.
//
// Rien n'est persisté : la facture est un rendu à la demande. Le numéro est dérivé du
// numéro de commande (décision assumée : la séquence est donc trouée, toutes les
// commandes ne donnant pas lieu à facture).
import { orderToTicket, orderLabel, tsToDate } from './orderTicket';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Somme des quantités de tous les articles — sert la facture non détaillée.
// Couvre les deux emplacements produits (`products` en caisse, `cartProducts` en ligne)
// et le format legacy `formula` des commandes antérieures aux multi-salades.
export const countOrderItems = (order) => {
  const sum = (arr) => (arr || []).reduce((n, x) => n + (x.quantity || 1), 0);
  const salads = order.salads?.length
    ? sum(order.salads)
    : (order.formula ? (order.formulaQuantity || 1) : 0);
  return salads
    + sum(order.dishes)
    + sum(order.bubbleTeas)
    + sum(order.milkshakes)
    + sum(order.products)
    + sum(order.cartProducts);
};

export const invoiceNumber = (order) => `FA-${String(orderLabel(order)).replace(/^#/, '')}`;

// billing : coordonnées saisies à l'édition (nom seul, ou raison sociale + adresse + SIRET/TVA).
// Aucune n'est obligatoire côté code — c'est l'opérateur qui juge de ce que le client demande.
export const orderToInvoice = (order, { detail = true, billing = {} } = {}) => {
  const t = orderToTicket(order);
  const count = countOrderItems(order);

  return {
    number: invoiceNumber(order),
    orderRef: orderLabel(order),
    issuedAt: new Date(),
    serviceDate: tsToDate(order.createdAt) || new Date(),
    paid: !!order.paid,
    paidAt: tsToDate(order.paidAt) || tsToDate(order.updatedAt),
    // Non détaillée : une ligne unique au montant net. On ne reprend pas la décomposition
    // sous-total / remise / points — la donner sans les articles ne renseignerait sur rien.
    lines: detail
      ? t.lines
      : [{
          key: 'lump',
          label: 'Prestation de restauration',
          price: t.total,
          details: `${count} article${count > 1 ? 's' : ''}`,
        }],
    total: t.total,
    tax: t.tax,
    paymentLines: t.paymentLines,
    customerName: order.customerName,
    billing,
    refundedAmount: r2(order.refundedAmount || 0),
  };
};
