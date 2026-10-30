// backend/controllers/menuController.js
const { menusCol, findAll, findById } = require('../models/Menu.js');
const { sendSuccess } = require('../utils/responseFormatter');
const { ApiError } = require('../utils/errorHandler');

/**
 * @description Récupère la liste de tous les menus
 * @route   GET /api/menus
 * @access  Public
 */
const getMenus = async (req, res, next) => {
  try {
    const menus = await findAll();
    sendSuccess(res, menus, 'Liste des menus récupérée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Récupère un menu par son ID
 * @route   GET /api/menus/:id
 * @access  Public
 */
const getMenuById = async (req, res, next) => {
  try {
    const menu = await findById(req.params.id);
    if (!menu) throw new ApiError('Menu non trouvé', 404);
    sendSuccess(res, menu, 'Menu récupéré avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Crée un nouveau menu
 * @route   POST /api/menus
 * @access  Private/Admin
 */
const createMenu = async (req, res, next) => {
  try {
    const { name, price_addition, includes, allowedProductIds, selectionMode } = req.body;

    if (!name || price_addition === undefined) {
      throw new ApiError('Veuillez fournir un nom et un prix.', 400);
    }

    const menuData = {
      name,
      price_addition,
      isAvailable: true,
      includes: includes || { drink: false, dessert: false, side: false },
      allowedProductIds: Array.isArray(allowedProductIds) ? allowedProductIds : [],
      selectionMode: selectionMode === 'or' ? 'or' : 'and',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await menusCol.add(menuData);
    const createdMenu = { id: docRef.id, _id: docRef.id, ...menuData };

    const io = req.app.get('socketio');
    if (io) io.emit('menu_created', createdMenu);

    sendSuccess(res, createdMenu, 'Menu créé avec succès', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * @description Met à jour un menu existant
 * @route   PUT /api/menus/:id
 * @access  Private/Admin
 */
const updateMenu = async (req, res, next) => {
  try {
    const updateFields = {};
    const allowedFields = ['name', 'price_addition', 'isAvailable', 'includes', 'allowedProductIds', 'selectionMode'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) updateFields[field] = req.body[field];
    });
    updateFields.updatedAt = new Date();

    const docRef = menusCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Menu non trouvé', 404);

    await docRef.update(updateFields);

    // Fusion locale pour éviter un second aller-retour Firestore
    const updatedMenu = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };

    const io = req.app.get('socketio');
    if (io) io.emit('menu_updated', updatedMenu);

    sendSuccess(res, updatedMenu, 'Menu mis à jour avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Supprime un menu
 * @route   DELETE /api/menus/:id
 * @access  Private/Admin
 */
const deleteMenu = async (req, res, next) => {
  try {
    const docRef = menusCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Menu non trouvé', 404);

    await docRef.delete();

    const io = req.app.get('socketio');
    if (io) io.emit('menu_deleted', { id: req.params.id, _id: req.params.id });

    sendSuccess(res, { id: req.params.id, _id: req.params.id }, 'Menu supprimé avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Basculer la disponibilité d'un menu
 * @route   PATCH /api/menus/:id/toggle-availability
 * @access  Private/Admin
 */
const toggleMenuAvailability = async (req, res, next) => {
  try {
    const docRef = menusCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Menu non trouvé', 404);

    const newAvailability = !existing.data().isAvailable;
    await docRef.update({ isAvailable: newAvailability, updatedAt: new Date() });

    const updatedMenu = {
      id: docRef.id,
      _id: docRef.id,
      ...existing.data(),
      isAvailable: newAvailability,
      updatedAt: new Date()
    };

    const io = req.app.get('socketio');
    if (io) io.emit('menu_availability_toggled', updatedMenu);

    sendSuccess(res, updatedMenu, `Menu ${newAvailability ? 'disponible' : 'indisponible'}`);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMenus,
  getMenuById,
  createMenu,
  updateMenu,
  deleteMenu,
  toggleMenuAvailability
};
