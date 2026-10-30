// backend/controllers/analyticsController.js
const asyncHandler = require('express-async-handler');
const analyticsService = require('../services/analyticsService');
const { enrichActivity, getUserInfo } = require('../services/activityEnrichment');

/**
 * @desc    Récupérer les statistiques en temps réel pour le dashboard Super Admin
 * @route   GET /api/analytics/realtime
 * @access  Private (SuperAdmin uniquement)
 */
const getRealtimeStats = asyncHandler(async (req, res) => {
  const { timeRange = '24h' } = req.query;
  
  try {
    const stats = await analyticsService.getRealtimeStats(timeRange);
    res.json(stats);
  } catch (error) {
    console.error('Erreur récupération stats temps réel:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des statistiques' });
  }
});

/**
 * @desc    Récupérer la heatmap des clics pour une page spécifique
 * @route   GET /api/analytics/heatmap/:page
 * @access  Private (SuperAdmin uniquement)
 */
const getClickHeatmap = asyncHandler(async (req, res) => {
  const { page } = req.params;
  const { timeRange = '7d' } = req.query;
  
  try {
    const heatmap = await analyticsService.getClickHeatmap(decodeURIComponent(page), timeRange);
    res.json(heatmap);
  } catch (error) {
    console.error('Erreur récupération heatmap:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de la heatmap' });
  }
});

/**
 * @desc    Récupérer l'historique récent des activités (feed live, enrichi)
 * @route   GET /api/analytics/activities
 * @access  Private (SuperAdmin uniquement)
 */
const getActivities = asyncHandler(async (req, res) => {
  const { limit = 100, eventType = null } = req.query;

  try {
    const docs = await analyticsService.getRecentActivities({
      limit: Math.min(Number(limit) || 100, 500),
      eventType: eventType || null,
    });

    // Cache des lookups user pour éviter des lectures Firestore redondantes
    const userCache = new Map();
    const resolveUser = async (userId) => {
      if (!userId) return null;
      if (!userCache.has(userId)) userCache.set(userId, await getUserInfo(userId));
      return userCache.get(userId);
    };

    const enriched = await Promise.all(
      docs.map(async (doc) => enrichActivity(doc, await resolveUser(doc.user)))
    );

    res.json(enriched);
  } catch (error) {
    console.error('Erreur récupération activités:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des activités' });
  }
});

/**
 * @desc    Enregistrer une activité utilisateur (endpoint de secours si Socket.io échoue)
 * @route   POST /api/analytics/track
 * @access  Public
 */
const trackActivity = asyncHandler(async (req, res) => {
  try {
    const activity = await analyticsService.logActivity(req.body);
    res.status(201).json({ success: true, activity });
  } catch (error) {
    console.error('Erreur tracking activité:', error);
    res.status(500).json({ message: 'Erreur lors de l\'enregistrement de l\'activité' });
  }
});

module.exports = {
  getRealtimeStats,
  getClickHeatmap,
  getActivities,
  trackActivity
};
