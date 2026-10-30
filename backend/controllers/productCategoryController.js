// backend/controllers/productCategoryController.js
// CRUD de l'arbre de catégories de produits (collection productCategories).
// Règles métier :
//  - un enfant (parentId non null) hérite du rootCategory de son parent (forcé ici).
//  - suppression refusée si la catégorie a des sous-catégories OU des produits.
// Émet des événements Socket.io pour le temps réel.

const {
  productCategoriesCol, findAll: findAllCategories, findById: findCategoryById,
} = require('../models/ProductCategory');
const { products: productsCol } = require('../config/firestore');

const emit = (req, event, payload) => {
  const io = req.app.get('socketio');
  if (io) io.emit(event, payload);
};

// GET /api/product-categories (public)
exports.getAllCategories = async (req, res) => {
  try {
    res.json(await findAllCategories());
  } catch (error) {
    console.error('getAllCategories error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// GET /api/product-categories/:id (public)
exports.getCategoryById = async (req, res) => {
  try {
    const cat = await findCategoryById(req.params.id);
    if (!cat) return res.status(404).json({ message: 'Catégorie introuvable' });
    res.json(cat);
  } catch (error) {
    console.error('getCategoryById error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// POST /api/product-categories (protect+admin)
exports.createCategory = async (req, res) => {
  try {
    const parentId = req.body.parentId || null;
    let rootCategory = req.body.rootCategory;

    // Un enfant hérite du rootCategory de son parent.
    if (parentId) {
      const parent = await findCategoryById(parentId);
      if (!parent) return res.status(400).json({ message: 'Catégorie parente introuvable' });
      rootCategory = parent.rootCategory;
    }

    // Taux de TVA de la catégorie (null = hérité du parent, sinon du taux par défaut du mode).
    // Seul le gérant (superadmin/dev) peut le définir ; un admin ne touche jamais à la TVA.
    const canTax = req.user && (req.user.role === 'superadmin' || req.user.isDev);
    const normRate = (v) => (v === undefined || v === null || v === '') ? null : Number(v);

    const data = {
      name:        req.body.name,
      parentId,
      rootCategory,
      order:       typeof req.body.order === 'number' ? req.body.order : 0,
      isAvailable: req.body.isAvailable !== false,
      taxRateDineIn:   canTax ? normRate(req.body.taxRateDineIn) : null,
      taxRateTakeaway: canTax ? normRate(req.body.taxRateTakeaway) : null,
      createdAt:   new Date(),
      updatedAt:   new Date(),
    };
    const docRef = await productCategoriesCol.add(data);
    const created = { id: docRef.id, _id: docRef.id, ...data };
    emit(req, 'product_category_created', created);
    res.status(201).json(created);
  } catch (error) {
    console.error('createCategory error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// PUT /api/product-categories/:id (protect+admin)
exports.updateCategory = async (req, res) => {
  try {
    const docRef = productCategoriesCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Catégorie introuvable' });

    const updateFields = {};
    ['name', 'order', 'isAvailable'].forEach(f => {
      if (req.body[f] !== undefined) updateFields[f] = req.body[f];
    });
    // Taux de TVA catégorie : '' ou null = retour à l'héritage/au taux par défaut.
    // Réservé au gérant (superadmin/dev) ; un admin ne peut pas modifier la TVA, même via l'API.
    const canTax = req.user && (req.user.role === 'superadmin' || req.user.isDev);
    if (canTax) {
      for (const field of ['taxRateDineIn', 'taxRateTakeaway']) {
        if (req.body[field] === undefined) continue;
        const t = req.body[field];
        updateFields[field] = (t === null || t === '') ? null : Number(t);
      }
    }
    updateFields.updatedAt = new Date();

    await docRef.update(updateFields);
    const updated = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };
    emit(req, 'product_category_updated', updated);
    res.json(updated);
  } catch (error) {
    console.error('updateCategory error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// DELETE /api/product-categories/:id (protect+admin)
exports.deleteCategory = async (req, res) => {
  try {
    const docRef = productCategoriesCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Catégorie introuvable' });

    // Refuser si sous-catégories existantes.
    const children = await productCategoriesCol.where('parentId', '==', req.params.id).limit(1).get();
    if (!children.empty) {
      return res.status(400).json({ message: 'Videz cette catégorie avant de la supprimer.' });
    }
    // Refuser si produits rattachés.
    const prods = await productsCol.where('categoryId', '==', req.params.id).limit(1).get();
    if (!prods.empty) {
      return res.status(400).json({ message: 'Videz cette catégorie avant de la supprimer.' });
    }

    await docRef.delete();
    emit(req, 'product_category_deleted', { id: req.params.id, _id: req.params.id });
    res.json({ success: true, message: 'Catégorie supprimée', id: req.params.id });
  } catch (error) {
    console.error('deleteCategory error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
