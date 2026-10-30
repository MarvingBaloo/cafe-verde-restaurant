// backend/models/Product.js
// Couche d'accès Firestore pour la collection "products".
// La validation des champs reste dans validators/productValidator.js (inchangé).

const { products: productsCol } = require('../config/firestore');

/**
 * Convertit un DocumentSnapshot Firestore en objet plain.
 * Expose `id` ET `_id` avec la même valeur pour la rétrocompatibilité frontend.
 */
function formatProduct(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

/** Récupère tous les produits (disponibles ou non). */
async function findAll() {
  const snap = await productsCol.get();
  return snap.docs.map(formatProduct);
}

/** Récupère uniquement les produits disponibles. */
async function findAvailable() {
  const snap = await productsCol.where('isAvailable', '==', true).get();
  return snap.docs.map(formatProduct);
}

/** Récupère un produit par son ID Firestore. Retourne null si inexistant. */
async function findById(id) {
  const doc = await productsCol.doc(id).get();
  if (!doc.exists) return null;
  return formatProduct(doc);
}

module.exports = { productsCol, formatProduct, findAll, findAvailable, findById };
