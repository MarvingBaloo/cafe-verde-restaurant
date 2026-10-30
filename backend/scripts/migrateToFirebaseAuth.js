// backend/scripts/migrateToFirebaseAuth.js
require('dotenv').config({ path: '../.env' });
const { admin } = require('../config/firebase');
const { users: usersCol } = require('../config/firestore');

async function migrate() {
  const snap = await usersCol.get();
  let ok = 0, skip = 0, err = 0;
  for (const doc of snap.docs) {
    const u = doc.data();
    if (u.firebaseUid) { skip++; continue; }
    try {
      const params = u.phone
        ? { phoneNumber: u.phone, displayName: u.name }
        : { email: u.email, displayName: u.name };
      const fbUser = await admin.auth().createUser(params);
      await usersCol.doc(doc.id).update({ firebaseUid: fbUser.uid });
      console.log(`✅ ${u.name} (${u.phone || u.email}) → ${fbUser.uid}`);
      ok++;
    } catch (e) {
      console.error(`❌ ${u.name}: ${e.message}`);
      err++;
    }
  }
  console.log(`\nRésultat: ${ok} migrés, ${skip} déjà migrés, ${err} erreurs`);
}

migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
