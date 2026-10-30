const asyncHandler = require('express-async-handler');
const { findAll: findAllFormulas } = require('../models/Formula.js');
const { findAll: findAllMenus } = require('../models/Menu.js');

/**
 * @description Récupère toutes les données de configuration de l'application,
 * ce qui inclut toutes les formules et tous les menus disponibles.
 * C'est utile pour charger les options initiales du configurateur côté client.
 * @route   GET /api/config
 * @access  Public
 * @author  Your Name
 */
const getConfig = asyncHandler(async (req, res) => {
  const formulas = await findAllFormulas();
  const menus = await findAllMenus();
  
  res.json({ formulas, menus });
});

module.exports = {
  getConfig,
};
