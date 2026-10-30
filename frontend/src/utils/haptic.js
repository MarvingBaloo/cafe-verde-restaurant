// src/utils/haptic.js

/**
 * Déclenche une vibration sur les appareils compatibles (mobile principalement)
 * Améliore l'engagement utilisateur avec un feedback tactile
 * 
 * @param {number|number[]} pattern - Durée en ms ou pattern de vibration [vibration, pause, vibration...]
 * @example
 * vibrate(50); // Vibration simple de 50ms
 * vibrate([50, 100, 50]); // Pattern: vibrer 50ms, pause 100ms, vibrer 50ms
 */
export const vibrate = (pattern = [50]) => {
  // Vérifier si l'API Vibration est disponible
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (error) {
      // Silencieux en cas d'erreur (compatibilité navigateur)
      console.debug('Vibration API non supportée ou bloquée:', error);
    }
  }
};

/**
 * Patterns de vibration prédéfinis pour différents types d'interactions
 * Suivent les conventions iOS/Android pour une expérience familière
 */
export const HAPTIC_PATTERNS = {
  // Feedback légers
  light: [30],        // Tap léger (sélection simple)
  medium: [50],       // Tap moyen (action standard)
  heavy: [70],        // Tap fort (action importante)
  
  // Feedback de succès/erreur
  success: [50, 100, 50],           // Double tap (validation réussie)
  error: [100, 50, 100, 50, 100],   // Triple tap (erreur)
  warning: [80, 60, 80],            // Double tap moyen (avertissement)
  
  // Feedback spécifiques
  select: [30],       // Sélection d'un item
  deselect: [20],     // Désélection d'un item
  toggle: [40],       // Toggle on/off
  notification: [50, 100, 50, 100, 50], // Notification importante
};

/**
 * Fonction helper pour feedback de sélection d'ingrédient
 * @param {boolean} isAdding - True si on ajoute, false si on retire
 */
export const hapticIngredientToggle = (isAdding) => {
  vibrate(isAdding ? HAPTIC_PATTERNS.select : HAPTIC_PATTERNS.deselect);
};

/**
 * Fonction helper pour feedback de validation de commande
 */
export const hapticOrderSuccess = () => {
  vibrate(HAPTIC_PATTERNS.success);
};

/**
 * Fonction helper pour feedback d'erreur
 */
export const hapticError = () => {
  vibrate(HAPTIC_PATTERNS.error);
};

/**
 * Fonction helper pour feedback de limite atteinte
 */
export const hapticLimitReached = () => {
  vibrate(HAPTIC_PATTERNS.warning);
};
