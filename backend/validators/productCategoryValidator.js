/**
 * @file Validateur pour les catégories de produits (arbre).
 * Style aligné sur milkshakeValidator.js — sans dépendance Joi.
 */

const VALID_ROOT_CATEGORIES = ['drink', 'coffee', 'dessert', 'side'];

const validateProductCategory = (data, { partial = false } = {}) => {
  const errors = [];
  const validatedData = { ...data };

  // name (requis, 2-60)
  if (!partial || data.name !== undefined) {
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
      errors.push({ field: 'name', message: 'Le nom est obligatoire (min 2 caractères)' });
    } else if (data.name.trim().length > 60) {
      errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 60 caractères' });
    } else {
      validatedData.name = data.name.trim();
    }
  }

  // parentId (string | null)
  if (data.parentId !== undefined) {
    if (data.parentId !== null && typeof data.parentId !== 'string') {
      errors.push({ field: 'parentId', message: 'parentId doit être une chaîne ou null' });
    } else {
      validatedData.parentId = data.parentId || null;
    }
  }

  // rootCategory (requis à la création racine ; le controller le force pour les enfants)
  if (data.rootCategory !== undefined) {
    if (!VALID_ROOT_CATEGORIES.includes(data.rootCategory)) {
      errors.push({ field: 'rootCategory', message: 'rootCategory invalide' });
    } else {
      validatedData.rootCategory = data.rootCategory;
    }
  } else if (!partial && (data.parentId === undefined || data.parentId === null)) {
    // catégorie racine sans rootCategory
    errors.push({ field: 'rootCategory', message: 'rootCategory est obligatoire pour une catégorie racine' });
  }

  // order (number >= 0)
  if (data.order !== undefined) {
    const o = Number(data.order);
    if (isNaN(o) || o < 0) {
      errors.push({ field: 'order', message: 'order doit être un nombre >= 0' });
    } else {
      validatedData.order = o;
    }
  }

  // isAvailable (bool)
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'isAvailable doit être un booléen' });
  }

  // Taux de TVA par mode (number 0-100 | null | '') — null/'' = héritage du parent / taux par défaut du mode.
  // taxRate (legacy, unique) toujours accepté pour rétrocompat.
  for (const field of ['taxRate', 'taxRateDineIn', 'taxRateTakeaway']) {
    if (data[field] === undefined) continue;
    if (data[field] === null || data[field] === '') {
      validatedData[field] = null;
    } else {
      const t = Number(data[field]);
      if (!Number.isFinite(t) || t < 0 || t > 100) {
        errors.push({ field, message: `${field} doit être compris entre 0 et 100` });
      } else {
        validatedData[field] = t;
      }
    }
  }

  return { valid: errors.length === 0, errors, data: validatedData };
};

const makeMiddleware = (opts) => (req, res, next) => {
  const validation = validateProductCategory(req.body, opts);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: 'Validation échouée', errors: validation.errors });
  }
  req.body = validation.data;
  next();
};

module.exports = {
  VALID_ROOT_CATEGORIES,
  validateProductCategory,
  validateCreateProductCategoryMiddleware: makeMiddleware(),
  validateUpdateProductCategoryMiddleware: makeMiddleware({ partial: true }),
};
