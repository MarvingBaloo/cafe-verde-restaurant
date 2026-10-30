// backend/models/Ingredient.js
// Couche d'accès Firestore pour la collection "ingredients".
// La validation des champs reste dans validators/ingredientValidator.js (inchangé).

const { ingredients: ingredientsCol } = require('../config/firestore');

/**
 * Convertit un DocumentSnapshot Firestore en objet plain.
 * Expose `id` ET `_id` avec la même valeur pour la rétrocompatibilité frontend.
 */
function formatIngredient(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

/** Récupère tous les ingrédients (disponibles ou non). */
async function findAll() {
  const snap = await ingredientsCol.get();
  return snap.docs.map(formatIngredient);
}

/** Récupère uniquement les ingrédients disponibles. */
async function findAvailable() {
  const snap = await ingredientsCol.where('isAvailable', '==', true).get();
  return snap.docs.map(formatIngredient);
}

/** Récupère un ingrédient par son ID Firestore. Retourne null si inexistant. */
async function findById(id) {
  const doc = await ingredientsCol.doc(id).get();
  if (!doc.exists) return null;
  return formatIngredient(doc);
}

module.exports = { ingredientsCol, formatIngredient, findAll, findAvailable, findById };
