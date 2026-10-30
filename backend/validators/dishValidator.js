/**
 * @file Validateur pour les données de plats (Dish)
 * Même style que ingredientValidator.js — sans dépendance Joi
 */

const VALID_CATEGORIES = ['hot_dish', 'breakfast', 'snack'];

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

const validateCreateDish = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // name — requis, 2-120 caractères
  if (!data.name || typeof data.name !== 'string') {
    errors.push({ field: 'name', message: 'Le nom est obligatoire' });
  } else {
    const name = data.name.trim();
    if (name.length < 2) {
      errors.push({ field: 'name', message: 'Le nom doit contenir au moins 2 caractères' });
    } else if (name.length > 120) {
      errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 120 caractères' });
    } else {
      validatedData.name = name;
    }
  }

  // description — optionnel, max 1000 caractères
  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') {
      errors.push({ field: 'description', message: 'La description doit être une chaîne de caractères' });
    } else if (data.description.length > 1000) {
      errors.push({ field: 'description', message: 'La description ne peut pas dépasser 1000 caractères' });
    } else {
      validatedData.description = data.description.trim();
    }
  }

  // price — requis, nombre positif
  const price = parseFloat(data.price);
  if (data.price === undefined || data.price === null || isNaN(price) || price < 0) {
    errors.push({ field: 'price', message: 'Le prix est obligatoire et doit être un nombre positif' });
  } else {
    validatedData.price = price;
  }

  // image — optionnel, URL valide ou chemin /uploads/
  if (data.image !== undefined && data.image !== null && data.image !== '') {
    if (!isValidUrl(data.image)) {
      errors.push({ field: 'image', message: "L'image doit être une URL valide" });
    }
  }

  // category — optionnel, dans VALID_CATEGORIES
  if (data.category !== undefined) {
    if (!VALID_CATEGORIES.includes(data.category)) {
      errors.push({ field: 'category', message: `Catégorie invalide. Valeurs acceptées : ${VALID_CATEGORIES.join(', ')}` });
    }
  }

  // sides — optionnel, tableau d'objets {name, priceAddition}
  if (data.sides !== undefined) {
    if (!Array.isArray(data.sides)) {
      errors.push({ field: 'sides', message: 'Les accompagnements doivent être un tableau' });
    } else {
      data.sides.forEach((side, i) => {
        if (!side.name || typeof side.name !== 'string' || side.name.trim().length === 0) {
          errors.push({ field: `sides[${i}].name`, message: "Chaque accompagnement doit avoir un nom" });
        } else if (side.name.length > 80) {
          errors.push({ field: `sides[${i}].name`, message: "Le nom d'un accompagnement ne peut pas dépasser 80 caractères" });
        }
        if (side.priceAddition !== undefined) {
          const pa = parseFloat(side.priceAddition);
          if (isNaN(pa) || pa < 0 || pa > 100) {
            errors.push({ field: `sides[${i}].priceAddition`, message: 'Le supplément de prix doit être entre 0 et 100' });
          }
        }
      });
    }
  }

  // maxSides — optionnel, entier entre 0 et 10
  if (data.maxSides !== undefined) {
    const ms = parseInt(data.maxSides, 10);
    if (isNaN(ms) || ms < 0 || ms > 10) {
      errors.push({ field: 'maxSides', message: 'maxSides doit être un entier entre 0 et 10' });
    } else {
      validatedData.maxSides = ms;
    }
  }

  // dietaryTags — optionnel, tableau de strings (max 30 chars chacun)
  if (data.dietaryTags !== undefined) {
    if (!Array.isArray(data.dietaryTags)) {
      errors.push({ field: 'dietaryTags', message: 'dietaryTags doit être un tableau' });
    } else {
      const invalid = data.dietaryTags.filter(t => typeof t !== 'string' || t.length > 30);
      if (invalid.length > 0) {
        errors.push({ field: 'dietaryTags', message: 'Chaque tag ne peut pas dépasser 30 caractères' });
      } else {
        validatedData.dietaryTags = data.dietaryTags;
      }
    }
  }

  // isAvailable — optionnel, booléen
  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'isAvailable doit être un booléen' });
  }

  return { valid: errors.length === 0, errors, data: validatedData };
};

const validateUpdateDish = (data) => {
  const errors = [];
  const validatedData = { ...data };

  if (data.name !== undefined) {
    if (typeof data.name !== 'string') {
      errors.push({ field: 'name', message: 'Le nom doit être une chaîne de caractères' });
    } else {
      const name = data.name.trim();
      if (name.length < 2) {
        errors.push({ field: 'name', message: 'Le nom doit contenir au moins 2 caractères' });
      } else if (name.length > 120) {
        errors.push({ field: 'name', message: 'Le nom ne peut pas dépasser 120 caractères' });
      } else {
        validatedData.name = name;
      }
    }
  }

  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') {
      errors.push({ field: 'description', message: 'La description doit être une chaîne de caractères' });
    } else if (data.description.length > 1000) {
      errors.push({ field: 'description', message: 'La description ne peut pas dépasser 1000 caractères' });
    } else {
      validatedData.description = data.description.trim();
    }
  }

  if (data.price !== undefined) {
    const price = parseFloat(data.price);
    if (isNaN(price) || price < 0) {
      errors.push({ field: 'price', message: 'Le prix doit être un nombre positif' });
    } else {
      validatedData.price = price;
    }
  }

  if (data.image !== undefined && data.image !== null && data.image !== '') {
    if (!isValidUrl(data.image)) {
      errors.push({ field: 'image', message: "L'image doit être une URL valide" });
    }
  }

  if (data.category !== undefined) {
    if (!VALID_CATEGORIES.includes(data.category)) {
      errors.push({ field: 'category', message: `Catégorie invalide. Valeurs acceptées : ${VALID_CATEGORIES.join(', ')}` });
    }
  }

  if (data.sides !== undefined) {
    if (!Array.isArray(data.sides)) {
      errors.push({ field: 'sides', message: 'Les accompagnements doivent être un tableau' });
    } else {
      data.sides.forEach((side, i) => {
        if (!side.name || typeof side.name !== 'string' || side.name.trim().length === 0) {
          errors.push({ field: `sides[${i}].name`, message: "Chaque accompagnement doit avoir un nom" });
        } else if (side.name.length > 80) {
          errors.push({ field: `sides[${i}].name`, message: "Le nom d'un accompagnement ne peut pas dépasser 80 caractères" });
        }
        if (side.priceAddition !== undefined) {
          const pa = parseFloat(side.priceAddition);
          if (isNaN(pa) || pa < 0 || pa > 100) {
            errors.push({ field: `sides[${i}].priceAddition`, message: 'Le supplément de prix doit être entre 0 et 100' });
          }
        }
      });
    }
  }

  if (data.maxSides !== undefined) {
    const ms = parseInt(data.maxSides, 10);
    if (isNaN(ms) || ms < 0 || ms > 10) {
      errors.push({ field: 'maxSides', message: 'maxSides doit être un entier entre 0 et 10' });
    } else {
      validatedData.maxSides = ms;
    }
  }

  if (data.dietaryTags !== undefined) {
    if (!Array.isArray(data.dietaryTags)) {
      errors.push({ field: 'dietaryTags', message: 'dietaryTags doit être un tableau' });
    } else {
      const invalid = data.dietaryTags.filter(t => typeof t !== 'string' || t.length > 30);
      if (invalid.length > 0) {
        errors.push({ field: 'dietaryTags', message: 'Chaque tag ne peut pas dépasser 30 caractères' });
      } else {
        validatedData.dietaryTags = data.dietaryTags;
      }
    }
  }

  if (data.isAvailable !== undefined && typeof data.isAvailable !== 'boolean') {
    errors.push({ field: 'isAvailable', message: 'isAvailable doit être un booléen' });
  }

  return { valid: errors.length === 0, errors, data: validatedData };
};

const validateCreateDishMiddleware = (req, res, next) => {
  const validation = validateCreateDish(req.body);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: 'Validation échouée', errors: validation.errors });
  }
  req.body = validation.data;
  next();
};

const validateUpdateDishMiddleware = (req, res, next) => {
  const validation = validateUpdateDish(req.body);
  if (!validation.valid) {
    return res.status(400).json({ success: false, message: 'Validation échouée', errors: validation.errors });
  }
  req.body = validation.data;
  next();
};

module.exports = {
  VALID_CATEGORIES,
  validateCreateDish,
  validateUpdateDish,
  validateCreateDishMiddleware,
  validateUpdateDishMiddleware
};
