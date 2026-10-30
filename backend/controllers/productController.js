// backend/controllers/productController.js
const { productsCol, findAll, findById } = require('../models/Product.js');
const { sendSuccess } = require('../utils/responseFormatter');
const { ApiError } = require('../utils/errorHandler');

/**
 * @description Récupère tous les produits
 * @route   GET /api/products
 * @access  Public
 */
const getProducts = async (req, res, next) => {
  try {
    const products = await findAll();
    sendSuccess(res, products, 'Liste des produits récupérée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Récupère un produit par son ID
 * @route   GET /api/products/:id
 * @access  Public
 */
const getProductById = async (req, res, next) => {
  try {
    const product = await findById(req.params.id);
    if (!product) throw new ApiError('Produit non trouvé', 404);
    sendSuccess(res, product, 'Produit récupéré avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Crée un nouveau produit
 * @route   POST /api/products
 * @access  Private/Admin
 */
const createProduct = async (req, res, next) => {
  try {
    const { name, category, categoryId, image, price, menu_surcharge, nutritional_info, extras, taxRateDineIn, taxRateTakeaway } = req.body;

    if (!name || !category || price === undefined) {
      throw new ApiError('Veuillez fournir un nom, une catégorie et un prix.', 400);
    }

    // Override TVA produit par mode (réservé au gérant superadmin/dev) : null = suit la catégorie / le taux du mode.
    const canTax = req.user && (req.user.role === 'superadmin' || req.user.isDev);
    const normRate = (v) => (v === undefined || v === null || v === '') ? null : Number(v);

    const productData = {
      name,
      category,
      categoryId: categoryId ?? null,
      image: image || null,
      price,
      menu_surcharge: menu_surcharge || 0,
      taxRateDineIn:   canTax ? normRate(taxRateDineIn) : null,
      taxRateTakeaway: canTax ? normRate(taxRateTakeaway) : null,
      extras: Array.isArray(extras) ? extras : [],
      isAvailable: true,
      nutritional_info: nutritional_info || { calories: 0, proteins: 0, carbs: 0, fat: 0 },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await productsCol.add(productData);
    const createdProduct = { id: docRef.id, _id: docRef.id, ...productData };

    const io = req.app.get('socketio');
    if (io) io.emit('product_created', createdProduct);

    sendSuccess(res, createdProduct, 'Produit créé avec succès', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * @description Met à jour un produit existant
 * @route   PUT /api/products/:id
 * @access  Private/Admin
 */
const updateProduct = async (req, res, next) => {
  try {
    const updateFields = {};
    const allowedFields = ['name', 'category', 'categoryId', 'image', 'price', 'menu_surcharge', 'isAvailable', 'nutritional_info', 'extras'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) updateFields[field] = req.body[field];
    });
    // Override TVA produit : '' ou null = retour au taux par défaut du mode.
    // Réservé au gérant (superadmin/dev) ; un admin ne peut pas modifier la TVA via l'API.
    const canTax = req.user && (req.user.role === 'superadmin' || req.user.isDev);
    if (canTax) {
      for (const field of ['taxRateDineIn', 'taxRateTakeaway']) {
        if (req.body[field] === undefined) continue;
        const t = req.body[field];
        updateFields[field] = (t === null || t === '') ? null : Number(t);
      }
    }
    updateFields.updatedAt = new Date();

    const docRef = productsCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Produit non trouvé', 404);

    await docRef.update(updateFields);

    // Fusion locale pour éviter un second aller-retour Firestore
    const updatedProduct = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };

    const io = req.app.get('socketio');
    if (io) io.emit('product_updated', updatedProduct);

    sendSuccess(res, updatedProduct, 'Produit mis à jour avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Supprime un produit
 * @route   DELETE /api/products/:id
 * @access  Private/Admin
 */
const deleteProduct = async (req, res, next) => {
  try {
    const docRef = productsCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Produit non trouvé', 404);

    await docRef.delete();

    const io = req.app.get('socketio');
    if (io) io.emit('product_deleted', { id: req.params.id, _id: req.params.id });

    sendSuccess(res, { id: req.params.id, _id: req.params.id }, 'Produit supprimé avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Basculer la disponibilité d'un produit
 * @route   PATCH /api/products/:id/toggle-availability
 * @access  Private/Admin
 */
const toggleProductAvailability = async (req, res, next) => {
  try {
    const docRef = productsCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Produit non trouvé', 404);

    const newAvailability = !existing.data().isAvailable;
    await docRef.update({ isAvailable: newAvailability, updatedAt: new Date() });

    const updatedProduct = {
      id: docRef.id,
      _id: docRef.id,
      ...existing.data(),
      isAvailable: newAvailability,
      updatedAt: new Date()
    };

    const io = req.app.get('socketio');
    if (io) io.emit('product_availability_toggled', updatedProduct);

    sendSuccess(res, updatedProduct, `Produit ${newAvailability ? 'disponible' : 'indisponible'}`);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleProductAvailability
};
