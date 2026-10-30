/**
 * Purge les événements `scroll_depth` de la collection activityLogs.
 *
 * Pourquoi : 95 604 documents (46,8 % de la collection au 2026-09-17) qu'aucun écran
 * ni aucun calcul ne lisait — vérifié par recherche dans tout le dépôt, la seule
 * occurrence hors du code qui les écrivait était leur déclaration dans le modèle.
 * L'émission a été coupée dans useActivityTracker le même jour.
 *
 * Sécurités : chaque document est réécrit dans backups/ AVANT suppression, et son
 * eventType est revérifié document par document juste avant d'entrer dans le lot —
 * une erreur de requête ne peut pas emporter autre chose que du scroll_depth.
 *
 * Usage : node backend/scripts/purgeScrollDepth.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const sa = require('../firebase-service-account.json');

const DRY = process.argv.includes('--dry-run');
const TYPE = 'scroll_depth';

admin.initializeApp({ credential: admin.credential.cert(sa) });
const col = admin.firestore().collection('activityLogs');

(async () => {
  const before = (await col.count().get()).data().count;
  const target = (await col.where('eventType', '==', TYPE).count().get()).data().count;
  console.log(`projet          : ${sa.project_id}`);
  console.log(`collection      : ${before.toLocaleString('fr-FR')} documents`);
  console.log(`dont ${TYPE} : ${target.toLocaleString('fr-FR')} (${(target * 100 / before).toFixed(1)} %)`);
  if (DRY) { console.log('\n--dry-run : rien ne sera supprimé.'); process.exit(0); }

  const dir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `activityLogs-${TYPE}-${new Date().toISOString().slice(0, 10)}.jsonl`);
  /* 'a' et non 'w' : sur 95 000 documents, le client Firestore finit par rendre un
     DEADLINE_EXCEEDED (constaté après ~60 000). Le script est fait pour être relancé
     — il redemande simplement les 500 suivants — mais en mode écrasement la reprise
     détruisait la sauvegarde des documents déjà supprimés, donc le seul moyen de les
     retrouver. Relancer jusqu'à « 0 restant ». */
  const out = fs.createWriteStream(file, { flags: 'a' });

  let saved = 0, removed = 0, refused = 0;
  for (;;) {
    const snap = await col.where('eventType', '==', TYPE).limit(500).get();
    if (snap.empty) break;

    const batch = admin.firestore().batch();
    let inBatch = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.eventType !== TYPE) { refused++; continue; }   // garde-fou
      out.write(JSON.stringify({ id: doc.id, ...data }) + '\n');
      saved++;
      batch.delete(doc.ref);
      inBatch++;
    }
    if (inBatch === 0) break;
    await batch.commit();
    removed += inBatch;
    if (removed % 5000 < 500) console.log(`  ${removed.toLocaleString('fr-FR')} supprimés…`);
  }
  await new Promise(r => out.end(r));

  const after = (await col.count().get()).data().count;
  console.log(`\nsauvegardés : ${saved.toLocaleString('fr-FR')} → ${path.relative(process.cwd(), file)}`);
  console.log(`supprimés   : ${removed.toLocaleString('fr-FR')}`);
  if (refused) console.log(`écartés par le garde-fou : ${refused}`);
  console.log(`collection  : ${before.toLocaleString('fr-FR')} → ${after.toLocaleString('fr-FR')} documents`);
  process.exit(0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
