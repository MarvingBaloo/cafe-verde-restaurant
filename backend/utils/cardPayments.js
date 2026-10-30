// Passages au terminal d'un même règlement.
//
// Un client peut régler une note en passant plusieurs cartes au terminal : trois cartes
// bancaires de trois comptes différents, ou sa carte bancaire puis sa carte titre-restaurant
// (Swile, Edenred, Up, Pluxee…). Chaque passage est une transaction Stripe distincte, donc un
// PaymentIntent distinct, à rembourser et à rapprocher séparément.
//
//   cardPayments: [{ amount, kind: 'card' | 'meal_card', paymentIntentId }]
//
// Le format s'applique à `paymentDetails` (paiement simple), à chaque entrée de `splitPayments`
// et de `cancelPayments`. Un règlement antérieur n'a qu'une carte, décrite par son
// `paymentIntentId` et un montant qui dépend du moyen : `terminalPassages` le ramène à un
// passage unique, si bien que les lecteurs (remboursement, compta, réintégration Stripe)
// n'ont qu'une forme à traiter.
//
// ⚠️ Miroir : frontend/src/utils/cardPayments.js.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function sanitizeCardPayments(list) {
  return (Array.isArray(list) ? list : [])
    .map((c) => ({
      amount: round2(c?.amount),
      kind: c?.kind === 'meal_card' ? 'meal_card' : 'card',
      paymentIntentId: c?.paymentIntentId || null,
    }))
    .filter((c) => c.amount > 0);
}

/**
 * @param entry         règlement persisté (paymentDetails, part, règlement annulé)
 * @param legacyAmount  montant carte d'un règlement à l'ancien format (sans `cardPayments`)
 */
function terminalPassages(entry, legacyAmount = 0) {
  const list = sanitizeCardPayments(entry?.cardPayments);
  if (list.length) return list;
  const amount = round2(legacyAmount);
  return amount > 0 ? [{ amount, kind: 'card', paymentIntentId: entry?.paymentIntentId || null }] : [];
}

const sumKind = (list, kind) => round2(list.filter((c) => c.kind === kind).reduce((s, c) => s + c.amount, 0));

/**
 * Recalcule les totaux d'un règlement depuis ses passages : `cardAmount` (cartes bancaires),
 * `mealCardAmount` (titres-restaurant passés au terminal). La caisse les envoie déjà, mais la
 * compta lit ces deux champs : ils ne doivent pas pouvoir contredire le détail.
 * Un règlement sans passage est rendu tel quel (même objet).
 */
function withTerminalFields(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const list = sanitizeCardPayments(entry.cardPayments);
  if (!list.length) return entry;
  return {
    ...entry,
    cardPayments: list,
    cardAmount: sumKind(list, 'card'),
    mealCardAmount: sumKind(list, 'meal_card'),
    paymentIntentId: entry.paymentIntentId || list[0].paymentIntentId,
  };
}

/** Tous les PaymentIntents d'un règlement, ancien ou nouveau format. */
const paymentIntentIdsOf = (entry) => [
  entry?.paymentIntentId,
  ...(Array.isArray(entry?.cardPayments) ? entry.cardPayments.map((c) => c?.paymentIntentId) : []),
].filter(Boolean);

const PASSAGE_LABELS = { card: 'Carte', meal_card: 'Titre-resto (carte)' };

/** Lignes de ticket des cartes passées au terminal (« Carte : 10,00 € », une par passage). */
const terminalLines = (entry, fmt) => terminalPassages(entry, entry?.cardAmount)
  .map((c) => `${PASSAGE_LABELS[c.kind]} : ${fmt(c.amount)}`);

module.exports = { sanitizeCardPayments, terminalPassages, sumKind, withTerminalFields, paymentIntentIdsOf, terminalLines };
