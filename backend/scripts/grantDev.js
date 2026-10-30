// backend/scripts/grantDev.js
// Bootstrap one-shot : pose le custom claim { role: 'dev' } sur un compte existant.
// Usage : node backend/scripts/grantDev.js <email>
const { admin } = require('../config/firebase');
const { users: usersCol } = require('../config/firestore');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage : node backend/scripts/grantDev.js <email>');
    process.exit(1);
  }

  let fbUser;
  try {
    fbUser = await admin.auth().getUserByEmail(email);
  } catch (err) {
    console.error(`❌ Utilisateur Firebase introuvable pour ${email} : ${err.message}`);
    process.exit(1);
  }

  await admin.auth().setCustomUserClaims(fbUser.uid, { role: 'dev' });
  console.log(`✅ Custom claim { role: 'dev' } posé sur ${email} (uid: ${fbUser.uid})`);

  // Synchroniser le doc Firestore
  let snap = await usersCol.where('firebaseUid', '==', fbUser.uid).limit(1).get();
  if (snap.empty) {
    snap = await usersCol.where('email', '==', email.toLowerCase().trim()).limit(1).get();
  }

  if (!snap.empty) {
    const doc = snap.docs[0];
    await usersCol.doc(doc.id).update({
      role: 'dev',
      isAdmin: true,
      firebaseUid: fbUser.uid,
      updatedAt: new Date(),
    });
    console.log(`✅ Doc Firestore mis à jour (id: ${doc.id})`);
  } else {
    const ref = await usersCol.add({
      name: fbUser.displayName || email,
      email: email.toLowerCase().trim(),
      phone: null,
      firebaseUid: fbUser.uid,
      role: 'dev',
      isAdmin: true,
      loyaltyPoints: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`✅ Doc Firestore créé (id: ${ref.id})`);
  }

  console.log('⚠️  L\'utilisateur doit SE RECONNECTER pour que le claim se propage à son token.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erreur :', err);
  process.exit(1);
});
