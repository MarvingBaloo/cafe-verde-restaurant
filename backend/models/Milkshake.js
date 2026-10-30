// backend/models/Milkshake.js
// Couche d'accès Firestore pour la collection "milkshakes".
// Un milkshake = produit configurable à prix de base. Il active des catégories et des
// ingrédients imbriqués (modèle "plat chaud").
// La validation des champs reste dans validators/milkshakeValidator.js.

const { milkshakes: milkshakesCol } = require('../config/firestore');

/**
 * Convertit un DocumentSnapshot Firestore en objet plain.
 * Expose `id` ET `_id` avec la même valeur pour la rétrocompatibilité frontend.
 */
function formatMilkshake(doc) {
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

/** Récupère tous les milkshakes, triés par date de création décroissante. */
async function findAll() {
  const snap = await milkshakesCol.get();
  return snap.docs
    .map(formatMilkshake)
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

/** Récupère uniquement les milkshakes disponibles. */
async function findAvailable() {
  const snap = await milkshakesCol.where('isAvailable', '==', true).get();
  return snap.docs.map(formatMilkshake);
}

/** Récupère un milkshake par son ID Firestore. Retourne null si inexistant. */
async function findById(id) {
  const doc = await milkshakesCol.doc(id).get();
  if (!doc.exists) return null;
  return formatMilkshake(doc);
}

module.exports = { milkshakesCol, formatMilkshake, findAll, findAvailable, findById };
