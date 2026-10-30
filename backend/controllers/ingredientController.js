// backend/controllers/ingredientController.js
const asyncHandler = require('express-async-handler');
const { ingredientsCol, formatIngredient, findAll } = require('../models/Ingredient.js');
const { getNutritionInfo } = require('../services/nutritionService.js');

/**
 * @description Récupère tous les ingrédients.
 * @route   GET /api/ingredients
 * @access  Public
 */
const getIngredients = asyncHandler(async (req, res) => {
  const ingredients = await findAll();
  res.json(ingredients);
});

/**
 * @description Crée un nouvel ingrédient.
 * @route   POST /api/ingredients
 * @access  Public (devrait être protégé Admin)
 */
const addIngredient = asyncHandler(async (req, res) => {
  const { name, category, image, is_premium, extra_price, nutritional_info, tags } = req.body;

  if (!name || !category) {
    res.status(400);
    throw new Error('Veuillez fournir un nom et une catégorie.');
  }

  // Auto-complétion nutritionnelle si les valeurs sont absentes ou toutes à zéro
  const hasNutritionalInfo = nutritional_info && (
    nutritional_info.calories > 0 ||
    nutritional_info.proteins > 0 ||
    nutritional_info.carbs > 0 ||
    nutritional_info.fat > 0
  );

  let finalNutritionalInfo = nutritional_info || { calories: 0, proteins: 0, carbs: 0, fat: 0 };
  let autoFilled = false;
  let nutritionSource = null;

  if (!hasNutritionalInfo) {
    try {
      console.log(`🤖 Auto-complétion des infos nutritionnelles pour: "${name}"`);
      const nutritionData = await getNutritionInfo(name);
      if (nutritionData && nutritionData.source !== 'default') {
        finalNutritionalInfo = {
          calories: nutritionData.calories,
          proteins: nutritionData.proteins,
          carbs: nutritionData.carbs,
          fat: nutritionData.fat
        };
        autoFilled = true;
        nutritionSource = nutritionData.source;
        console.log(`✅ Infos nutritionnelles auto-complétées via ${nutritionSource}`);
      }
    } catch (error) {
      console.error('❌ Erreur auto-complétion nutritionnelle:', error);
    }
  }

  const ingredientData = {
    name,
    category,
    image: image || '',
    is_premium: is_premium || false,
    extra_price: extra_price || 0,
    isAvailable: true,
    nutritional_info: finalNutritionalInfo,
    tags: tags || [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const docRef = await ingredientsCol.add(ingredientData);
  const createdIngredient = { id: docRef.id, _id: docRef.id, ...ingredientData };

  res.status(201).json({
    ...createdIngredient,
    _nutritionAutoFilled: autoFilled,
    _nutritionSource: nutritionSource
  });
});

/**
 * @description Met à jour un ingrédient existant.
 * @route   PUT /api/ingredients/:id
 * @access  Public (Admin)
 */
const updateIngredient = asyncHandler(async (req, res) => {
  const updateFields = {};

  if (req.body.name !== undefined)             updateFields.name = req.body.name;
  if (req.body.category !== undefined)         updateFields.category = req.body.category;
  if (req.body.image !== undefined)            updateFields.image = req.body.image;
  if (req.body.is_premium !== undefined)       updateFields.is_premium = req.body.is_premium;
  if (req.body.extra_price !== undefined)      updateFields.extra_price = req.body.extra_price;
  if (req.body.isAvailable !== undefined)      updateFields.isAvailable = req.body.isAvailable;
  if (req.body.nutritional_info !== undefined) updateFields.nutritional_info = req.body.nutritional_info;
  if (req.body.tags !== undefined)             updateFields.tags = req.body.tags;

  updateFields.updatedAt = new Date();

  const docRef = ingredientsCol.doc(req.params.id);
  const existing = await docRef.get();

  if (!existing.exists) {
    res.status(404);
    throw new Error('Ingrédient non trouvé');
  }

  await docRef.update(updateFields);

  // Fusion locale pour éviter un second aller-retour Firestore
  const updatedIngredient = {
    id: docRef.id,
    _id: docRef.id,
    ...existing.data(),
    ...updateFields
  };

  // Notification temps réel à tous les clients connectés
  const io = req.app.get('socketio');
  io.emit('ingredient_updated', updatedIngredient);

  res.json(updatedIngredient);
});

const deleteIngredient = asyncHandler(async (req, res) => {
  const docRef = ingredientsCol.doc(req.params.id);
  const existing = await docRef.get();
  if (!existing.exists) {
    res.status(404);
    throw new Error('Ingrédient non trouvé');
  }

  await docRef.delete();

  const io = req.app.get('socketio');
  if (io) io.emit('ingredient_deleted', { id: req.params.id, _id: req.params.id });

  res.json({ success: true, message: 'Ingrédient supprimé avec succès', id: req.params.id });
});

module.exports = { getIngredients, addIngredient, updateIngredient, deleteIngredient };
