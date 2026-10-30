// backend/models/Dish.js
// Couche d'accès Firestore pour la collection "dishes".
// Validation complète assurée par validators/dishValidator.js (VALID_CATEGORIES inclus).

const { dishes: dishesCol } = require('../config/firestore');

/**
 * Convertit un DocumentSnapshot Firestore en objet plain.
 * Expose `id` ET `_id` avec la même valeur pour la rétrocompatibilité frontend.
 */
function formatDish(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

/**
 * Convertit une valeur de date (Date JS ou Firestore Timestamp) en millisecondes.
 * Utilisé pour le tri en mémoire sur createdAt.
 */
function toMs(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (val instanceof Date) return val.getTime();
  return 0;
}

/**
 * Récupère tous les plats, triés par date de création décroissante.
 * Tri en mémoire pour éviter tout index composite Firestore.
 */
async function findAll() {
  const snap = await dishesCol.get();
  return snap.docs
    .map(formatDish)
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

/** Récupère un plat par son ID Firestore. Retourne null si inexistant. */
async function findById(id) {
  const doc = await dishesCol.doc(id).get();
  if (!doc.exists) return null;
  return formatDish(doc);
}

module.exports = { dishesCol, formatDish, findAll, findById };
