/**
 * @file Gestionnaire d'erreurs centralisé
 * Fournit des fonctions pour gérer et formater les erreurs de manière cohérente
 */

const { sendError, sendValidationError } = require('./responseFormatter');

/**
 * Classe d'erreur personnalisée pour l'API
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, errors = []) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Classe d'erreur de validation
 */
class ValidationError extends ApiError {
  constructor(errors, message = 'Validation échouée') {
    super(message, 400, errors);
  }
}

/**
 * Classe d'erreur d'authentification
 */
class AuthenticationError extends ApiError {
  constructor(message = 'Non authentifié') {
    super(message, 401);
  }
}

/**
 * Classe d'erreur d'autorisation
 */
class AuthorizationError extends ApiError {
  constructor(message = 'Non autorisé') {
    super(message, 403);
  }
}

/**
 * Classe d'erreur de ressource non trouvée
 */
class NotFoundError extends ApiError {
  constructor(message = 'Ressource non trouvée') {
    super(message, 404);
  }
}

/**
 * Middleware global de gestion d'erreurs
 * @param {Error} err - L'erreur
 * @param {object} req - La requête Express
 * @param {object} res - La réponse Express
 * @param {function} next - Le prochain middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Erreur globale:', {
    message: err.message,
    stack: err.stack,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method
  });

  // Si c'est une erreur de validation spécifique
  if (err.name === 'ValidationError' && err.errors) {
    const validationErrors = Object.values(err.errors).map(error => ({
      field: error.path,
      message: error.message
    }));
    return sendValidationError(res, validationErrors, 'Validation de données échouée');
  }

  // Si c'est une erreur JWT
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 'Token invalide', 401);
  }

  if (err.name === 'TokenExpiredError') {
    return sendError(res, 'Token expiré', 401);
  }

  // Si c'est une erreur de syntaxe JSON
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 'JSON invalide', 400);
  }

  // Si c'est une erreur de base de données
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    // Erreur de duplication (code 11000)
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return sendError(res, `${field} déjà existant`, 409);
    }
    return sendError(res, 'Erreur de base de données', 500);
  }

  // Si c'est une de nos erreurs API personnalisées
  if (err instanceof ApiError) {
    return sendError(res, err.message, err.statusCode, err.errors);
  }

  // Erreur par défaut — respecte un statut déjà positionné (ex: res.status(401) dans protect)
  const fallbackStatus = res.statusCode && res.statusCode >= 400 ? res.statusCode : 500;
  const message = process.env.NODE_ENV === 'production' && fallbackStatus === 500
    ? 'Erreur interne du serveur'
    : err.message;

  sendError(res, message, fallbackStatus);
};

/**
 * Middleware pour gérer les routes non trouvées
 */
const notFoundHandler = (req, res, next) => {
  sendError(res, `Route non trouvée: ${req.method} ${req.originalUrl}`, 404);
};

/**
 * Middleware pour logger les requêtes
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor = res.statusCode >= 400 ? '❌' : '✅';
    
    console.log(`${statusColor} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  
  next();
};

module.exports = {
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  errorHandler,
  notFoundHandler,
  requestLogger
};