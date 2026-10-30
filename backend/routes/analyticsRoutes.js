// backend/routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const { superAdminOnly } = require('../middleware/authMiddleware');
const {
  getRealtimeStats,
  getClickHeatmap,
  getActivities,
  trackActivity
} = require('../controllers/analyticsController');

// Routes protégées - SuperAdmin uniquement
router.get('/realtime', protect, superAdminOnly, getRealtimeStats);
router.get('/heatmap/:page', protect, superAdminOnly, getClickHeatmap);
router.get('/activities', protect, superAdminOnly, getActivities);

// Route publique pour le tracking (endpoint de secours)
router.post('/track', trackActivity);

module.exports = router;
