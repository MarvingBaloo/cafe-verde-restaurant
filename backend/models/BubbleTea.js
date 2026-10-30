// backend/models/BubbleTea.js
// Couche d'accès Firestore pour la collection "bubbleTeas".
// Un bubble tea = produit configurable à prix de base. Il active des catégories et des
// ingrédients parmi le catalogue commun (bubbleTeaCategories / bubbleTeaIngredients).
// La validation des champs reste dans validators/bubbleTeaValidator.js.

const { bubbleTeas: bubbleTeasCol } = require('../config/firestore');

/**
 * Convertit un DocumentSnapshot Firestore en objet plain.
 * Expose `id` ET `_id` avec la même valeur pour la rétrocompatibilité frontend.
 */
function formatBubbleTea(doc) {
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

/** Récupère tous les bubble teas, triés par date de création décroissante. */
async function findAll() {
  const snap = await bubbleTeasCol.get();
  return snap.docs
    .map(formatBubbleTea)
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

/** Récupère uniquement les bubble teas disponibles. */
async function findAvailable() {
  const snap = await bubbleTeasCol.where('isAvailable', '==', true).get();
  return snap.docs.map(formatBubbleTea);
}

/** Récupère un bubble tea par son ID Firestore. Retourne null si inexistant. */
async function findById(id) {
  const doc = await bubbleTeasCol.doc(id).get();
  if (!doc.exists) return null;
  return formatBubbleTea(doc);
}

module.exports = { bubbleTeasCol, formatBubbleTea, findAll, findAvailable, findById };
