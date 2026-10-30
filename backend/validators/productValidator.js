/**
 * @file Validateur pour les données de produits
 * Fournit des fonctions de validation réutilisables pour les routes de produits
 * (Version simplifiée sans dépendance externe)
 */

/**
 * Catégories de produits valides
 */
const VALID_CATEGORIES = ['drink', 'coffee', 'dessert', 'side'];

/**
 * Valide une URL (simplifiée)
 */
const isValidUrl = (url) => {
  if (!url || url.trim() === '') return true; // URL vide autorisée
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Valide les informations nutritionnelles
 */
const validateNutritionalInfo = (info) => {
  if (!info || typeof info !== 'object') {
    return { valid: false, errors: ['Les informations nutritionnelles doivent être un objet'] };
  }

  const errors = [];
  const fields = ['calories', 'proteins', 'carbs', 'fat'];
  
  fields.forEach(field => {
    const value = info[field];
    if (value !== undefined && (typeof value !== 'number' || value < 0)) {
      errors.push(`Le champ ${field} doit être un nombre positif ou zéro`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Valide la liste des suppléments / extras d'un produit.
 * Chaque extra : { id?, name (2-60 car.), price (>= 0) }.
 * Retourne le tableau normalisé (ids générés si absents) ou des erreurs.
 */
const validateExtras = (extras) => {
  if (!Array.isArray(extras)) {
    return { valid: false, errors: ['Les extras doivent être un tableau'], extras: [] };
  }
  const errors = [];
  const normalized = extras.map((extra, i) => {
    const name = typeof extra?.name === 'string' ? extra.name.trim() : '';
    const price = parseFloat(extra?.price);
    if (name.length < 2 || name.length > 60) {
      errors.push(`Extra #${i + 1} : le nom doit contenir entre 2 et 60 caractères`);
    }
    if (isNaN(price) || price < 0) {
      errors.push(`Extra #${i + 1} : le prix doit être un nombre positif ou zéro`);
    }
    return {
      id: extra?.id || `extra-${Date.now()}-${i}`,
      name,
      price: isNaN(price) || price < 0 ? 0 : price,
    };
  });
  return { valid: errors.length === 0, errors, extras: normalized };
};

/**
 * Valide les données de création de produit
 */
const validateCreateProduct = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Nom (requis, 2-100 caractères)
  if (!data.name || typeof data.name !== 'string') {
    errors.push({ field: 'name', message: 'Le nom est obligatoire' });
  } else {
    const name = data.name.trim();
    if (name.length < 2) {
      errors.push({ field: 'name', message: 'Le nom doit contenir au moins 2 caractères' });
    } else if (name.length > 100) {
      errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 100 caractères' });
    } else {
      validatedData.name = name;
    }
  }

  // Catégorie (requis, doit être valide)
  if (!data.category || typeof data.category !== 'string') {
    errors.push({ field: 'category', message: 'La catégorie est obligatoire' });
  } else if (!VALID_CATEGORIES.includes(data.category)) {
    errors.push({ field: 'category', message: 'Catégorie invalide' });
  }

  // categoryId (optionnel, string | null) — rattachement à l'arbre de catégories ; null = non classé
  if (data.categoryId !== undefined) {
    if (data.categoryId !== null && typeof data.categoryId !== 'string') {
      errors.push({ field: 'categoryId', message: 'categoryId doit être une chaîne ou null' });
    } else {
      const v = typeof data.categoryId === 'string' ? data.categoryId.trim() : null;
      validatedData.categoryId = v || null;
    }
  }

  // Image (URL valide si fournie)
  if (data.image !== undefined && data.image !== null && data.image !== '') {
    if (!isValidUrl(data.image)) {
      errors.push({ field: 'image', message: 'L\'image doit être une URL valide' });
    }
  }

  // Prix (requis, nombre positif)
  const price = parseFloat(data.price);
  if (isNaN(price) || price <= 0) {
    errors.push({ field: 'price', message: 'Le prix doit être un nombre positif' });
  } else if (price > 1000) {
    errors.push({ field: 'price', message: 'Le prix ne peut pas dépasser 1000€' });
  } else {
    validatedData.price = price;
  }

  // Surcharge menu (optionnel, nombre positif)
  if (data.menu_surcharge !== undefined) {
    const surcharge = parseFloat(data.menu_surcharge);
    if (isNaN(surcharge) || surcharge < 0) {
      validatedData.menu_surcharge = 0;
    } else if (surcharge > 100) {
      errors.push({ field: 'menu_surcharge', message: 'La surcharge menu ne peut pas dépasser 100€' });
    } else {
      validatedData.menu_surcharge = surcharge;
    }
  } else {
    validatedData.menu_surcharge = 0;
  }

  // Disponibilité (booléen)
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'La disponibilité doit être un booléen' });
  } else {
    validatedData.isAvailable = data.isAvailable !== false;
  }

  // Informations nutritionnelles
  if (data.nutritional_info !== undefined) {
    const nutritionValidation = validateNutritionalInfo(data.nutritional_info);
    if (!nutritionValidation.valid) {
      nutritionValidation.errors.forEach(msg => {
        errors.push({ field: 'nutritional_info', message: msg });
      });
    }
  } else {
    validatedData.nutritional_info = {
      calories: 0,
      proteins: 0,
      carbs: 0,
      fat: 0
    };
  }

  // Suppléments / extras (optionnel, facultatifs côté client)
  if (data.extras !== undefined) {
    const extrasValidation = validateExtras(data.extras);
    if (!extrasValidation.valid) {
      extrasValidation.errors.forEach(msg => errors.push({ field: 'extras', message: msg }));
    } else {
      validatedData.extras = extrasValidation.extras;
    }
  } else {
    validatedData.extras = [];
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide les données de mise à jour de produit (champs optionnels)
 */
const validateUpdateProduct = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Nom (optionnel, 2-100 caractères si fourni)
  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      errors.push({ field: 'name', message: 'Le nom doit être une chaîne de caractères' });
    } else {
      const name = data.name.trim();
      if (name.length < 2) {
        errors.push({ field: 'name', message: 'Le nom doit contenir au moins 2 caractères' });
      } else if (name.length > 100) {
        errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 100 caractères' });
      } else {
        validatedData.name = name;
      }
    }
  }

  // Catégorie (optionnel, doit être valide si fournie)
  if (data.category !== undefined) {
    if (!VALID_CATEGORIES.includes(data.category)) {
      errors.push({ field: 'category', message: 'Catégorie invalide' });
    }
  }

  // categoryId (optionnel, string | null) — rattachement à l'arbre de catégories ; null = non classé
  if (data.categoryId !== undefined) {
    if (data.categoryId !== null && typeof data.categoryId !== 'string') {
      errors.push({ field: 'categoryId', message: 'categoryId doit être une chaîne ou null' });
    } else {
      const v = typeof data.categoryId === 'string' ? data.categoryId.trim() : null;
      validatedData.categoryId = v || null;
    }
  }

  // Image (optionnel, URL valide si fournie)
  if (data.image !== undefined) {
    if (data.image !== null && data.image !== '' && !isValidUrl(data.image)) {
      errors.push({ field: 'image', message: 'L\'image doit être une URL valide' });
    }
  }

  // Prix (optionnel, nombre positif)
  if (data.price !== undefined) {
    const price = parseFloat(data.price);
    if (isNaN(price) || price <= 0) {
      errors.push({ field: 'price', message: 'Le prix doit être un nombre positif' });
    } else if (price > 1000) {
      errors.push({ field: 'price', message: 'Le prix ne peut pas dépasser 1000€' });
    } else {
      validatedData.price = price;
    }
  }

  // Surcharge menu (optionnel, nombre positif)
  if (data.menu_surcharge !== undefined) {
    const surcharge = parseFloat(data.menu_surcharge);
    if (isNaN(surcharge) || surcharge < 0) {
      errors.push({ field: 'menu_surcharge', message: 'La surcharge menu ne peut pas être négative' });
    } else if (surcharge > 100) {
      errors.push({ field: 'menu_surcharge', message: 'La surcharge menu ne peut pas dépasser 100€' });
    } else {
      validatedData.menu_surcharge = surcharge;
    }
  }

  // Disponibilité (optionnel, booléen)
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'La disponibilité doit être un booléen' });
  }

  // Informations nutritionnelles (optionnel)
  if (data.nutritional_info !== undefined) {
    const nutritionValidation = validateNutritionalInfo(data.nutritional_info);
    if (!nutritionValidation.valid) {
      nutritionValidation.errors.forEach(msg => {
        errors.push({ field: 'nutritional_info', message: msg });
      });
    }
  }

  // Suppléments / extras (optionnel)
  if (data.extras !== undefined) {
    const extrasValidation = validateExtras(data.extras);
    if (!extrasValidation.valid) {
      extrasValidation.errors.forEach(msg => errors.push({ field: 'extras', message: msg }));
    } else {
      validatedData.extras = extrasValidation.extras;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Middleware pour valider la création de produit
 */
const validateCreateProductMiddleware = (req, res, next) => {
  const validation = validateCreateProduct(req.body);
  
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
 * Middleware pour valider la mise à jour de produit
 */
const validateUpdateProductMiddleware = (req, res, next) => {
  const validation = validateUpdateProduct(req.body);
  
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
  VALID_CATEGORIES,
  validateCreateProduct,
  validateUpdateProduct,
  validateCreateProductMiddleware,
  validateUpdateProductMiddleware
};