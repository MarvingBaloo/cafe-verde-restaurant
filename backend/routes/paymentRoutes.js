const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
  createPaymentIntent,
  collectTerminalPayment,
  getTerminalPaymentStatus,
  captureTerminalPayment,
  cancelTerminalPayment,
  getTerminalSimulator,
  simulateTerminalCard,
  getTips,
} = require('../controllers/paymentController');

router.post('/create-intent', createPaymentIntent);
router.post('/terminal/collect', protect, admin, collectTerminalPayment);
router.get('/terminal/status', protect, admin, getTerminalPaymentStatus);
router.post('/terminal/capture', protect, admin, captureTerminalPayment);
router.post('/terminal/cancel', protect, admin, cancelTerminalPayment);
router.get('/terminal/simulator', protect, admin, getTerminalSimulator);
router.post('/terminal/simulate', protect, admin, simulateTerminalCard);
router.get('/tips', protect, admin, getTips);

module.exports = router;
