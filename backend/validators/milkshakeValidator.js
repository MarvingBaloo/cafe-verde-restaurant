/**
 * @file Validateur pour les milkshakes.
 * Un milkshake porte ses catégories + ingrédients imbriqués (modèle "plat chaud").
 * Même style que dishValidator.js — sans dépendance Joi.
 */

const isValidUrl = (url) => {
  if (!url || url.trim() === '') return true;
  if (url.startsWith('/uploads/')) return true;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Valide et normalise le tableau categories[] imbriqué.
const validateCategories = (categories, errors) => {
  if (!Array.isArray(categories)) {
    errors.push({ field: 'categories', message: 'categories doit être un tableau' });
    return [];
  }
  return categories.map((cat, ci) => {
    const name = typeof cat?.name === 'string' ? cat.name.trim() : '';
    if (name.length < 1) errors.push({ field: `categories[${ci}].name`, message: 'Chaque catégorie doit avoir un nom' });
    else if (name.length > 60) errors.push({ field: `categories[${ci}].name`, message: 'Nom de catégorie trop long (max 60)' });

    const rawIngredients = Array.isArray(cat?.ingredients) ? cat.ingredients : [];
    const ingredients = rawIngredients.map((ing, ii) => {
      const iname = typeof ing?.name === 'string' ? ing.name.trim() : '';
      if (iname.length < 1) errors.push({ field: `categories[${ci}].ingredients[${ii}].name`, message: 'Chaque ingrédient doit avoir un nom' });
      else if (iname.length > 80) errors.push({ field: `categories[${ci}].ingredients[${ii}].name`, message: 'Nom d\'ingrédient trop long (max 80)' });

      let supplementPrice = 0;
      if (ing?.supplementPrice !== undefined) {
        const p = parseFloat(ing.supplementPrice);
        if (isNaN(p) || p < 0 || p > 100) errors.push({ field: `categories[${ci}].ingredients[${ii}].supplementPrice`, message: 'Le supplément doit être entre 0 et 100' });
        else supplementPrice = p;
      }
      return {
        name: iname,
        enabled: ing?.enabled !== false,
        isSupplement: !!ing?.isSupplement,
        supplementPrice: ing?.isSupplement ? supplementPrice : 0,
      };
    });

    return { name, enabled: cat?.enabled !== false, ingredients };
  });
};

const validateMilkshake = (data, { partial = false } = {}) => {
  const errors = [];
  const validatedData = { ...data };

  if (!partial || data.name !== undefined) {
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length < 2) {
      errors.push({ field: 'name', message: 'Le nom est obligatoire (min 2 caractères)' });
    } else if (data.name.trim().length > 120) {
      errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 120 caractères' });
    } else {
      validatedData.name = data.name.trim();
    }
  }

  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') {
      errors.push({ field: 'description', message: 'La description doit être une chaîne' });
    } else if (data.description.length > 1000) {
      errors.push({ field: 'description', message: 'La description ne peut pas dépasser 1000 caractères' });
    } else {
      validatedData.description = data.description.trim();
    }
  }

  if (!partial || data.price !== undefined) {
    const price = parseFloat(data.price);
    if (data.price === undefined || data.price === null || isNaN(price) || price < 0) {
      errors.push({ field: 'price', message: 'Le prix est obligatoire et doit être un nombre positif' });
    } else {
      validatedData.price = price;
    }
  }

  if (data.image !== undefined && data.image !== null && data.image !== '' && !isValidUrl(data.image)) {
    errors.push({ field: 'image', message: "L'image doit être une URL valide" });
  }

  if (data.categories !== undefined) {
    validatedData.categories = validateCategories(data.categories, errors);
  }

  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'isAvailable doit être un booléen' });
  }

  // categoryId : catégorie de classement TVA (id productCategories | null). '' / null = non classé.
  if (data.categoryId !== undefined) {
    validatedData.categoryId = (data.categoryId === null || data.categoryId === '') ? null : String(data.categoryId);
  }

  return { valid: errors.length === 0, errors, data: validatedData };
};

const makeMiddleware = (opts) => (req, res, next) => {
  const validation = validateMilkshake(req.body, opts);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: 'Validation échouée', errors: validation.errors });
  }
  req.body = validation.data;
  next();
};

module.exports = {
  validateMilkshake,
  validateCreateMilkshakeMiddleware: makeMiddleware(),
  validateUpdateMilkshakeMiddleware: makeMiddleware({ partial: true }),
};
