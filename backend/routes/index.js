/**
 * Fichier d'index centralisé pour toutes les routes de l'API
 * Permet une importation simplifiée dans server.js et une vue d'ensemble de toutes les routes
 */

const express = require('express');
const router = express.Router();

// Importation de toutes les routes par domaine
const adminRoutes = require('./adminRoutes');
const aiRoutes = require('./aiRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const configRoutes = require('./configRoutes');
const formulaRoutes = require('./formulaRoutes');
const ingredientRoutes = require('./ingredientRoutes');
const menuRoutes = require('./menuRoutes');
const orderRoutes = require('./orderRoutes');
const paymentRoutes = require('./paymentRoutes');
const productRoutes = require('./productRoutes');
const userRoutes = require('./userRoutes');

/**
 * Montage de toutes les routes avec leurs préfixes
 * Note: Les préfixes doivent correspondre à ceux définis dans server.js
 */
router.use('/admin', adminRoutes);
router.use('/ai', aiRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/config', configRoutes);
router.use('/formulas', formulaRoutes);
router.use('/ingredients', ingredientRoutes);
router.use('/menus', menuRoutes);
router.use('/orders', orderRoutes);
router.use('/payment', paymentRoutes);
router.use('/products', productRoutes);
router.use('/users', userRoutes);

/**
 * Exportation de toutes les routes regroupées
 * @module routes
 */
module.exports = {
  // Routes individuelles pour une utilisation sélective
  adminRoutes,
  aiRoutes,
  analyticsRoutes,
  configRoutes,
  formulaRoutes,
  ingredientRoutes,
  menuRoutes,
  orderRoutes,
  paymentRoutes,
  productRoutes,
  userRoutes,
  
  // Router principal avec toutes les routes préfixées
  router,
  
  // Documentation des préfixes
  prefixes: {
    admin: '/admin',
    ai: '/ai',
    analytics: '/analytics',
    config: '/config',
    formulas: '/formulas',
    ingredients: '/ingredients',
    menus: '/menus',
    orders: '/orders',
    payment: '/payment',
    products: '/products',
    users: '/users'
  }
};
