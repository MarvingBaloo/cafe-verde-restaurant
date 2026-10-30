// backend/controllers/formulaController.js
const { formulasCol, findAll, findById, VALID_TYPES } = require('../models/Formula');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendSuccess } = require('../utils/responseFormatter');
const { ApiError } = require('../utils/errorHandler');

/**
 * @description Récupère toutes les formules, triées par type puis prix croissant
 * @route   GET /api/formulas
 * @access  Public
 */
const getFormulas = async (req, res, next) => {
  try {
    const formulas = await findAll(); // tri type + base_price déjà appliqué dans le modèle
    sendSuccess(res, formulas, 'Liste des formules récupérée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Récupère une formule par ID
 * @route   GET /api/formulas/:id
 * @access  Public
 */
const getFormulaById = async (req, res, next) => {
  try {
    const formula = await findById(req.params.id);
    if (!formula) throw new ApiError('Formule non trouvée', 404);
    sendSuccess(res, formula, 'Formule récupérée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Crée une nouvelle formule
 * @route   POST /api/formulas
 * @access  Private/Admin
 */
const createFormula = async (req, res, next) => {
  try {
    const { name, type, base_price, image, limits, extra_cost_per_component } = req.body;

    // Validation du type (aucun middleware validator pour Formula, on valide ici)
    const resolvedType = type || 'salad';
    if (!VALID_TYPES.includes(resolvedType)) {
      throw new ApiError(`Type invalide. Valeurs acceptées : ${VALID_TYPES.join(', ')}`, 400);
    }

    const formulaData = {
      name,
      type: resolvedType,
      base_price,
      image: image || '',
      limits: limits || { base: 0, protein: 0, topping: 0, sauce: 0 },
      extra_cost_per_component: extra_cost_per_component || 0,
      isAvailable: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await formulasCol.add(formulaData);
    const createdFormula = { id: docRef.id, _id: docRef.id, ...formulaData };

    const io = req.app.get('socketio');
    if (io) io.emit('formula_created', createdFormula);

    sendSuccess(res, createdFormula, 'Formule créée avec succès', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * @description Met à jour une formule
 * @route   PUT /api/formulas/:id
 * @access  Private/Admin
 */
const updateFormula = async (req, res, next) => {
  try {
    const docRef = formulasCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Formule non trouvée', 404);

    const updateFields = {};
    if (req.body.name !== undefined)        updateFields.name = req.body.name;
    if (req.body.type !== undefined) {
      if (!VALID_TYPES.includes(req.body.type)) {
        throw new ApiError(`Type invalide. Valeurs acceptées : ${VALID_TYPES.join(', ')}`, 400);
      }
      updateFields.type = req.body.type;
    }
    if (req.body.base_price !== undefined)               updateFields.base_price = req.body.base_price;
    if (req.body.image !== undefined)                    updateFields.image = req.body.image;
    if (req.body.isAvailable !== undefined)              updateFields.isAvailable = req.body.isAvailable;
    if (req.body.limits !== undefined)                   updateFields.limits = req.body.limits;
    if (req.body.extra_cost_per_component !== undefined) updateFields.extra_cost_per_component = req.body.extra_cost_per_component;
    updateFields.updatedAt = new Date();

    await docRef.update(updateFields);

    // Fusion locale pour éviter un second aller-retour Firestore
    const updatedFormula = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };

    const io = req.app.get('socketio');
    if (io) io.emit('formula_updated', updatedFormula);

    sendSuccess(res, updatedFormula, 'Formule mise à jour avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Supprime une formule
 * @route   DELETE /api/formulas/:id
 * @access  Private/Admin
 */
const deleteFormula = async (req, res, next) => {
  try {
    const docRef = formulasCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Formule non trouvée', 404);

    // Supprimer l'image locale si elle pointe vers /uploads/ (legacy)
    const formulaData = existing.data();
    if (formulaData.image && formulaData.image.startsWith('/uploads/')) {
      const imagePath = path.join(__dirname, '..', formulaData.image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    await docRef.delete();

    const io = req.app.get('socketio');
    if (io) io.emit('formula_deleted', { id: req.params.id, _id: req.params.id });

    sendSuccess(res, { id: req.params.id, _id: req.params.id }, 'Formule supprimée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * Configuration Multer pour l'upload d'images (disque local — legacy F1 non migré)
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'formulas');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'formula-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Seules les images sont autorisées (jpeg, jpg, png, gif, webp)'));
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

/**
 * @description Upload une image pour une formule (disque local — legacy F1 non migré)
 * @route   POST /api/formulas/:id/image
 * @access  Private/Admin
 */
const uploadFormulaImage = async (req, res, next) => {
  try {
    const docRef = formulasCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Formule non trouvée', 404);
    if (!req.file) throw new ApiError('Aucune image fournie', 400);

    // Supprimer l'ancienne image locale si elle existe
    const formulaData = existing.data();
    if (formulaData.image && formulaData.image.startsWith('/uploads/')) {
      const oldImagePath = path.join(__dirname, '..', formulaData.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    const imagePath = `/uploads/formulas/${req.file.filename}`;
    await docRef.update({ image: imagePath, updatedAt: new Date() });

    sendSuccess(res, { image: imagePath }, 'Image uploadée avec succès');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFormulas,
  getFormulaById,
  createFormula,
  updateFormula,
  deleteFormula,
  uploadFormulaImage,
  upload
};
