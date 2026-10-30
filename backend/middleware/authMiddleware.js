const asyncHandler = require('express-async-handler');
const { admin } = require('../config/firebase');
const { findByFirebaseUid, findByEmail, findByPhone } = require('../models/User');
const { users: usersCol } = require('../config/firestore');

/**
 * Résout l'utilisateur porté par l'en-tête Authorization et le pose sur `req.user`.
 * Renvoie false si AUCUN jeton n'est fourni ; lève dans tous les autres cas d'échec.
 *
 * Chemin unique partagé par `protect` et `attachUser` : deux résolutions séparées
 * dériveraient silencieusement (repli email/téléphone, claim dev, resynchro isAdmin).
 */
const resolveUser = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return false;
  const idToken = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch {
    res.status(401);
    throw new Error('Token Firebase invalide ou expiré');
  }

  req.user = await findByFirebaseUid(decoded.uid);

  // Fallback pour les comptes créés sans firebaseUid (admin email ou client téléphone)
  if (!req.user) {
    if (decoded.email) {
      req.user = await findByEmail(decoded.email);
    } else if (decoded.phone_number) {
      req.user = await findByPhone(decoded.phone_number);
    }
    // Écrire firebaseUid pour les prochaines requêtes
    if (req.user) {
      await usersCol.doc(req.user.id).update({ firebaseUid: decoded.uid });
      req.user.firebaseUid = decoded.uid;
    }
  }

  if (!req.user) {
    res.status(401);
    throw new Error('Utilisateur non trouvé');
  }

  // Valeur telle qu'elle est stockée en base. C'est elle qu'il faut confronter à la
  // valeur attendue, et non celle que le bloc dev ci-dessous force en mémoire : sinon
  // la divergence est masquée et le doc Firestore ne se resynchronise jamais (le compte
  // dev est resté à isAdmin:false pendant des mois pour cette raison).
  const storedIsAdmin = req.user.isAdmin;

  // Le custom claim Firebase 'role: dev' fait autorité (token signé par Google).
  // Seul ce claim ouvre les pleins pouvoirs : un champ Firestore role:'dev' ne suffit pas.
  const isDevClaim = decoded.role === 'dev';
  req.user.isDev = isDevClaim;
  if (isDevClaim) {
    req.user.role = 'dev';
  }

  const expectedIsAdmin = req.user.role === 'admin' || req.user.role === 'superadmin' || req.user.role === 'dev';
  if (storedIsAdmin !== expectedIsAdmin) {
    await usersCol.doc(req.user.id).update({ isAdmin: expectedIsAdmin });
  }
  req.user.isAdmin = expectedIsAdmin;
  return true;
};

const protect = asyncHandler(async (req, res, next) => {
  if (!(await resolveUser(req, res))) {
    res.status(401);
    throw new Error('Non autorisé, aucun token fourni');
  }
  next();
});

/**
 * @middleware attachUser
 * @description Authentification OPTIONNELLE : renseigne `req.user` si un jeton valide
 * est présent, laisse simplement passer si aucun jeton n'est fourni. Un jeton présent
 * mais invalide reste refusé — seule l'ABSENCE de jeton est tolérée.
 *
 * Pour les routes ouvertes aux visiteurs mais dont le contrôleur doit savoir qui appelle
 * (POST /orders : la commande anonyme doit rester possible, mais le débit des points d'un
 * client ne doit pas reposer sur le seul corps de la requête).
 */
const attachUser = asyncHandler(async (req, res, next) => {
  await resolveUser(req, res);
  next();
});

/**
 * @middleware admin
 * @description Vérifie si l'utilisateur connecté est un administrateur.
 * Doit être placé APRÈS le middleware 'protect'.
 */
const adminMiddleware = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    next();
  } else {
    res.status(401);
    throw new Error('Non autorisé, droits administrateur requis');
  }
};

/**
 * @middleware superAdminOnly
 * @description Vérifie si l'utilisateur connecté est un super administrateur.
 * Réservé aux fonctionnalités critiques (prix, analytics, configuration système).
 * Doit être placé APRÈS le middleware 'protect'.
 */
const superAdminOnly = (req, res, next) => {
  if (req.user && (req.user.role === 'superadmin' || req.user.role === 'dev')) {
    next();
  } else {
    res.status(403);
    throw new Error('Accès refusé, droits Super Admin requis');
  }
};

/**
 * @middleware devOnly
 * @description Réservé au rôle dev (super-utilisateur). APRÈS 'protect'.
 */
const devOnly = (req, res, next) => {
  if (req.user && req.user.isDev) {
    next();
  } else {
    res.status(403);
    throw new Error('Accès refusé, droits Développeur requis');
  }
};

/**
 * @middleware staff
 * @description Personnel de service : admin, superadmin, dev OU cuisine.
 * Le rôle 'kitchen' n'est pas isAdmin mais pilote le KDS — il doit lire les
 * commandes et faire avancer leur statut. APRÈS 'protect'.
 */
const staff = (req, res, next) => {
  if (req.user && (req.user.isAdmin || req.user.role === 'kitchen')) {
    next();
  } else {
    res.status(403);
    throw new Error('Accès refusé, compte de service requis');
  }
};

module.exports = { protect, attachUser, admin: adminMiddleware, staff, superAdminOnly, devOnly };
