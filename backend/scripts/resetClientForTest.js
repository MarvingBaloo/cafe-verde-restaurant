// backend/scripts/resetClientForTest.js
// Outil de TEST : remet à zéro un compte client (supprime ses commandes + loyaltyPoints = 0).
// Dry-run par défaut (n'écrit rien). Ajouter --apply pour exécuter réellement.
// Usage : node backend/scripts/resetClientForTest.js "<nom|email|phone>" [--apply]
const { users: usersCol, orders: ordersCol } = require('../config/firestore');

async function main() {
  const query = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!query) {
    console.error('Usage : node backend/scripts/resetClientForTest.js "<nom|email|phone>" [--apply]');
    process.exit(1);
  }

  const q = query.toLowerCase().trim();

  // Recherche en mémoire (volume faible) : match sur name / email / phone.
  const snap = await usersCol.get();
  const matches = snap.docs.filter((d) => {
    const u = d.data();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase() === q) ||
      (u.phone && u.phone.toLowerCase() === q)
    );
  });

  if (matches.length === 0) {
    console.error(`❌ Aucun client trouvé pour "${query}".`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`⚠️  ${matches.length} clients correspondent à "${query}" — affine la recherche :`);
    matches.forEach((d) => {
      const u = d.data();
      console.error(`   - ${u.name} | ${u.email || '—'} | ${u.phone || '—'} | id=${d.id}`);
    });
    process.exit(1);
  }

  const doc = matches[0];
  const u = doc.data();

  // Commandes liées à ce client (champ order.user == id du doc Firestore).
  const ordersSnap = await ordersCol.where('user', '==', doc.id).get();

  console.log('──────────────────────────────────────────────');
  console.log(`Client       : ${u.name}`);
  console.log(`Email        : ${u.email || '—'}`);
  console.log(`Téléphone    : ${u.phone || '—'}`);
  console.log(`id Firestore : ${doc.id}`);
  console.log(`firebaseUid  : ${u.firebaseUid || '—'}`);
  console.log(`loyaltyPoints: ${u.loyaltyPoints || 0}  →  0`);
  console.log(`Commandes    : ${ordersSnap.size} à supprimer`);
  console.log('──────────────────────────────────────────────');
  ordersSnap.docs.forEach((o) => {
    const d = o.data();
    console.log(`   • ${o.id} | ${d.totalPrice ?? '?'}€ | ${d.status} | paid=${d.paid} | source=${d.source} | pointsRedeemed=${d.pointsRedeemed ?? 0}`);
  });
  console.log('──────────────────────────────────────────────');

  if (!apply) {
    console.log('🔎 DRY-RUN : aucune modification effectuée. Relancer avec --apply pour exécuter.');
    process.exit(0);
  }

  // --- EXÉCUTION RÉELLE ---
  let deleted = 0;
  for (const o of ordersSnap.docs) {
    await ordersCol.doc(o.id).delete();
    deleted++;
  }
  await usersCol.doc(doc.id).update({ loyaltyPoints: 0, updatedAt: new Date() });

  console.log(`✅ ${deleted} commande(s) supprimée(s). loyaltyPoints remis à 0 pour ${u.name}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erreur :', err);
  process.exit(1);
});
