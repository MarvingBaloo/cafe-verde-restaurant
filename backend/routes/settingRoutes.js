const express = require('express');
const { getTax, updateTax, getHours, updateHours } = require('../controllers/settingController');
const { protect, superAdminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// Lecture PUBLIQUE : la caisse comme la boutique en ont besoin, et la boutique sert
// des visiteurs sans compte (voir la note du contrôleur).
router.get('/tax', getTax);
// Écriture : réservée à l'Espace Gérant (superadmin / dev).
router.put('/tax', protect, superAdminOnly, updateTax);

// Horaires — lecture PUBLIQUE : la boutique doit savoir si elle peut prendre une
// commande avant toute connexion (comme les lectures du catalogue).
router.get('/hours', getHours);
router.put('/hours', protect, superAdminOnly, updateHours);

module.exports = router;
