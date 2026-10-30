/**
 * @file Validateur pour les données d'utilisateurs
 * Fournit des fonctions de validation réutilisables pour les routes d'utilisateurs
 * (Version simplifiée sans dépendance externe)
 */

/**
 * Rôles d'utilisateur valides
 */
const VALID_ROLES = ['client', 'admin', 'superadmin', 'kitchen', 'dev'];

/**
 * Valide une adresse email
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  
  // Expression régulière simple pour validation d'email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/**
 * Valide la force d'un mot de passe
 */
const validatePasswordStrength = (password) => {
  if (!password || typeof password !== 'string') {
    return { valid: false, errors: ['Le mot de passe est obligatoire'] };
  }

  const errors = [];
  
  if (password.length < 8) {
    errors.push('Le mot de passe doit contenir au moins 8 caractères');
  }
  
  if (password.length > 100) {
    errors.push('Le mot de passe ne peut pas dépasser 100 caractères');
  }
  
  // Optionnel : ajouter des règles de complexité si besoin
  // if (!/[A-Z]/.test(password)) {
  //   errors.push('Le mot de passe doit contenir au moins une majuscule');
  // }
  // if (!/[0-9]/.test(password)) {
  //   errors.push('Le mot de passe doit contenir au moins un chiffre');
  // }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Valide les données d'inscription d'utilisateur
 */
const validateRegister = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Nom (requis, 2-50 caractères)
  if (!data.name || typeof data.name !== 'string') {
    errors.push({ field: 'name', message: 'Le nom est obligatoire' });
  } else {
    const name = data.name.trim();
    if (name.length < 2) {
      errors.push({ field: 'name', message: 'Le nom doit contenir au moins 2 caractères' });
    } else if (name.length > 50) {
      errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 50 caractères' });
    } else {
      validatedData.name = name;
    }
  }

  // Email (requis, valide)
  if (!data.email || typeof data.email !== 'string') {
    errors.push({ field: 'email', message: 'L\'email est obligatoire' });
  } else {
    const email = data.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      errors.push({ field: 'email', message: 'L\'email n\'est pas valide' });
    } else {
      validatedData.email = email;
    }
  }

  // Mot de passe (requis, force validée)
  if (!data.password || typeof data.password !== 'string') {
    errors.push({ field: 'password', message: 'Le mot de passe est obligatoire' });
  } else {
    const passwordValidation = validatePasswordStrength(data.password);
    if (!passwordValidation.valid) {
      passwordValidation.errors.forEach(msg => {
        errors.push({ field: 'password', message: msg });
      });
    }
  }

  // Rôle (optionnel, doit être valide si fourni)
  if (data.role !== undefined) {
    if (!VALID_ROLES.includes(data.role)) {
      errors.push({ field: 'role', message: 'Rôle invalide' });
    }
    // Pour l'inscription publique, on force le rôle client
    validatedData.role = 'client';
  } else {
    validatedData.role = 'client';
  }

  // Points de fidélité (optionnel, nombre positif)
  if (data.loyaltyPoints !== undefined) {
    const points = parseInt(data.loyaltyPoints);
    if (isNaN(points) || points < 0) {
      errors.push({ field: 'loyaltyPoints', message: 'Les points de fidélité doivent être un nombre positif' });
    } else {
      validatedData.loyaltyPoints = points;
    }
  } else {
    validatedData.loyaltyPoints = 0;
  }

  // isAdmin (déduit du rôle)
  validatedData.isAdmin = data.role === 'admin' || data.role === 'superadmin' || data.role === 'dev';

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide les données de connexion d'utilisateur
 */
const validateLogin = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Email (requis, valide)
  if (!data.email || typeof data.email !== 'string') {
    errors.push({ field: 'email', message: 'L\'email est obligatoire' });
  } else {
    const email = data.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      errors.push({ field: 'email', message: 'L\'email n\'est pas valide' });
    } else {
      validatedData.email = email;
    }
  }

  // Mot de passe (requis)
  if (!data.password || typeof data.password !== 'string') {
    errors.push({ field: 'password', message: 'Le mot de passe est obligatoire' });
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide les données de mise à jour de profil (champs optionnels)
 */
const validateUpdateProfile = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Nom (optionnel, 2-50 caractères si fourni)
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      errors.push({ field: 'name', message: 'Le nom doit être une chaîne de caractères' });
    } else {
      const name = data.name.trim();
      if (name.length < 2) {
        errors.push({ field: 'name', message: 'Le nom doit contenir au moins 2 caractères' });
      } else if (name.length > 50) {
        errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 50 caractères' });
      } else {
        validatedData.name = name;
      }
    }
  }

  // Email (optionnel, valide si fourni)
  if (data.email !== undefined) {
    if (typeof data.email !== 'string') {
      errors.push({ field: 'email', message: 'L\'email doit être une chaîne de caractères' });
    } else {
      const email = data.email.trim().toLowerCase();
      if (!isValidEmail(email)) {
        errors.push({ field: 'email', message: 'L\'email n\'est pas valide' });
      } else {
        validatedData.email = email;
      }
    }
  }

  // Mot de passe (optionnel, force validée si fourni)
  if (data.password !== undefined) {
    if (typeof data.password !== 'string') {
      errors.push({ field: 'password', message: 'Le mot de passe doit être une chaîne de caractères' });
    } else {
      const passwordValidation = validatePasswordStrength(data.password);
      if (!passwordValidation.valid) {
        passwordValidation.errors.forEach(msg => {
          errors.push({ field: 'password', message: msg });
        });
      }
    }
  }

  // Rôle (optionnel, doit être valide si fourni)
  if (data.role !== undefined) {
    if (!VALID_ROLES.includes(data.role)) {
      errors.push({ field: 'role', message: 'Rôle invalide' });
    }
  }

  // Points de fidélité (optionnel, nombre positif)
  if (data.loyaltyPoints !== undefined) {
    const points = parseInt(data.loyaltyPoints);
    if (isNaN(points) || points < 0) {
      errors.push({ field: 'loyaltyPoints', message: 'Les points de fidélité doivent être un nombre positif' });
    } else {
      validatedData.loyaltyPoints = points;
    }
  }

  // Mettre à jour isAdmin si le rôle change
  if (data.role !== undefined) {
    validatedData.isAdmin = data.role === 'admin' || data.role === 'superadmin' || data.role === 'dev';
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide la mise à jour par administrateur (inclut tous les champs)
 */
const validateAdminUpdate = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Tous les champs sont optionnels pour un admin, mais doivent être valides si fournis

  // Nom (optionnel, 2-50 caractères)
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      errors.push({ field: 'name', message: 'Le nom doit être une chaîne de caractères' });
    } else {
      const name = data.name.trim();
      if (name.length < 2) {
        errors.push({ field: 'name', message: 'Le nom doit contenir au moins 2 caractères' });
      } else if (name.length > 50) {
        errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 50 caractères' });
      } else {
        validatedData.name = name;
      }
    }
  }

  // Email (optionnel, valide)
  if (data.email !== undefined) {
    if (typeof data.email !== 'string') {
      errors.push({ field: 'email', message: 'L\'email doit être une chaîne de caractères' });
    } else {
      const email = data.email.trim().toLowerCase();
      if (!isValidEmail(email)) {
        errors.push({ field: 'email', message: 'L\'email n\'est pas valide' });
      } else {
        validatedData.email = email;
      }
    }
  }

  // Mot de passe (optionnel, force validée)
  if (data.password !== undefined) {
    if (typeof data.password !== 'string') {
      errors.push({ field: 'password', message: 'Le mot de passe doit être une chaîne de caractères' });
    } else {
      const passwordValidation = validatePasswordStrength(data.password);
      if (!passwordValidation.valid) {
        passwordValidation.errors.forEach(msg => {
          errors.push({ field: 'password', message: msg });
        });
      }
    }
  }

  // Rôle (optionnel, doit être valide)
  if (data.role !== undefined) {
    if (!VALID_ROLES.includes(data.role)) {
      errors.push({ field: 'role', message: 'Rôle invalide' });
    }
    // Mettre à jour isAdmin automatiquement
    validatedData.isAdmin = data.role === 'admin' || data.role === 'superadmin' || data.role === 'dev';
  }

  // Points de fidélité (optionnel, nombre positif)
  if (data.loyaltyPoints !== undefined) {
    const points = parseInt(data.loyaltyPoints);
    if (isNaN(points) || points < 0) {
      errors.push({ field: 'loyaltyPoints', message: 'Les points de fidélité doivent être un nombre positif' });
    } else {
      validatedData.loyaltyPoints = points;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Middleware pour valider l'inscription
 */
const validateRegisterMiddleware = (req, res, next) => {
  const validation = validateRegister(req.body);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Validation échouée',
      errors: validation.errors
    });
  }
  
  req.body = validation.data;
  next();
};

/**
 * Middleware pour valider la connexion
 */
const validateLoginMiddleware = (req, res, next) => {
  const validation = validateLogin(req.body);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Validation échouée',
      errors: validation.errors
    });
  }
  
  req.body = validation.data;
  next();
};

/**
 * Middleware pour valider la mise à jour de profil
 */
const validateUpdateProfileMiddleware = (req, res, next) => {
  const validation = validateUpdateProfile(req.body);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Validation échouée',
      errors: validation.errors
    });
  }
  
  req.body = validation.data;
  next();
};

/**
 * Middleware pour valider la mise à jour par admin
 */
const validateAdminUpdateMiddleware = (req, res, next) => {
  const validation = validateAdminUpdate(req.body);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Validation échouée',
      errors: validation.errors
    });
  }
  
  req.body = validation.data;
  next();
};

module.exports = {
  VALID_ROLES,
  isValidEmail,
  validatePasswordStrength,
  validateRegister,
  validateLogin,
  validateUpdateProfile,
  validateAdminUpdate,
  validateRegisterMiddleware,
  validateLoginMiddleware,
  validateUpdateProfileMiddleware,
  validateAdminUpdateMiddleware
};