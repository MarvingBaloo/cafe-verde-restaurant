// backend/models/Formula.js
// Couche d'accès Firestore pour la collection "formulas".
// Pas de middleware validator pour Formula — la vérification du type est faite ici.

const { formulas: formulasCol } = require('../config/firestore');

/** Types de formule valides (enum Mongoose remplacé par cette constante). */
const VALID_TYPES = ['salad'];

/**
 * Convertit un DocumentSnapshot Firestore en objet plain.
 * Expose `id` ET `_id` avec la même valeur pour la rétrocompatibilité frontend.
 */
function formatFormula(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

/**
 * Récupère toutes les formules, triées par type puis base_price croissant.
 * Tri en mémoire pour éviter un index composite Firestore.
 */
async function findAll() {
  const snap = await formulasCol.get();
  return snap.docs
    .map(formatFormula)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return (a.base_price || 0) - (b.base_price || 0);
    });
}

/** Récupère uniquement les formules disponibles. */
async function findAvailable() {
  const snap = await formulasCol.where('isAvailable', '==', true).get();
  return snap.docs.map(formatFormula);
}

/** Récupère une formule par son ID Firestore. Retourne null si inexistante. */
async function findById(id) {
  const doc = await formulasCol.doc(id).get();
  if (!doc.exists) return null;
  return formatFormula(doc);
}

/**
 * Cherche la formule disponible la moins chère d'un type donné.
 * Équivalent de Formula.findOne({ type, isAvailable: true }).sort({ base_price: 1 }).
 */
async function findFirstAvailableByType(type) {
  const snap = await formulasCol
    .where('type', '==', type)
    .where('isAvailable', '==', true)
    .get();
  if (snap.empty) return null;
  return snap.docs
    .map(formatFormula)
    .sort((a, b) => (a.base_price || 0) - (b.base_price || 0))[0];
}

module.exports = {
  formulasCol,
  formatFormula,
  findAll,
  findAvailable,
  findById,
  findFirstAvailableByType,
  VALID_TYPES
};
