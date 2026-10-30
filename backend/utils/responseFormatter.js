/**
 * @file Formateur de réponses API standardisées
 * Fournit des fonctions pour formater les réponses de l'API de manière cohérente
 */

/**
 * Formate une réponse de succès
 * @param {object} data - Les données à renvoyer
 * @param {string} message - Un message de succès optionnel
 * @param {number} statusCode - Le code de statut HTTP (par défaut 200)
 * @returns {object} Un objet de réponse standardisé
 */
const success = (data, message = 'Opération réussie', statusCode = 200) => {
  return {
    success: true,
    statusCode,
    message,
    data,
    timestamp: new Date().toISOString()
  };
};

/**
 * Formate une réponse de succès avec pagination
 * @param {array} data - Les données à renvoyer
 * @param {object} pagination - Informations de pagination
 * @param {number} pagination.page - Page actuelle
 * @param {number} pagination.limit - Nombre d'éléments par page
 * @param {number} pagination.total - Total d'éléments
 * @param {string} message - Un message de succès optionnel
 * @returns {object} Un objet de réponse standardisé avec pagination
 */
const successWithPagination = (data, pagination, message = 'Opération réussie') => {
  const { page, limit, total } = pagination;
  const totalPages = Math.ceil(total / limit);
  
  return {
    success: true,
    statusCode: 200,
    message,
    data,
    pagination: {
      currentPage: page,
      itemsPerPage: limit,
      totalItems: total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    },
    timestamp: new Date().toISOString()
  };
};

/**
 * Formate une réponse d'erreur
 * @param {string} message - Le message d'erreur
 * @param {number} statusCode - Le code de statut HTTP (par défaut 400)
 * @param {array} errors - Liste d'erreurs détaillées optionnelles
 * @returns {object} Un objet d'erreur standardisé
 */
const error = (message, statusCode = 400, errors = []) => {
  const response = {
    success: false,
    statusCode,
    message,
    timestamp: new Date().toISOString()
  };

  if (errors.length > 0) {
    response.errors = errors;
  }

  return response;
};

/**
 * Formate une réponse de validation d'erreur (spécifique aux erreurs de validation)
 * @param {array} validationErrors - Liste d'erreurs de validation
 * @param {string} message - Message général d'erreur (par défaut 'Validation échouée')
 * @returns {object} Un objet d'erreur de validation standardisé
 */
const validationError = (validationErrors, message = 'Validation échouée') => {
  return {
    success: false,
    statusCode: 400,
    message,
    errors: validationErrors,
    timestamp: new Date().toISOString()
  };
};

/**
 * Middleware pour envoyer une réponse de succès
 * @param {object} res - L'objet réponse Express
 * @param {object} data - Les données à envoyer
 * @param {string} message - Un message de succès optionnel
 * @param {number} statusCode - Le code de statut HTTP (par défaut 200)
 */
const sendSuccess = (res, data, message = 'Opération réussie', statusCode = 200) => {
  const response = success(data, message, statusCode);
  res.status(statusCode).json(response);
};

/**
 * Middleware pour envoyer une réponse de succès avec pagination
 * @param {object} res - L'objet réponse Express
 * @param {array} data - Les données à envoyer
 * @param {object} pagination - Informations de pagination
 * @param {string} message - Un message de succès optionnel
 */
const sendSuccessWithPagination = (res, data, pagination, message = 'Opération réussie') => {
  const response = successWithPagination(data, pagination, message);
  res.status(200).json(response);
};

/**
 * Middleware pour envoyer une réponse d'erreur
 * @param {object} res - L'objet réponse Express
 * @param {string} message - Le message d'erreur
 * @param {number} statusCode - Le code de statut HTTP (par défaut 400)
 * @param {array} errors - Liste d'erreurs détaillées optionnelles
 */
const sendError = (res, message, statusCode = 400, errors = []) => {
  const response = error(message, statusCode, errors);
  res.status(statusCode).json(response);
};

/**
 * Middleware pour envoyer une réponse d'erreur de validation
 * @param {object} res - L'objet réponse Express
 * @param {array} validationErrors - Liste d'erreurs de validation
 * @param {string} message - Message général d'erreur
 */
const sendValidationError = (res, validationErrors, message = 'Validation échouée') => {
  const response = validationError(validationErrors, message);
  res.status(400).json(response);
};

/**
 * Wrapper pour les contrôleurs async/await qui gère automatiquement les erreurs
 * @param {function} fn - La fonction du contrôleur
 * @returns {function} Une fonction middleware Express
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error('❌ Erreur:', error);
      
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Erreur interne du serveur';
      
      sendError(res, message, statusCode);
    });
  };
};

module.exports = {
  success,
  successWithPagination,
  error,
  validationError,
  sendSuccess,
  sendSuccessWithPagination,
  sendError,
  sendValidationError,
  asyncHandler
};