/**
 * @file Validateur pour les données d'ingrédients
 * Fournit des fonctions de validation réutilisables pour les routes d'ingrédients
 * (Version simplifiée sans dépendance à Joi)
 */

/**
 * Catégories d'ingrédients valides
 */
const VALID_CATEGORIES = [
  'base_salade',
  'proteine',
  'topping_legume',
  'topping_fruit',
  'sauce'
];

/**
 * Valide une URL (simplifiée)
 */
const isValidUrl = (url) => {
  if (!url || url.trim() === "") return true;
  if (url.startsWith("/uploads/")) return true;
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
 * Valide les données de création d'ingrédient
 */
const validateCreateIngredient = (data) => {
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

  // Image (URL valide si fournie)
  if (data.image !== undefined && data.image !== null && data.image !== '') {
    if (!isValidUrl(data.image)) {
      errors.push({ field: 'image', message: 'L\'image doit être une URL valide' });
    }
  }

  // Premium (booléen)
  if (data.is_premium !== undefined && typeof data.is_premium !== 'boolean') {
    errors.push({ field: 'is_premium', message: 'Le champ premium doit être un booléen' });
  } else {
    validatedData.is_premium = Boolean(data.is_premium || false);
  }

  // Extra price (nombre positif)
  const extraPrice = parseFloat(data.extra_price);
  if (isNaN(extraPrice) || extraPrice < 0) {
    validatedData.extra_price = 0;
  } else if (extraPrice > 100) {
    errors.push({ field: 'extra_price', message: 'Le prix supplémentaire ne peut pas dépasser 100€' });
  } else {
    validatedData.extra_price = extraPrice;
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

  // Tags (tableau de chaînes)
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push({ field: 'tags', message: 'Les tags doivent être un tableau' });
    } else {
      const invalidTags = data.tags.filter(tag => typeof tag !== 'string' || tag.length > 20);
      if (invalidTags.length > 0) {
        errors.push({ field: 'tags', message: 'Un tag ne peut pas dépasser 20 caractères' });
      }
      validatedData.tags = data.tags.filter(tag => typeof tag === 'string' && tag.length <= 20);
    }
  } else {
    validatedData.tags = [];
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide les données de mise à jour d'ingrédient (champs optionnels)
 */
const validateUpdateIngredient = (data) => {
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

  // Image (optionnel, URL valide si fournie)
  if (data.image !== undefined) {
    if (data.image !== null && data.image !== '' && !isValidUrl(data.image)) {
      errors.push({ field: 'image', message: 'L\'image doit être une URL valide' });
    }
  }

  // Premium (optionnel, booléen)
  if (data.is_premium !== undefined && typeof data.is_premium !== 'boolean') {
    errors.push({ field: 'is_premium', message: 'Le champ premium doit être un booléen' });
  }

  // Extra price (optionnel, nombre positif)
  if (data.extra_price !== undefined) {
    const extraPrice = parseFloat(data.extra_price);
    if (isNaN(extraPrice) || extraPrice < 0) {
      errors.push({ field: 'extra_price', message: 'Le prix supplémentaire ne peut pas être négatif' });
    } else if (extraPrice > 100) {
      errors.push({ field: 'extra_price', message: 'Le prix supplémentaire ne peut pas dépasser 100€' });
    } else {
      validatedData.extra_price = extraPrice;
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

  // Tags (optionnel, tableau de chaînes)
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) {
      errors.push({ field: 'tags', message: 'Les tags doivent être un tableau' });
    } else {
      const invalidTags = data.tags.filter(tag => typeof tag !== 'string' || tag.length > 20);
      if (invalidTags.length > 0) {
        errors.push({ field: 'tags', message: 'Un tag ne peut pas dépasser 20 caractères' });
      }
      validatedData.tags = data.tags.filter(tag => typeof tag === 'string' && tag.length <= 20);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Middleware pour valider la création d'ingrédient
 */
const validateCreateIngredientMiddleware = (req, res, next) => {
  const validation = validateCreateIngredient(req.body);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Validation échouée',
      errors: validation.errors
    });
  }
  
  // Remplacer les données validées
  req.body = validation.data;
  next();
};

/**
 * Middleware pour valider la mise à jour d'ingrédient
 */
const validateUpdateIngredientMiddleware = (req, res, next) => {
  const validation = validateUpdateIngredient(req.body);
  
  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Validation échouée',
      errors: validation.errors
    });
  }
  
  // Remplacer les données validées
  req.body = validation.data;
  next();
};

module.exports = {
  VALID_CATEGORIES,
  validateCreateIngredient,
  validateUpdateIngredient,
  validateCreateIngredientMiddleware,
  validateUpdateIngredientMiddleware
};
