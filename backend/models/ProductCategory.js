// backend/models/ProductCategory.js
// Couche d'accès Firestore pour la collection "productCategories".
// Un document = un nœud d'arbre de catégories de produits (profondeur illimitée).
// La validation des champs reste dans validators/productCategoryValidator.js.

const { productCategories: productCategoriesCol } = require('../config/firestore');

function formatProductCategory(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

function toMs(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (val instanceof Date) return val.getTime();
  return 0;
}

/** Récupère toutes les catégories, triées par order croissant puis name. */
async function findAll() {
  const snap = await productCategoriesCol.get();
  return snap.docs
    .map(formatProductCategory)
    .sort((a, b) => {
      const oa = typeof a.order === 'number' ? a.order : 0;
      const ob = typeof b.order === 'number' ? b.order : 0;
      if (oa !== ob) return oa - ob;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

/** Récupère une catégorie par son ID Firestore. Retourne null si inexistante. */
async function findById(id) {
  const doc = await productCategoriesCol.doc(id).get();
  if (!doc.exists) return null;
  return formatProductCategory(doc);
}

module.exports = { productCategoriesCol, formatProductCategory, findAll, findById };
