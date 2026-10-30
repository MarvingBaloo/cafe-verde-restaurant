// backend/models/Menu.js
// Couche d'accès Firestore pour la collection "menus".
// La validation des champs reste dans le controller (pas de middleware validator pour Menu).

const { menus: menusCol } = require('../config/firestore');

/**
 * Convertit un DocumentSnapshot Firestore en objet plain.
 * Expose `id` ET `_id` avec la même valeur pour la rétrocompatibilité frontend.
 */
function formatMenu(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

/** Récupère tous les menus (disponibles ou non). */
async function findAll() {
  const snap = await menusCol.get();
  return snap.docs.map(formatMenu);
}

/** Récupère uniquement les menus disponibles. */
async function findAvailable() {
  const snap = await menusCol.where('isAvailable', '==', true).get();
  return snap.docs.map(formatMenu);
}

/** Récupère un menu par son ID Firestore. Retourne null si inexistant. */
async function findById(id) {
  const doc = await menusCol.doc(id).get();
  if (!doc.exists) return null;
  return formatMenu(doc);
}

module.exports = { menusCol, formatMenu, findAll, findAvailable, findById };
