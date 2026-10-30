// backend/controllers/userController.js
const asyncHandler = require('express-async-handler');
const {
  usersCol,
  findAll,
  findById,
  findByEmail,
  findByPhone,
} = require('../models/User');
const { findByUser } = require('../models/Order');
const { normalizePhone } = require('../utils/phone');

const sendSuccess = (res, data, message = 'Opération réussie', statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    statusCode,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

function userPayload(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isAdmin: user.isAdmin,
    role: user.role,
    loyaltyPoints: user.loyaltyPoints,
  };
}

/**
 * @desc    Enregistrer un nouvel utilisateur via numéro de téléphone (OTP Firebase vérifié)
 * @route   POST /api/users/register-phone
 * @access  Public
 */
const registerWithPhone = asyncHandler(async (req, res) => {
  const { firebaseIdToken, name } = req.body;

  if (!firebaseIdToken || !name) {
    res.status(400);
    throw new Error('firebaseIdToken et name sont requis');
  }

  const { admin } = require('../config/firebase');
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
  } catch {
    res.status(401);
    throw new Error('Token Firebase invalide ou expiré');
  }

  const phone = decodedToken.phone_number;
  if (!phone) {
    res.status(400);
    throw new Error('Le token Firebase ne contient pas de numéro de téléphone');
  }

  const existing = await findByPhone(phone);
  if (existing) {
    res.status(400);
    throw new Error('Ce numéro de téléphone est déjà utilisé');
  }

  const userData = {
    name: name.trim(),
    phone,
    email: null,
    firebaseUid: decodedToken.uid,
    role: 'client',
    isAdmin: false,
    loyaltyPoints: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const docRef = await usersCol.add(userData);
  const user = { id: docRef.id, _id: docRef.id, ...userData };

  sendSuccess(res, { user: userPayload(user) }, 'Inscription réussie', 201);
});


/**
 * @desc    Enregistrer un client via email (Firebase Auth)
 * @route   POST /api/users/register-email
 * @access  Public
 */
const registerWithEmail = asyncHandler(async (req, res) => {
  const { firebaseIdToken, name } = req.body;

  if (!firebaseIdToken || !name) {
    res.status(400);
    throw new Error('firebaseIdToken et name sont requis');
  }

  const { admin } = require('../config/firebase');
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(firebaseIdToken);
  } catch {
    res.status(401);
    throw new Error('Token Firebase invalide ou expiré');
  }

  const email = decodedToken.email;
  if (!email) {
    res.status(400);
    throw new Error('Le token Firebase ne contient pas d\'email');
  }

  const existing = await findByEmail(email);
  if (existing) {
    res.status(400);
    throw new Error('Un compte avec cet email existe déjà');
  }

  const userData = {
    name: name.trim(),
    email,
    phone: null,
    firebaseUid: decodedToken.uid,
    role: 'client',
    isAdmin: false,
    loyaltyPoints: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const docRef = await usersCol.add(userData);
  const user = { id: docRef.id, _id: docRef.id, ...userData };

  sendSuccess(res, { user: userPayload(user) }, 'Inscription réussie', 201);
});

/**
 * @desc    Obtenir le profil de l'utilisateur connecté
 * @route   GET /api/users/profile
 * @access  Private
 */
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await findById(req.user._id);

  if (user) {
    sendSuccess(res, userPayload(user));
  } else {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }
});


/**
 * @desc    Obtenir l'utilisateur authentifié (via token Firebase)
 * @route   GET /api/users/me
 * @access  Private
 */
const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, { user: req.user }, 'Profil récupéré');
});
/**
 * @desc    Mettre à jour le profil de l'utilisateur connecté
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateUserProfile = asyncHandler(async (req, res) => {
  const { name, email } = req.body;
  const userId = req.user._id || req.user.id;
  const docRef = usersCol.doc(userId);
  const existing = await docRef.get();

  if (!existing.exists) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }

  // Vérification unicité email si changement
  if (email && email !== existing.data().email) {
    const taken = await findByEmail(email);
    if (taken && taken._id !== userId) {
      res.status(400);
      throw new Error('Cet email est déjà utilisé');
    }
  }

  const updateFields = { updatedAt: new Date() };
  if (name) updateFields.name = name;
  if (email) updateFields.email = email.toLowerCase().trim();

  await docRef.update(updateFields);

  const updatedData = { id: userId, _id: userId, ...existing.data(), ...updateFields };
  sendSuccess(res, userPayload(updatedData), 'Profil mis à jour');
});

/**
 * @desc    Le client supprime son propre compte (droit à l'effacement RGPD)
 * @route   DELETE /api/users/me
 * @access  Private
 */
const deleteOwnAccount = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const docRef = usersCol.doc(userId);
  const existing = await docRef.get();

  if (!existing.exists) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }

  const data = existing.data();

  // Sécurité : un compte staff ne se supprime pas via cette route
  if (data.role === 'admin' || data.role === 'superadmin') {
    res.status(403);
    throw new Error('Un compte administrateur ne peut pas être supprimé ici');
  }

  // Supprimer aussi le compte Firebase Auth associé (best-effort)
  if (data.firebaseUid) {
    const { admin } = require('../config/firebase');
    try {
      await admin.auth().deleteUser(data.firebaseUid);
    } catch (err) {
      console.error('⚠️ Suppression Firebase Auth échouée:', err.message);
    }
  }

  await docRef.delete();

  const io = req.app.get('socketio');
  if (io) io.emit('user_deleted', { id: userId });

  sendSuccess(res, null, 'Votre compte a été supprimé');
});

/**
 * @desc    Le client exporte ses données personnelles (portabilité RGPD)
 * @route   GET /api/users/me/export
 * @access  Private
 */
const exportOwnData = asyncHandler(async (req, res) => {
  const userId = req.user._id || req.user.id;
  const user = await findById(userId);

  if (!user) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }

  const orders = await findByUser(userId);

  const { password, firebaseUid, ...safeUser } = user;

  sendSuccess(res, {
    exportedAt: new Date().toISOString(),
    profile: safeUser,
    orders,
  }, 'Données personnelles exportées');
});

/**
 * @desc    Obtenir tous les utilisateurs
 * @route   GET /api/users
 * @access  Private/Admin
 */
const getUsers = asyncHandler(async (req, res) => {
  let users = await findAll();
  // Invisibilité : les comptes dev ne sont visibles que par un dev
  if (req.user.role !== 'dev') {
    users = users.filter((u) => u.role !== 'dev');
  }
  sendSuccess(res, users);
});

/**
 * @desc    Obtenir un utilisateur par ID
 * @route   GET /api/users/:id
 * @access  Private/Admin
 */
const getUserById = asyncHandler(async (req, res) => {
  const user = await findById(req.params.id);

  // Invisibilité : un compte dev est introuvable pour un non-dev
  if (user && user.role === 'dev' && req.user.role !== 'dev') {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }

  if (user) {
    sendSuccess(res, user);
  } else {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }
});

/**
 * @desc    Mettre à jour un utilisateur par ID
 * @route   PUT /api/users/:id
 * @access  Private/Admin
 */
const updateUserByAdmin = asyncHandler(async (req, res) => {
  const { name, email, role, loyaltyPoints } = req.body;
  const docRef = usersCol.doc(req.params.id);
  const existing = await docRef.get();

  if (!existing.exists) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }

  const requesterIsDev = req.user.role === 'dev';
  // (a) un non-dev ne peut pas modifier un compte dev
  if (existing.data().role === 'dev' && !requesterIsDev) {
    res.status(403);
    throw new Error('Accès refusé');
  }
  // (b) un non-dev ne peut pas promouvoir un compte vers dev
  if (role === 'dev' && !requesterIsDev) {
    res.status(403);
    throw new Error('Promotion vers le rôle dev interdite');
  }

  // Vérification unicité email si changement
  if (email && email !== existing.data().email) {
    const taken = await findByEmail(email);
    if (taken && taken._id !== req.params.id) {
      res.status(400);
      throw new Error('Cet email est déjà utilisé');
    }
  }

  const updateFields = { updatedAt: new Date() };
  if (name) updateFields.name = name;
  if (email) updateFields.email = email.toLowerCase().trim();
  if (role) {
    updateFields.role = role;
    updateFields.isAdmin = role === 'admin' || role === 'superadmin';
  }
  if (loyaltyPoints !== undefined) updateFields.loyaltyPoints = loyaltyPoints;

  await docRef.update(updateFields);

  const updatedData = { id: req.params.id, _id: req.params.id, ...existing.data(), ...updateFields };

  const io = req.app.get('socketio');
  if (io) io.emit('user_updated', userPayload(updatedData));

  sendSuccess(res, userPayload(updatedData), 'Utilisateur mis à jour');
});

/**
 * @desc    Supprimer un utilisateur par ID
 * @route   DELETE /api/users/:id
 * @access  Private/Superadmin
 */
const deleteUser = asyncHandler(async (req, res) => {
  const docRef = usersCol.doc(req.params.id);
  const existing = await docRef.get();

  if (!existing.exists) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }

  if (existing.data().email === process.env.SUPERADMIN_EMAIL) {
    res.status(403);
    throw new Error('Impossible de supprimer le compte superadmin principal');
  }

  await docRef.delete();

  const io = req.app.get('socketio');
  if (io) io.emit('user_deleted', { id: req.params.id });

  sendSuccess(res, null, 'Utilisateur supprimé');
});

/**
 * @desc    Rechercher des utilisateurs par nom, email ou téléphone
 * @route   GET /api/users/search?q=...
 * @access  Private/Admin
 */
const searchUsers = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.length < 2) {
    return sendSuccess(res, []);
  }

  const query = q.toLowerCase();
  const allUsers = await findAll();
  const requesterIsDev = req.user.role === 'dev';

  const results = allUsers
    .filter((user) => {
      if (user.role === 'dev' && !requesterIsDev) return false;
      const name  = (user.name  || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      const phone = (user.phone || '').toLowerCase();
      return name.includes(query) || email.includes(query) || phone.includes(query);
    })
    .slice(0, 20)
    .map((user) => ({
      _id:           user._id,
      name:          user.name,
      email:         user.email,
      phone:         user.phone,
      loyaltyPoints: user.loyaltyPoints,
    }));

  sendSuccess(res, results);
});

/**
 * @desc    Créer un client rapidement depuis la caisse (sans Firebase Auth)
 * @route   POST /api/users/register-quick
 * @access  Private/Admin
 */
const registerQuick = asyncHandler(async (req, res) => {
  const { name, email } = req.body;
  const phone = normalizePhone(req.body.phone); // E.164 → réconciliation fiable avec Firebase Auth

  if (!name || (!phone && !email)) {
    res.status(400);
    throw new Error('Nom et (téléphone ou email) requis');
  }

  if (phone) {
    const existingPhone = await findByPhone(phone);
    if (existingPhone) {
      res.status(400);
      throw new Error('Ce numéro est déjà utilisé');
    }
  }

  if (email) {
    const existingEmail = await findByEmail(email);
    if (existingEmail) {
      res.status(400);
      throw new Error('Cet email est déjà utilisé');
    }
  }

  const userData = {
    name:        name.trim(),
    phone:       phone ? phone.trim() : null,
    email:       email ? email.toLowerCase().trim() : null,
    firebaseUid: null,
    role:        'client',
    isAdmin:     false,
    loyaltyPoints: 0,
    createdAt:   new Date(),
    updatedAt:   new Date(),
  };

  const docRef = await usersCol.add(userData);
  const user = { id: docRef.id, _id: docRef.id, ...userData };

  sendSuccess(res, { user: userPayload(user) }, 'Client créé', 201);
});

module.exports = {
  registerWithPhone,
  registerWithEmail,
  getUserProfile,
  getMe,
  updateUserProfile,
  getUsers,
  getUserById,
  updateUserByAdmin,
  deleteUser,
  deleteOwnAccount,
  exportOwnData,
  searchUsers,
  registerQuick,
};
