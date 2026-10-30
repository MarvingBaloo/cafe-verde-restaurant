// backend/routes/aiRoutes.js
const express = require('express');
const router = express.Router();
const { getSuggestions, getMoodRecommendation } = require('../controllers/aiController');

/**
 * @route   POST /api/ai/suggest
 * @desc    Obtenir une suggestion d'ingrédient intelligente basée sur le panier actuel
 * @access  Public
 */
router.post('/suggest', getSuggestions);

/**
 * @route   POST /api/ai/mood
 * @desc    Générer une composition complète basée sur l'humeur
 * @access  Public
 */
router.post('/mood', getMoodRecommendation);

module.exports = router;