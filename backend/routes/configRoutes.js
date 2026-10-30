const express = require('express');
const { getConfig } = require('../controllers/configController.js');

const router = express.Router();

/**
 * @description Route pour récupérer les données de configuration globales (formules et menus).
 * @route GET /api/config
 * @access Public
 */
router.route('/').get(getConfig);

module.exports = router;
