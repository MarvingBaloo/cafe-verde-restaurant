/**
 * @file Validateur pour les données de formules
 * Fournit des fonctions de validation réutilisables pour les routes de formules
 * (Version simplifiée sans dépendance externe)
 */

/**
 * Types de formule valides
 */
const VALID_TYPES = ['salad'];

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
 * Valide les limites d'une formule
 */
const validateLimits = (limits) => {
  if (!limits || typeof limits !== 'object') {
    return { valid: false, errors: ['Les limites doivent être un objet'] };
  }

  const validFields = ['base', 'protein', 'topping', 'sauce'];

  const errors = [];

  validFields.forEach(field => {
    const value = limits[field];
    if (value !== undefined && (typeof value !== 'number' || value < 0)) {
      errors.push(`Le champ limite "${field}" doit être un nombre positif ou zéro`);
    }
  });

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Valide les données de création de formule
 */
const validateCreateFormula = (data) => {
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

  // Type (requis, doit être valide)
  if (!data.type || typeof data.type !== 'string') {
    errors.push({ field: 'type', message: 'Le type est obligatoire' });
  } else if (!VALID_TYPES.includes(data.type)) {
    errors.push({ field: 'type', message: 'Type invalide' });
  }

  // Prix de base (requis, nombre positif)
  const basePrice = parseFloat(data.base_price);
  if (isNaN(basePrice) || basePrice <= 0) {
    errors.push({ field: 'base_price', message: 'Le prix de base doit être un nombre positif' });
  } else if (basePrice > 1000) {
    errors.push({ field: 'base_price', message: 'Le prix de base ne peut pas dépasser 1000€' });
  } else {
    validatedData.base_price = basePrice;
  }

  // Image (URL valide si fournie)
  if (data.image !== undefined && data.image !== null && data.image !== '') {
    if (!isValidUrl(data.image)) {
      errors.push({ field: 'image', message: 'L\'image doit être une URL valide' });
    }
  }

  // Disponibilité (booléen)
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'La disponibilité doit être un booléen' });
  } else {
    validatedData.isAvailable = data.isAvailable !== false;
  }

  // Limites (optionnel, validation spécifique)
  if (data.limits !== undefined) {
    const limitsValidation = validateLimits(data.limits);
    if (!limitsValidation.valid) {
      limitsValidation.errors.forEach(msg => {
        errors.push({ field: 'limits', message: msg });
      });
    }
  } else {
    validatedData.limits = {
      base: 0, protein: 0, topping: 0, sauce: 0
    };
  }

  // Coût par extra (requis, nombre positif)
  const extraCost = parseFloat(data.extra_cost_per_component);
  if (isNaN(extraCost) || extraCost < 0) {
    validatedData.extra_cost_per_component = 0;
  } else if (extraCost > 100) {
    errors.push({ field: 'extra_cost_per_component', message: 'Le coût par extra ne peut pas dépasser 100€' });
  } else {
    validatedData.extra_cost_per_component = extraCost;
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide les données de mise à jour de formule (champs optionnels)
 */
const validateUpdateFormula = (data) => {
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

  // Type (optionnel, doit être valide si fourni)
  if (data.type !== undefined) {
    if (!VALID_TYPES.includes(data.type)) {
      errors.push({ field: 'type', message: 'Type invalide' });
    }
  }

  // Prix de base (optionnel, nombre positif)
  if (data.base_price !== undefined) {
    const basePrice = parseFloat(data.base_price);
    if (isNaN(basePrice) || basePrice <= 0) {
      errors.push({ field: 'base_price', message: 'Le prix de base doit être un nombre positif' });
    } else if (basePrice > 1000) {
      errors.push({ field: 'base_price', message: 'Le prix de base ne peut pas dépasser 1000€' });
    } else {
      validatedData.base_price = basePrice;
    }
  }

  // Image (optionnel, URL valide si fournie)
  if (data.image !== undefined) {
    if (data.image !== null && data.image !== '' && !isValidUrl(data.image)) {
      errors.push({ field: 'image', message: 'L\'image doit être une URL valide' });
    }
  }

  // Disponibilité (optionnel, booléen)
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'La disponibilité doit être un booléen' });
  }

  // Limites (optionnel, validation spécifique)
  if (data.limits !== undefined) {
    const limitsValidation = validateLimits(data.limits);
    if (!limitsValidation.valid) {
      limitsValidation.errors.forEach(msg => {
        errors.push({ field: 'limits', message: msg });
      });
    }
  }

  // Coût par extra (optionnel, nombre positif)
  if (data.extra_cost_per_component !== undefined) {
    const extraCost = parseFloat(data.extra_cost_per_component);
    if (isNaN(extraCost) || extraCost < 0) {
      errors.push({ field: 'extra_cost_per_component', message: 'Le coût par extra doit être un nombre positif ou zéro' });
    } else if (extraCost > 100) {
      errors.push({ field: 'extra_cost_per_component', message: 'Le coût par extra ne peut pas dépasser 100€' });
    } else {
      validatedData.extra_cost_per_component = extraCost;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Middleware pour valider la création de formule
 */
const validateCreateFormulaMiddleware = (req, res, next) => {
  const validation = validateCreateFormula(req.body);
  
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
 * Middleware pour valider la mise à jour de formule
 */
const validateUpdateFormulaMiddleware = (req, res, next) => {
  const validation = validateUpdateFormula(req.body);
  
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
  VALID_TYPES,
  validateCreateFormula,
  validateUpdateFormula,
  validateCreateFormulaMiddleware,
  validateUpdateFormulaMiddleware
};