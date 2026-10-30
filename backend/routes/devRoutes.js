// backend/routes/devRoutes.js
const express = require('express');
const router = express.Router();
const {
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  backup,
  restore,
  setPassword,
  stripePaymentPreview,
  importOrderFromStripe,
  updateImportedOrderItems,
} = require('../controllers/devController');
const { protect, devOnly } = require('../middleware/authMiddleware');

// Toutes les routes /api/dev sont réservées au rôle dev
router.use(protect, devOnly);

router.get('/users', listUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.put('/users/:id/password', setPassword);
router.delete('/users/:id', deleteUser);
router.get('/backup', backup);
router.post('/restore', restore);

// Réintégration d'un paiement Stripe orphelin (aperçu → import → complément d'articles)
router.get('/stripe-payment/:paymentIntentId', stripePaymentPreview);
router.post('/orders/from-stripe', importOrderFromStripe);
router.put('/orders/:id/items', updateImportedOrderItems);

module.exports = router;
