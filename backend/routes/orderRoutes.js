const express = require('express');
const router = express.Router();

// Importation des contrôleurs et middlewares
const {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  getDeletionImpact,
  getOrdersByUser,
  cancelOrder,
  getUnpaidOnlineOrders,
  getOpenTickets,
  updateOpenTicketItems,
  recordPartPayment,
  settleOnlineOrder,
  refundOrder,
  sendReceipt
} = require('../controllers/orderController.js');

const { protect, attachUser, admin, staff } = require('../middleware/authMiddleware');
const {
  validateCreateOrderMiddleware,
  validateUpdateOrderMiddleware
} = require('../validators/orderValidator');

/**
 * @route   GET /api/orders
 * @desc    Récupérer toutes les commandes
 * @access  Private/Staff (admin, superadmin, dev ou cuisine)
 */
router.get('/', protect, staff, getOrders);

/**
 * @route   GET /api/orders/open
 * @desc    Tickets ouverts en caisse (non réglés, déjà au KDS)
 * @access  Private/Admin
 * @note    DOIT rester avant GET /:id (sinon "open" est capté comme :id)
 */
router.get('/open', protect, admin, getOpenTickets);

/**
 * @route   GET /api/orders/:id
 * @desc    Récupérer une commande par ID
 * @access  Private (staff ou propriétaire de la commande)
 */
router.get('/:id', protect, getOrderById);

/**
 * @route   POST /api/orders
 * @desc    Créer une nouvelle commande
 * @access  Public (authentifié ou invité)
 * @note    `attachUser` n'exige PAS de jeton — la commande anonyme reste possible.
 *          Il renseigne `req.user` quand il y en a un, pour que createOrder puisse
 *          refuser de rattacher une commande (et de débiter des points) à un client
 *          au nom de quelqu'un qui n'a pas le droit d'agir pour lui.
 */
router.post('/', attachUser, validateCreateOrderMiddleware, createOrder);

/**
 * @route   PUT /api/orders/:id
 * @desc    Mettre à jour une commande (champs généraux)
 * @access  Private/Admin
 */
router.put('/:id', protect, admin, validateUpdateOrderMiddleware, updateOrder);

/**
 * @route   PUT /api/orders/:id/status
 * @desc    Mettre à jour uniquement le statut d'une commande
 * @access  Private/Staff (admin, superadmin, dev ou cuisine)
 */
router.put('/:id/status', protect, staff, updateOrderStatus);

/**
 * @route   DELETE /api/orders/:id
 * @desc    Supprimer une commande
 * @access  Private/Admin
 */
router.delete('/:id', protect, admin, deleteOrder);

/**
 * @route   POST /api/orders/deletion-impact
 * @desc    Points repris si ces commandes sont supprimées (aperçu, aucune écriture)
 * @access  Private/Admin
 */
router.post('/deletion-impact', protect, admin, getDeletionImpact);

/**
 * @route   GET /api/orders/user/:userId
 * @desc    Récupérer les commandes d'un utilisateur spécifique
 * @access  Private (Admin ou utilisateur propriétaire)
 */
router.get('/user/:userId', protect, getOrdersByUser);

/**
 * @route   GET /api/orders/online-unpaid/:userId
 * @desc    Commandes en ligne non réglées d'un client (récupération à la caisse)
 * @access  Private/Admin
 */
router.get('/online-unpaid/:userId', protect, admin, getUnpaidOnlineOrders);

/**
 * @route   PATCH /api/orders/:id/cancel
 * @desc    Annuler une commande (gérant uniquement)
 * @access  Private/Gérant
 */
router.patch('/:id/cancel', protect, cancelOrder);

/**
 * @route   PUT /api/orders/:id/settle
 * @desc    Encaisser à la caisse une commande passée en ligne (met à jour l'existante, crédite la fidélité)
 * @access  Private/Admin
 */
router.put('/:id/settle', protect, admin, settleOnlineOrder);

/**
 * @route   PUT /api/orders/:id/items
 * @desc    Met à jour le contenu d'un ticket ouvert (ajout d'articles, sans encaisser)
 * @access  Private/Admin
 */
router.put('/:id/items', protect, admin, updateOpenTicketItems);

/**
 * @route   POST /api/orders/:id/part-payment
 * @desc    Enregistre un règlement partiel sur un ticket ouvert (un convive paie sa part et s'en va)
 * @access  Private/Admin
 */
router.post('/:id/part-payment', protect, admin, recordPartPayment);

/**
 * @route   PATCH /api/orders/:id/refund
 * @desc    Rembourser une commande (total ou partiel)
 * @access  Private/Admin
 */
router.patch('/:id/refund', protect, admin, refundOrder);

/**
 * @route   POST /api/orders/:id/send-receipt
 * @desc    Envoie le ticket de la commande par email ou SMS (Brevo)
 * @access  Private (propriétaire ou admin)
 */
router.post('/:id/send-receipt', protect, sendReceipt);

module.exports = router;
