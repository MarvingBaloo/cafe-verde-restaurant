// backend/models/User.js
const { users: usersCol } = require('../config/firestore');

const VALID_ROLES = ['client', 'admin', 'superadmin', 'kitchen', 'dev'];

function formatUser(doc) {
  const { password, ...data } = doc.data();
  return { id: doc.id, _id: doc.id, ...data };
}

/** Tous les utilisateurs, sans password. */
async function findAll() {
  const snap = await usersCol.get();
  return snap.docs.map(formatUser);
}

/** Un utilisateur par ID, sans password. Retourne null si inexistant. */
async function findById(id) {
  const doc = await usersCol.doc(id).get();
  if (!doc.exists) return null;
  return formatUser(doc);
}

/** Recherche par email (insensible à la casse). */
async function findByEmail(email) {
  const snap = await usersCol
    .where('email', '==', email.toLowerCase().trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return formatUser(snap.docs[0]);
}

/** Recherche par numéro de téléphone. */
async function findByPhone(phone) {
  const snap = await usersCol
    .where('phone', '==', phone.trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return formatUser(snap.docs[0]);
}

/** Recherche par UID Firebase (pour l'authentification Firebase). */
async function findByFirebaseUid(uid) {
  const snap = await usersCol.where('firebaseUid', '==', uid).limit(1).get();
  if (snap.empty) return null;
  return formatUser(snap.docs[0]);
}

module.exports = {
  usersCol,
  VALID_ROLES,
  formatUser,
  findAll,
  findById,
  findByEmail,
  findByPhone,
  findByFirebaseUid,
};
