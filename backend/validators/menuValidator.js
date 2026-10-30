/**
 * @file Validateur pour les données de menus
 * Fournit des fonctions de validation réutilisables pour les routes de menus
 * (Version simplifiée sans dépendance externe)
 */

/**
 * Valide les données de création de menu
 */
const validateCreateMenu = (data) => {
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

  // Prix additionnel (requis, nombre positif)
  const priceAddition = parseFloat(data.price_addition);
  if (isNaN(priceAddition) || priceAddition < 0) {
    errors.push({ field: 'price_addition', message: 'Le prix additionnel doit être un nombre positif ou zéro' });
  } else if (priceAddition > 1000) {
    errors.push({ field: 'price_addition', message: 'Le prix additionnel ne peut pas dépasser 1000€' });
  } else {
    validatedData.price_addition = priceAddition;
  }

  // Disponibilité (booléen)
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'La disponibilité doit être un booléen' });
  } else {
    validatedData.isAvailable = data.isAvailable !== false;
  }

  // Inclusions (optionnel, objet avec booléens)
  if (data.includes !== undefined) {
    if (typeof data.includes !== 'object') {
      errors.push({ field: 'includes', message: 'Les inclusions doivent être un objet' });
    } else {
      validatedData.includes = {
        drink: Boolean(data.includes.drink || false),
        dessert: Boolean(data.includes.dessert || false),
        side: Boolean(data.includes.side || false)
      };
    }
  } else {
    validatedData.includes = {
      drink: false,
      dessert: false,
      side: false
    };
  }

  // Produits autorisés (optionnel, tableau d'IDs)
  validatedData.allowedProductIds = Array.isArray(data.allowedProductIds)
    ? data.allowedProductIds.filter(id => typeof id === 'string')
    : [];

  // Mode de sélection des produits inclus : 'or' (boisson OU dessert) ou 'and' (boisson ET dessert)
  validatedData.selectionMode = data.selectionMode === 'or' ? 'or' : 'and';

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide les données de mise à jour de menu (champs optionnels)
 */
const validateUpdateMenu = (data) => {
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

  // Prix additionnel (optionnel, nombre positif)
  if (data.price_addition !== undefined) {
    const priceAddition = parseFloat(data.price_addition);
    if (isNaN(priceAddition) || priceAddition < 0) {
      errors.push({ field: 'price_addition', message: 'Le prix additionnel doit être un nombre positif ou zéro' });
    } else if (priceAddition > 1000) {
      errors.push({ field: 'price_addition', message: 'Le prix additionnel ne peut pas dépasser 1000€' });
    } else {
      validatedData.price_addition = priceAddition;
    }
  }

  // Disponibilité (optionnel, booléen)
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'La disponibilité doit être un booléen' });
  }

  // Inclusions (optionnel, objet avec booléens)
  if (data.includes !== undefined) {
    if (typeof data.includes !== 'object') {
      errors.push({ field: 'includes', message: 'Les inclusions doivent être un objet' });
    } else {
      validatedData.includes = {
        drink: Boolean(data.includes.drink || false),
        dessert: Boolean(data.includes.dessert || false),
        side: Boolean(data.includes.side || false)
      };
    }
  }

  // Produits autorisés (optionnel — uniquement si fourni, sinon update partiel ne touche pas au champ)
  if (data.allowedProductIds !== undefined) {
    validatedData.allowedProductIds = Array.isArray(data.allowedProductIds)
      ? data.allowedProductIds.filter(id => typeof id === 'string')
      : [];
  }

  // Mode de sélection (optionnel — uniquement si fourni)
  if (data.selectionMode !== undefined) {
    validatedData.selectionMode = data.selectionMode === 'or' ? 'or' : 'and';
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Middleware pour valider la création de menu
 */
const validateCreateMenuMiddleware = (req, res, next) => {
  const validation = validateCreateMenu(req.body);
  
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
 * Middleware pour valider la mise à jour de menu
 */
const validateUpdateMenuMiddleware = (req, res, next) => {
  const validation = validateUpdateMenu(req.body);
  
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
  validateCreateMenu,
  validateUpdateMenu,
  validateCreateMenuMiddleware,
  validateUpdateMenuMiddleware
};