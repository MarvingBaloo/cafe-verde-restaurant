// backend/models/ActivityLog.js
// Couche d'accès Firestore pour la collection "activityLogs".
//
// NOTE PRODUCTION : les queries multi-champs nécessitent des index composites Firestore.
// À créer dans la console Firebase ou via firestore.indexes.json :
//   - (eventType ASC, timestamp ASC)
//   - (sessionId ASC, timestamp ASC)
//   - (user ASC, timestamp ASC)
//   - (page.path ASC, timestamp ASC)
// En mode émulateur / test, ces index ne sont pas requis.

const { activityLogs: activityLogsCol } = require('../config/firestore');

const VALID_EVENT_TYPES = [
  // Navigation
  'page_view', 'page_leave', 'catalog_view',
  // Configurateur
  'formula_selected', 'ingredient_added', 'ingredient_removed',
  'menu_selected', 'product_added', 'product_removed',
  // Commande
  'order_started', 'order_validated', 'order_cancelled',
  // Interactions
  'ingredient_preview', 'ai_chat_opened', 'ai_suggestion_applied',
  'search_performed', 'filter_applied',
  // UX
  // 'scroll_depth' : plus émis depuis le 2026-09-17 (46,8 % du volume, aucun lecteur).
  // Conservé dans la liste : 95 604 documents de l'historique portent ce type.
  'scroll_depth', 'time_on_page', 'click_event', 'hover_event',
  'error_occurred',
  // État utilisateur
  'user_inactive', 'user_active',
];

function formatActivityLog(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

module.exports = { activityLogsCol, VALID_EVENT_TYPES, formatActivityLog };
