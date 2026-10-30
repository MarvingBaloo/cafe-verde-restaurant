// Vérifie la fusion des règlements d'une addition encaissée en plusieurs fois.
// Fonction pure, aucune base : `node backend/scripts/checkSplitMerge.js`.
const assert = require('assert');
const { mergeSplitPayments, prepaidTotal } = require('../utils/splitPayments');

let ok = 0;
const t = (name, fn) => { fn(); console.log(`  ✓ ${name}`); ok++; };

console.log('\nNON-RÉGRESSION — un encaissement ordinaire ne doit rien voir changer');

t('aucune part persistée → le tableau reçu est renvoyé tel quel (même référence)', () => {
  const incoming = [{ index: 1, amount: 20, method: 'card' }, { index: 2, amount: 30, method: 'cash' }];
  const r = mergeSplitPayments(undefined, incoming);
  assert.strictEqual(r.splitPayments, incoming, 'le tableau doit être renvoyé à l\'identique');
  assert.strictEqual(r.merged, false);
  assert.strictEqual(r.splitCount, 2);
});

t('champ absent ou null → identique', () => {
  const incoming = [{ index: 1, amount: 10, method: 'cash' }];
  assert.strictEqual(mergeSplitPayments(null, incoming).splitPayments, incoming);
  assert.strictEqual(mergeSplitPayments([], incoming).splitPayments, incoming);
});

t('split vide → sortie vide, pas de fusion', () => {
  const r = mergeSplitPayments([], []);
  assert.deepStrictEqual(r.splitPayments, []);
  assert.strictEqual(r.merged, false);
});

t('TOUTE LA TABLE PAIE À LA FIN, addition séparée en 3 → aucun changement', () => {
  const incoming = [
    { index: 1, amount: 40, method: 'card' },
    { index: 2, amount: 35, method: 'cash' },
    { index: 3, amount: 25, method: 'ticket' },
  ];
  const r = mergeSplitPayments(undefined, incoming);
  assert.strictEqual(r.splitPayments, incoming, 'le split classique doit ressortir intact');
  assert.strictEqual(r.merged, false, 'aucune fusion ne doit avoir lieu');
  assert.deepStrictEqual(r.splitPayments.map(p => p.index), [1, 2, 3], 'numéros de part inchangés');
});

t('TOUTE LA TABLE PAIE À LA FIN, paiement simple → aucune part inventée', () => {
  const r = mergeSplitPayments(undefined, null);
  assert.strictEqual(r.merged, false);
  assert.deepStrictEqual(r.splitPayments, [], 'le controleur ecrira null, comme avant');
});

t('ticket ouvert repris et encaissé normalement → aucun changement', () => {
  const incoming = [{ index: 1, amount: 62.5, method: 'mixed', cardAmount: 50, cashAmount: 12.5 }];
  const r = mergeSplitPayments([], incoming);
  assert.strictEqual(r.splitPayments, incoming);
  assert.strictEqual(r.merged, false);
});

console.log('\nFUSION — un convive a réglé sa part avant la clôture');

t('les parts déjà encaissées sont conservées, les nouvelles décalées derrière', () => {
  const prior = [{ index: 1, amount: 20, method: 'card', partId: 'a1', loyaltyApplied: true }];
  const incoming = [{ index: 1, amount: 50, method: 'cash' }, { index: 2, amount: 80, method: 'card' }];
  const r = mergeSplitPayments(prior, incoming);
  assert.strictEqual(r.merged, true);
  assert.strictEqual(r.splitPayments.length, 3);
  assert.deepStrictEqual(r.splitPayments.map(p => p.index), [1, 2, 3]);
  assert.deepStrictEqual(r.splitPayments.map(p => p.amount), [20, 50, 80]);
  assert.strictEqual(r.splitPayments[0].loyaltyApplied, true, 'la part déjà créditée garde sa marque');
  assert.strictEqual(r.splitCount, 3);
});

t('une part réglée en plusieurs fois garde son regroupement', () => {
  const prior = [{ index: 1, amount: 20, method: 'card', partId: 'a1' }];
  // Part 2 de la caisse réglée en deux temps → même index, doit le rester après décalage.
  const incoming = [
    { index: 1, amount: 10, method: 'cash' },
    { index: 1, amount: 5, method: 'card' },
    { index: 2, amount: 40, method: 'card' },
  ];
  const r = mergeSplitPayments(prior, incoming);
  assert.deepStrictEqual(r.splitPayments.map(p => p.index), [1, 2, 2, 3]);
  assert.strictEqual(r.splitCount, 3, 'trois parts distinctes, quatre règlements');
});

t('deux parts déjà encaissées → décalage de 2', () => {
  const prior = [
    { index: 1, amount: 20, method: 'card', partId: 'a1' },
    { index: 2, amount: 15, method: 'cash', partId: 'a2' },
  ];
  const r = mergeSplitPayments(prior, [{ index: 1, amount: 60, method: 'card' }]);
  assert.deepStrictEqual(r.splitPayments.map(p => p.index), [1, 2, 3]);
});

console.log('\nDOUBLE COMPTAGE — le risque d\'argent');

t('une part renvoyée par erreur par la caisse est ignorée', () => {
  const prior = [{ index: 1, amount: 20, method: 'card', partId: 'a1' }];
  const incoming = [
    { index: 1, amount: 20, method: 'card', partId: 'a1' }, // déjà encaissée
    { index: 2, amount: 80, method: 'cash' },
  ];
  const r = mergeSplitPayments(prior, incoming);
  assert.strictEqual(r.splitPayments.length, 2, 'la part déjà persistée ne doit pas être dupliquée');
  assert.strictEqual(prepaidTotal(r.splitPayments), 100);
});

t('somme des parts = argent réellement encaissé', () => {
  const prior = [{ index: 1, amount: 20, method: 'card', partId: 'a1' }];
  const r = mergeSplitPayments(prior, [{ index: 1, amount: 50 }, { index: 2, amount: 80 }]);
  assert.strictEqual(prepaidTotal(r.splitPayments), 150);
});

t('les parts persistées à 0 € sont écartées (part ouverte jamais réglée)', () => {
  const prior = [{ index: 1, amount: 0, method: null }];
  const incoming = [{ index: 1, amount: 40, method: 'cash' }];
  const r = mergeSplitPayments(prior, incoming);
  assert.strictEqual(r.merged, false, 'aucun encaissement réel → comportement d\'origine');
  assert.strictEqual(r.splitPayments, incoming);
});

console.log(`\n✅ ${ok}/${ok} vérifications passées\n`);
