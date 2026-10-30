// src/services/api.js
import axios from 'axios';
import { auth } from '../config/firebase';

// Configuration de l'instance Axios
// CORRECTION : Port 5000 et activation des credentials
const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
  withCredentials: true
});

api.interceptors.request.use(
  async (config) => {
    try {
      // Attendre que Firebase ait restauré la session (évite les requêtes
      // qui partent sans token juste après un rechargement de page).
      if (auth.authStateReady) await auth.authStateReady();
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Jeton indisponible : la requête part sans en-tête. Les routes publiques
      // (catalogue, horaires, TVA) fonctionnent ainsi ; les autres répondront 401.
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Récupère la configuration complète du backend.
 */
export const fetchConfig = () => {
  return api.get('/config');
};

// --- Configuration TVA (Espace Gérant) ---
export const fetchTaxConfig = () => api.get('/settings/tax');
export const updateTaxConfig = (data) => api.put('/settings/tax', data);

// Horaires d'ouverture / fenêtre de commande en ligne.
// La lecture est publique : la boutique doit savoir si elle peut prendre une commande
// avant toute connexion.
export const fetchOpeningHours = () => api.get('/settings/hours');
export const updateOpeningHours = (data) => api.put('/settings/hours', data);

/**
 * Récupère la liste de tous les ingrédients disponibles.
 */
export const fetchIngredients = () => {
  return api.get('/ingredients');
};

/**
 * Récupère la liste de tous les produits disponibles.
 */
export const fetchProducts = () => {
  return api.get('/products');
};

/**
 * Crée un nouveau produit.
 */
export const createProduct = (data) => {
  return api.post('/products', data);
};

/**
 * Met à jour un produit.
 */
export const updateProduct = (id, data) => {
  return api.put(`/products/${id}`, data);
};

/**
 * Upload une image de produit.
 */
export const uploadProductImage = (formData) => {
  return api.post('/products/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

// PRODUCT CATEGORIES (arbre de catégories de produits)
export const fetchProductCategories = () => api.get('/product-categories');
export const createProductCategory = (data) => api.post('/product-categories', data);
export const updateProductCategory = (id, data) => api.put(`/product-categories/${id}`, data);
export const deleteProductCategory = (id) => api.delete(`/product-categories/${id}`);

/**
 * Récupère la liste de tous les menus.
 */
export const fetchMenus = () => {
  return api.get('/menus');
};

/**
 * Crée un nouveau menu.
 */
export const createMenu = (data) => {
  return api.post('/menus', data);
};

/**
 * Upload une image de menu. Renvoie { data: { imageUrl } }.
 */
export const uploadMenuImage = (formData) => {
  return api.post('/menus/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

/**
 * Met à jour un menu.
 */
export const updateMenu = (id, data) => {
  return api.put(`/menus/${id}`, data);
};

export const deleteMenu = (id) => {
  return api.delete(`/menus/${id}`);
};

export const deleteIngredient = (id) => {
  return api.delete(`/ingredients/${id}`);
};

/**
 * Récupère toutes les commandes.
 */
export const fetchOrders = () => {
  return api.get('/orders');
};

/**
 * Récupère une commande complète par son id (détail du ticket).
 */
export const fetchOrderById = (id) => {
  return api.get(`/orders/${id}`);
};

/**
 * Met à jour le statut d'une commande.
 */
export const updateOrderStatus = (id, status) => {
  return api.put(`/orders/${id}/status`, { status });
};

/**
 * Supprime définitivement une commande en base.
 */
export const deleteOrder = (id) => {
  return api.delete(`/orders/${id}`);
};

/**
 * Points de fidélité qui seront repris si ces commandes sont supprimées (aperçu, sans écriture).
 */
export const getDeletionImpact = (ids) => {
  return api.post('/orders/deletion-impact', { ids });
};

/**
 * Envoie une nouvelle commande.
 */
export const createOrder = (orderData) => {
  return api.post('/orders', orderData);
};

/**
 * Récupère les commandes en ligne non réglées d'un client (caisse).
 */
export const fetchUnpaidOnlineOrders = (userId) => {
  return api.get(`/orders/online-unpaid/${userId}`);
};

/**
 * Encaisse à la caisse une commande passée en ligne (met à jour l'existante).
 */
export const settleOrder = (orderId, data) => {
  return api.put(`/orders/${orderId}/settle`, data);
};

/**
 * Tickets ouverts en caisse (non réglés, déjà au KDS).
 */
export const fetchOpenTickets = () => {
  return api.get('/orders/open');
};

/**
 * Met à jour le contenu d'un ticket ouvert (ajout d'articles, sans encaisser).
 */
export const updateOpenTicketItems = (orderId, data) => {
  return api.put(`/orders/${orderId}/items`, data);
};

/**
 * Encaisse la part d'un convive qui part avant la fin du repas : le règlement est enregistré
 * sur le ticket, qui reste ouvert pour le reste de la table.
 * payload : { amount, method, items?, user?, userName?, pointsRedeemed?, paymentIntentId?,
 *             cashGiven?, change?, cardAmount?, ticketAmount?, cashAmount?, splitMode? }
 */
export const recordPartPayment = (orderId, payload) => {
  return api.post(`/orders/${orderId}/part-payment`, payload);
};

/**
 * Rembourse une commande (total ou partiel). payload : { amount, items?, reason?, method? }
 */
export const refundOrder = (orderId, payload) => {
  return api.patch(`/orders/${orderId}/refund`, payload);
};

/**
 * Envoie le ticket d'une commande par email ou SMS. channel : 'email' | 'sms', to : destinataire.
 * detail : false → ticket « sans détail » (total + nombre d'articles, sans la liste).
 */
export const sendOrderReceipt = (orderId, channel, to, detail = true, partIndex = null) => {
  // `partIndex` : justificatif d'UNE part (convive parti avant la fin) au lieu de la note complète.
  return api.post(`/orders/${orderId}/send-receipt`, {
    channel, to, detail, ...(partIndex ? { partIndex } : {}),
  });
};

/**
 * Crée un nouvel ingrédient.
 */
export const createIngredient = (data) => {
  return api.post('/ingredients', data);
};

/**
 * Met à jour un ingrédient.
 */
export const updateIngredient = (id, data) => {
  return api.put(`/ingredients/${id}`, data);
};

/**
 * Upload une image d'ingrédient.
 */
export const uploadIngredientImage = (formData) => {
  return api.post('/ingredients/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

/**
 * Demande une suggestion IA.
 */
export const fetchAiSuggestion = (contextData) => {
  return api.post('/ai/suggest', contextData);
};

/**
 * Demande une recommandation Mood Food.
 */
export const fetchMoodRecommendation = (mood) => {
  return api.post('/ai/mood', { mood });
};

/**
 * Récupère les stats Admin.
 */
export const fetchAdminStats = () => {
  return api.get('/admin/stats');
};

export const fetchAccountingData = (from, to) => {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to)   params.append('to', to);
  return api.get(`/admin/accounting?${params.toString()}`);
};

/**
 * Récupère les statistiques en temps réel pour le Super Admin.
 */
export const fetchRealtimeStats = (timeRange = '24h') => {
  return api.get(`/analytics/realtime?timeRange=${timeRange}`);
};

/**
 * Récupère la heatmap des clics pour une page.
 */
export const fetchClickHeatmap = (page, timeRange = '7d') => {
  return api.get(`/analytics/heatmap/${encodeURIComponent(page)}?timeRange=${timeRange}`);
};

/**
 * Récupère l'historique récent des activités (feed live, enrichi).
 */
export const fetchRecentActivities = ({ limit = 100, eventType = null } = {}) => {
  const params = new URLSearchParams({ limit });
  if (eventType && eventType !== 'all') params.set('eventType', eventType);
  return api.get(`/analytics/activities?${params.toString()}`);
};

/**
 * Enregistre une activité utilisateur (fallback si Socket.io échoue).
 */
export const trackActivity = (activityData) => {
  return api.post('/analytics/track', activityData);
};

/**
 * Récupère les commandes d'un utilisateur spécifique.
 */
export const fetchOrdersByUser = (userId) => {
  return api.get(`/orders/user/${userId}`);
};

// =============================================
// FORMULAS API
// =============================================

/**
 * Récupère toutes les formules.
 */
export const fetchFormulas = () => {
  return api.get('/formulas');
};

/**
 * Récupère une formule par ID.
 */
export const fetchFormulaById = (id) => {
  return api.get(`/formulas/${id}`);
};

/**
 * Crée une nouvelle formule.
 */
export const createFormula = (data) => {
  return api.post('/formulas', data);
};

/**
 * Met à jour une formule.
 */
export const updateFormula = (id, data) => {
  return api.put(`/formulas/${id}`, data);
};

/**
 * Supprime une formule.
 */
export const deleteFormula = (id) => {
  return api.delete(`/formulas/${id}`);
};

/**
 * Upload une image pour une formule.
 */
export const uploadFormulaImage = (id, formData) => {
  return api.post(`/formulas/${id}/image`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
};

// ========================
// Dishes (plats chauds)
// ========================

export const fetchDishes = () => {
  return api.get('/dishes');
};

export const createDish = (data) => {
  return api.post('/dishes', data);
};

export const updateDish = (id, data) => {
  return api.put(`/dishes/${id}`, data);
};

export const deleteDish = (id) => {
  return api.delete(`/dishes/${id}`);
};

export const uploadDishImage = (formData) => {
  return api.post('/dishes/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
};

// ========================
// Bubble Tea
// ========================

// --- Bubble teas (produits configurables) ---
export const fetchBubbleTeas = () => api.get('/bubble-teas');
export const fetchBubbleTeaById = (id) => api.get(`/bubble-teas/${id}`);
export const createBubbleTea = (data) => api.post('/bubble-teas', data);
export const updateBubbleTea = (id, data) => api.put(`/bubble-teas/${id}`, data);
export const deleteBubbleTea = (id) => api.delete(`/bubble-teas/${id}`);
export const toggleBubbleTeaAvailability = (id) => api.patch(`/bubble-teas/${id}/toggle-availability`);
export const uploadBubbleTeaImage = (formData) =>
  api.post('/bubble-teas/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });

export const fetchMilkshakes = () => api.get('/milkshakes');
export const fetchMilkshakeById = (id) => api.get(`/milkshakes/${id}`);
export const createMilkshake = (data) => api.post('/milkshakes', data);
export const updateMilkshake = (id, data) => api.put(`/milkshakes/${id}`, data);
export const deleteMilkshake = (id) => api.delete(`/milkshakes/${id}`);
export const toggleMilkshakeAvailability = (id) => api.patch(`/milkshakes/${id}/toggle-availability`);
export const uploadMilkshakeImage = (formData) =>
  api.post('/milkshakes/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });

export const searchUsers = (q) => api.get(`/users/search?q=${encodeURIComponent(q)}`);
export const getUsers = () => api.get('/users');
export const getUserById = (id) => api.get(`/users/${id}`);
export const updateUserByAdmin = (id, data) => api.put(`/users/${id}`, data);
export const registerQuick = (data) => api.post("/users/register-quick", data);
export const updateProfile = (data) => api.put('/users/profile', data);
export const deleteOwnAccount = () => api.delete('/users/me');
export const exportOwnData = () => api.get('/users/me/export');
export const createPaymentIntent = (data) => api.post('/payment/create-intent', data);
export const collectTerminalPayment = (data) => api.post('/payment/terminal/collect', data);
export const getTerminalPaymentStatus = (paymentIntentId) => api.get('/payment/terminal/status', { params: { paymentIntentId } });
export const captureTerminalPayment = (data) => api.post('/payment/terminal/capture', data);
export const cancelTerminalPayment = (data) => api.post('/payment/terminal/cancel', data);
export const fetchTips = (from, to) => api.get('/payment/tips', { params: { from, to } });

// --- Espace DEV (rôle dev uniquement) ---
export const devListUsers = () => api.get('/dev/users');
export const devCreateUser = (data) => api.post('/dev/users', data);
export const devUpdateUser = (id, data) => api.put(`/dev/users/${id}`, data);
export const devDeleteUser = (id) => api.delete(`/dev/users/${id}`);
export const devBackup = () => api.get('/dev/backup');
export const devRestore = (payload) => api.post('/dev/restore', payload);
export const devSetPassword = (id, password) => api.put(`/dev/users/${id}/password`, { password });

// Réintégration d'un paiement Stripe orphelin (Espace DEV uniquement)
export const devStripePaymentPreview = (paymentIntentId) => api.get(`/dev/stripe-payment/${paymentIntentId}`);
export const devImportOrderFromStripe = (payload) => api.post('/dev/orders/from-stripe', payload);
export const devUpdateOrderItems = (id, payload) => api.put(`/dev/orders/${id}/items`, payload);

export default api;