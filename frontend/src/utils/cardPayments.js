// Lignes d'un paiement mixte, réglées l'une après l'autre : carte bancaire et carte
// titre-restaurant (Swile, Edenred…) passent au terminal, chacune en transaction Stripe
// distincte ; tickets papier et espèces sont simplement enregistrés par la caisse.
//
//   persisté : cardPayments: [{ amount, kind: 'card' | 'meal_card', paymentIntentId }]
//              (tickets papier et espèces : totaux ticketAmount / cashAmount du règlement)
//   en saisie : [{ id, amount (texte du champ), kind, paymentIntentId (null tant que non passé),
//                  recorded, applied, extra }] — `applied` = part imputée sur l'addition,
//                  `extra` = rendu (espèces) ou excédent non rendu (tickets papier)
//
// ⚠️ Miroir : backend/utils/cardPayments.js (lecture des règlements persistés).

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const PASSAGE_LABELS = { card: 'Carte', meal_card: 'Titre-resto (carte)', paper: 'Tickets papier', cash: 'Espèces' };

export const isTerminalKind = (kind) => kind === 'card' || kind === 'meal_card';

let seq = 0;
export const newPassage = (kind = 'card', amount = '') => ({ id: `cp${++seq}`, kind, amount, paymentIntentId: null });

export const passageAmount = (p) => Math.max(0, round2(parseFloat(p?.amount) || 0));

/** Total des passages saisis, tous ou d'un seul type. */
export const passagesTotal = (list, kind) =>
  round2((list || []).filter((p) => !kind || p.kind === kind).reduce((s, p) => s + passageAmount(p), 0));

/** Ligne réglée : carte passée au terminal, ou tickets / espèces enregistrés. */
export const passageDone = (p) => !!(p?.paymentIntentId || p?.recorded);

/** Au moins une ligne a été réglée : la saisie ne peut plus être abandonnée sans trace. */
export const passagesStarted = (list) => (list || []).some(passageDone);

/** Un montant est saisi sur une ligne pas encore réglée. */
export const passagesPending = (list) => (list || []).some((p) => passageAmount(p) > 0 && !passageDone(p));

/** Enregistre une ligne tickets papier / espèces : imputée jusqu'au reste dû, le surplus à part. */
export const recordPassage = (p, rest) => {
  const amount = passageAmount(p);
  const applied = round2(Math.min(amount, Math.max(0, rest)));
  return { ...p, recorded: true, applied, extra: round2(amount - applied) };
};

/** Ce que les lignes réglées couvrent de `due`, et les totaux du règlement mixte. */
export const mixedSummary = (list, due) => {
  const done = (list || []).filter(passageDone);
  const sum = (kind, field) => round2(done.filter((p) => p.kind === kind)
    .reduce((s, p) => s + (field === 'amount' ? passageAmount(p) : Number(p[field]) || 0), 0));
  const cards = round2(done.filter((p) => isTerminalKind(p.kind)).reduce((s, p) => s + passageAmount(p), 0));
  const ticketAmount = sum('paper', 'applied');
  const cashAmount = sum('cash', 'applied');
  const paid = round2(cards + ticketAmount + cashAmount);
  return {
    paid,
    rest: round2(Math.max(0, due - paid)),
    ticketAmount, ticketGiven: sum('paper', 'amount'),
    cashAmount, cashGiven: sum('cash', 'amount'), change: sum('cash', 'extra'),
    pending: passagesPending(list),
  };
};

/** Passages débités, au format persisté. */
export const toCardPayments = (list) => (list || [])
  .filter((p) => p.paymentIntentId && passageAmount(p) > 0)
  .map((p) => ({ amount: passageAmount(p), kind: p.kind, paymentIntentId: p.paymentIntentId }));

/** Champs d'un règlement mixte issus de ses passages (cf. withTerminalFields côté serveur). */
export const terminalFields = (list) => {
  const cardPayments = toCardPayments(list);
  return {
    cardPayments,
    cardAmount: passagesTotal(cardPayments, 'card'),
    mealCardAmount: passagesTotal(cardPayments, 'meal_card'),
    paymentIntentId: cardPayments[0]?.paymentIntentId || null,
  };
};

/** Lignes de ticket des cartes passées, d'un règlement persisté ancien ou nouveau format. */
export const terminalLines = (entry, fmt) => {
  const list = (entry?.cardPayments || []).filter((c) => Number(c.amount) > 0);
  if (list.length) return list.map((c) => `${PASSAGE_LABELS[c.kind] || PASSAGE_LABELS.card} : ${fmt(round2(c.amount))}`);
  return (entry?.cardAmount || 0) > 0 ? [`${PASSAGE_LABELS.card} : ${fmt(entry.cardAmount)}`] : [];
};
