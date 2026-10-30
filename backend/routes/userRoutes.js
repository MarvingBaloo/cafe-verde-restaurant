// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const {
  registerWithPhone,
  registerWithEmail,
  getMe,
  getUserProfile,
  updateUserProfile,
  updateUserByAdmin,
  deleteUser,
  getUsers,
  getUserById,
  searchUsers,
  registerQuick,
  deleteOwnAccount,
  exportOwnData
} = require('../controllers/userController');
const { protect, admin, superAdminOnly } = require('../middleware/authMiddleware');
const {
  validateUpdateProfileMiddleware,
  validateAdminUpdateMiddleware
} = require('../validators/userValidator');

/**
 * @route   POST /api/users/register-phone
 * @desc    Inscription via numéro de téléphone
 * @access  Public
 */
router.post('/register-phone', registerWithPhone);
router.post('/register-email', registerWithEmail);

/**
 * @route   GET /api/users/me
 * @desc    Obtenir l'utilisateur actuellement connecté
 * @access  Private
 */
router.get('/me', protect, getMe);

/**
 * @route   GET /api/users/me/export
 * @desc    Export des données personnelles du client (portabilité RGPD)
 * @access  Private
 */
router.get('/me/export', protect, exportOwnData);

/**
 * @route   DELETE /api/users/me
 * @desc    Suppression de son propre compte (effacement RGPD)
 * @access  Private
 */
router.delete('/me', protect, deleteOwnAccount);

/**
 * @route   GET /api/users/profile
 * @desc    Obtenir les infos de l'utilisateur connecté
 * @access  Private
 */
router.get('/profile', protect, getUserProfile);

/**
 * @route   PUT /api/users/profile
 * @desc    Mettre à jour le profil de l'utilisateur connecté
 * @access  Private
 */
router.put('/profile', protect, validateUpdateProfileMiddleware, updateUserProfile);

/**
 * @route   GET /api/users/search?q=...
 * @desc    Recherche utilisateur par nom/email/phone (caisse)
 * @access  Private/Admin
 */
router.get('/search', protect, admin, searchUsers);

/**
 * @route   POST /api/users/register-quick
 * @desc    Création rapide d'un client en caisse (sans Firebase Auth)
 * @access  Private/Admin
 */
router.post('/register-quick', protect, admin, registerQuick);

/**
 * @route   GET /api/users
 * @desc    Obtenir tous les utilisateurs (Admin/Superadmin seulement)
 * @access  Private/Admin
 */
router.get('/', protect, admin, getUsers);

/**
 * @route   GET /api/users/:id
 * @desc    Obtenir un utilisateur par ID (Admin/Superadmin seulement)
 * @access  Private/Admin
 */
router.get('/:id', protect, admin, getUserById);

/**
 * @route   PUT /api/users/:id
 * @desc    Mettre à jour un utilisateur par ID (Admin/Superadmin seulement)
 * @access  Private/Admin
 */
router.put('/:id', protect, admin, validateAdminUpdateMiddleware, updateUserByAdmin);

/**
 * @route   DELETE /api/users/:id
 * @desc    Supprimer un utilisateur par ID (Superadmin seulement)
 * @access  Private/Superadmin
 */
router.delete('/:id', protect, superAdminOnly, deleteUser);

module.exports = router;
