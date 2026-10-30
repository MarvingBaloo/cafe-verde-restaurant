// backend/scripts/purgeDevActivity.js
// Supprime de la collection activityLogs toutes les activités des comptes role:'dev'.
// (Le filtre live empêche les futurs events ; ce script nettoie l'historique.)
// Usage : node backend/scripts/purgeDevActivity.js
const { users: usersCol, activityLogs: activityLogsCol } = require('../config/firestore');

async function main() {
  const devSnap = await usersCol.where('role', '==', 'dev').get();
  if (devSnap.empty) {
    console.log('Aucun compte dev. Rien à purger.');
    process.exit(0);
  }

  const devIds = devSnap.docs.map((d) => d.id);
  console.log(`Comptes dev : ${devIds.length} (${devIds.join(', ')})`);

  let total = 0;
  for (const devId of devIds) {
    const snap = await activityLogsCol.where('user', '==', devId).get();
    if (snap.empty) continue;

    let batch = activityLogsCol.firestore.batch();
    let n = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      n++;
      if (n % 400 === 0) {
        await batch.commit();
        batch = activityLogsCol.firestore.batch();
      }
    }
    await batch.commit();
    total += snap.size;
    console.log(`  - ${devId} : ${snap.size} activités supprimées`);
  }

  console.log(`✅ Total supprimé : ${total}`);
  process.exit(0);
}

main().catch((e) => { console.error('❌ Erreur :', e); process.exit(1); });
