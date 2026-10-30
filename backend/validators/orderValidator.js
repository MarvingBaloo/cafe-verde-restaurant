/**
 * @file Validateur pour les données de commandes
 * Fournit des fonctions de validation réutilisables pour les routes de commandes
 * (Version simplifiée sans dépendance externe)
 */

/**
 * Statuts de commande valides
 */
// ⚠️ Liste DUPLIQUÉE dans models/Order.js — toute modification va aux deux endroits.
const VALID_STATUSES = ['open', 'scheduled', 'pending', 'preparing', 'ready', 'delivered', 'cancelled'];

/**
 * Nature d'une annulation — ce qu'il reste à faire, pas d'où vient l'annulation.
 * Se calcule à partir de l'état des encaissements, il ne se choisit pas.
 */
const VALID_CANCEL_TYPES = [
  'no_payment',   // rien n'a été encaissé → rien à faire
  'refund_due',   // un ou plusieurs règlements encaissés → client à rembourser
  'interrupted',  // annulée alors qu'un paiement était en cours → vérifier que rien n'est passé
];

/**
 * Valide les données de création de commande
 */
const validateCreateOrder = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Nom du client (requis, 2-100 caractères)
  if (!data.customerName || typeof data.customerName !== 'string') {
    errors.push({ field: 'customerName', message: 'Le nom du client est obligatoire' });
  } else {
    const customerName = data.customerName.trim();
    if (customerName.length < 2) {
      errors.push({ field: 'customerName', message: 'Le nom du client doit contenir au moins 2 caractères' });
    } else if (customerName.length > 100) {
      errors.push({ field: 'customerName', message: 'Le nom du client ne peut pas dépasser 100 caractères' });
    } else {
      validatedData.customerName = customerName;
    }
  }

  // Prix total : requis et positif — SAUF pour un ticket 'open' (en attente, peut être encore vide → 0).
  const isOpenTicket = data.status === 'open';
  const totalPrice = parseFloat(data.totalPrice);
  if (isOpenTicket) {
    validatedData.totalPrice = (!isNaN(totalPrice) && totalPrice > 0) ? totalPrice : 0;
  } else if (isNaN(totalPrice) || totalPrice <= 0) {
    errors.push({ field: 'totalPrice', message: 'Le prix total doit être un nombre positif' });
  } else if (totalPrice > 10000) {
    errors.push({ field: 'totalPrice', message: 'Le prix total ne peut pas dépasser 10 000€' });
  } else {
    validatedData.totalPrice = totalPrice;
  }

  // Statut (optionnel, doit être valide si fourni)
  if (data.status !== undefined) {
    if (!VALID_STATUSES.includes(data.status)) {
      errors.push({ field: 'status', message: 'Statut invalide' });
    }
  } else {
    validatedData.status = 'pending';
  }

  // Traçabilité d'une annulation. Le validateur reconstruit l'objet champ par champ :
  // sans ces lignes, les champs seraient silencieusement jetés.
  if (data.cancelType !== undefined && data.cancelType !== null) {
    if (!VALID_CANCEL_TYPES.includes(data.cancelType)) {
      errors.push({ field: 'cancelType', message: "Type d'annulation invalide" });
    } else {
      validatedData.cancelType = data.cancelType;
    }
  }
  if (typeof data.cancelReason === 'string' && data.cancelReason.trim()) {
    validatedData.cancelReason = data.cancelReason.trim().slice(0, 300);
  }
  // Montant réellement encaissé au moment de l'annulation = ce qu'il faut rendre au client.
  const cancelledAmount = parseFloat(data.cancelledAmount);
  if (!isNaN(cancelledAmount) && cancelledAmount > 0) {
    validatedData.cancelledAmount = cancelledAmount;
  }
  // Règlements réellement encaissés avant l'annulation, un par transaction. Sans ces
  // références (moyen + PaymentIntent + payeur), l'app sait COMBIEN rendre mais pas
  // COMMENT ni À QUI → aucun remboursement possible depuis l'application.
  if (Array.isArray(data.cancelPayments) && data.cancelPayments.length) {
    validatedData.cancelPayments = data.cancelPayments;
  }
  // Une vente annulée avant tout envoi en cuisine n'a rien à faire sur le KDS.
  if (data.reachedKitchen === false) validatedData.reachedKitchen = false;

  // Utilisateur (optionnel, doit être un ID non-vide si fourni)
  if (data.user !== undefined && data.user !== null && data.user !== '') {
    if (typeof data.user !== 'string' || data.user.trim().length === 0) {
      errors.push({ field: 'user', message: "L'ID utilisateur doit être une chaîne non vide" });
    }
  }

  // Formule (optionnel, doit être un objet si fourni)
  if (data.formula !== undefined && data.formula !== null) {
    if (typeof data.formula !== 'object') {
      errors.push({ field: 'formula', message: 'La formule doit être un objet' });
    } else {
      // Validation minimale de la formule
      if (!data.formula.name || typeof data.formula.name !== 'string') {
        errors.push({ field: 'formula.name', message: 'La formule doit avoir un nom' });
      }
      if (!data.formula.base_price || typeof data.formula.base_price !== 'number' || data.formula.base_price < 0) {
        errors.push({ field: 'formula.base_price', message: 'La formule doit avoir un prix de base valide' });
      }
    }
  }

  // Ingrédients (optionnel, doit être un tableau si fourni)
  if (data.ingredients !== undefined && data.ingredients !== null) {
    if (!Array.isArray(data.ingredients)) {
      errors.push({ field: 'ingredients', message: 'Les ingrédients doivent être un tableau' });
    } else {
      // Validation minimale des ingrédients
      data.ingredients.forEach((ingredient, index) => {
        if (typeof ingredient !== 'object') {
          errors.push({ field: `ingredients[${index}]`, message: 'L\'ingrédient doit être un objet' });
        } else if (!ingredient.name || typeof ingredient.name !== 'string') {
          errors.push({ field: `ingredients[${index}].name`, message: 'L\'ingrédient doit avoir un nom' });
        }
      });
    }
  } else {
    validatedData.ingredients = [];
  }

  // Salades multiples (optionnel) — commande caisse avec plusieurs salades distinctes.
  if (data.salads !== undefined && data.salads !== null) {
    if (!Array.isArray(data.salads)) {
      errors.push({ field: 'salads', message: 'Les salades doivent être un tableau' });
    } else {
      data.salads.forEach((s, index) => {
        if (typeof s !== 'object' || !s.formula || typeof s.formula !== 'object' || !s.formula.name) {
          errors.push({ field: `salads[${index}].formula`, message: 'Chaque salade doit avoir une formule valide' });
        }
      });
    }
  }

  // Menu (optionnel, doit être un objet si fourni)
  if (data.menu !== undefined && data.menu !== null) {
    if (typeof data.menu !== 'object') {
      errors.push({ field: 'menu', message: 'Le menu doit être un objet' });
    }
  }

  // Produits (optionnel, doit être un tableau si fourni)
  if (data.products !== undefined && data.products !== null) {
    if (!Array.isArray(data.products)) {
      errors.push({ field: 'products', message: 'Les produits doivent être un tableau' });
    } else {
      // Validation minimale des produits
      data.products.forEach((product, index) => {
        if (typeof product !== 'object') {
          errors.push({ field: `products[${index}]`, message: 'Le produit doit être un objet' });
        } else if (!product.name || typeof product.name !== 'string') {
          errors.push({ field: `products[${index}].name`, message: 'Le produit doit avoir un nom' });
        }
      });
    }
  } else {
    validatedData.products = [];
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Valide les données de mise à jour de commande (champs optionnels)
 */
const validateUpdateOrder = (data) => {
  const errors = [];
  const validatedData = { ...data };

  // Nom du client (optionnel, 2-100 caractères si fourni)
  if (data.customerName !== undefined) {
    if (typeof data.customerName !== 'string') {
      errors.push({ field: 'customerName', message: 'Le nom du client doit être une chaîne de caractères' });
    } else {
      const customerName = data.customerName.trim();
      if (customerName.length < 2) {
        errors.push({ field: 'customerName', message: 'Le nom du client doit contenir au moins 2 caractères' });
      } else if (customerName.length > 100) {
        errors.push({ field: 'customerName', message: 'Le nom du client ne peut pas dépasser 100 caractères' });
      } else {
        validatedData.customerName = customerName;
      }
    }
  }

  // Prix total (optionnel, nombre positif)
  if (data.totalPrice !== undefined) {
    const totalPrice = parseFloat(data.totalPrice);
    if (isNaN(totalPrice) || totalPrice <= 0) {
      errors.push({ field: 'totalPrice', message: 'Le prix total doit être un nombre positif' });
    } else if (totalPrice > 10000) {
      errors.push({ field: 'totalPrice', message: 'Le prix total ne peut pas dépasser 10 000€' });
    } else {
      validatedData.totalPrice = totalPrice;
    }
  }

  // Statut (optionnel, doit être valide)
  if (data.status !== undefined) {
    if (!VALID_STATUSES.includes(data.status)) {
      errors.push({ field: 'status', message: 'Statut invalide' });
    }
  }

  // Utilisateur (optionnel, doit être un ID non-vide)
  if (data.user !== undefined) {
    if (data.user !== null && data.user !== '' && (typeof data.user !== 'string' || data.user.trim().length === 0)) {
      errors.push({ field: 'user', message: "L'ID utilisateur doit être une chaîne non vide" });
    }
  }

  // Formule (optionnel, doit être un objet si fourni)
  if (data.formula !== undefined) {
    if (data.formula !== null && typeof data.formula !== 'object') {
      errors.push({ field: 'formula', message: 'La formule doit être un objet' });
    }
  }

  // Ingrédients (optionnel, doit être un tableau si fourni)
  if (data.ingredients !== undefined) {
    if (data.ingredients !== null && !Array.isArray(data.ingredients)) {
      errors.push({ field: 'ingredients', message: 'Les ingrédients doivent être un tableau' });
    }
  }

  // Menu (optionnel, doit être un objet si fourni)
  if (data.menu !== undefined) {
    if (data.menu !== null && typeof data.menu !== 'object') {
      errors.push({ field: 'menu', message: 'Le menu doit être un objet' });
    }
  }

  // Produits (optionnel, doit être un tableau si fourni)
  if (data.products !== undefined) {
    if (data.products !== null && !Array.isArray(data.products)) {
      errors.push({ field: 'products', message: 'Les produits doivent être un tableau' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Middleware pour valider la création de commande
 */
const validateCreateOrderMiddleware = (req, res, next) => {
  const validation = validateCreateOrder(req.body);
  
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
 * Middleware pour valider la mise à jour de commande
 */
const validateUpdateOrderMiddleware = (req, res, next) => {
  const validation = validateUpdateOrder(req.body);
  
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
  VALID_STATUSES,
  VALID_CANCEL_TYPES,
  validateCreateOrder,
  validateUpdateOrder,
  validateCreateOrderMiddleware,
  validateUpdateOrderMiddleware
};