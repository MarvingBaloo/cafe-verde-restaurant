// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { getDashboardStats, getAccountingData } = require('../controllers/adminController');
const { protect, admin } = require('../middleware/authMiddleware');

/**
 * @route   GET /api/admin/stats
 * @desc    Récupérer les KPIs, le graphique et les tops produits
 * @access  Private (Admin)
 */
router.get('/stats', protect, admin, getDashboardStats);
router.get('/accounting', protect, admin, getAccountingData);

module.exports = router;