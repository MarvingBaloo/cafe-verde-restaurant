/**
 * @file Constantes partagées pour les catégories d'ingrédients et leur mapping vers les limites.
 * Ce fichier unifie la logique métier pour éviter la duplication dans ConfigContext.jsx et Configurator.jsx.
 */

/**
 * Mapping des catégories d'ingrédients vers les clés de limites définies dans les formules.
 * Utilisé pour valider les sélections d'ingrédients et calculer les dépassements.
 */
export const CATEGORY_TO_LIMIT_KEY = {
  base_salade: 'base',
  proteine: 'protein',
  topping_legume: 'topping',
  topping_fruit: 'topping',
  sauce: 'sauce'
};

/**
 * Catégories valides pour les ingrédients de salade.
 */
export const SALAD_CATEGORIES = [
  'base_salade',
  'proteine',
  'topping_legume',
  'topping_fruit',
  'sauce'
];

/**
 * Étapes de configuration pour les salades avec labels et icônes.
 */
export const SALAD_STEPS = [
  { 
    id: 'base_salade', 
    label: 'Bases', 
    icon: 'rice'
  },
  { 
    id: 'proteine', 
    label: 'Protéines', 
    icon: 'meat'
  },
  { 
    id: 'topping_legume', 
    label: 'Toppings', 
    icon: 'avocado'
  },
  { 
    id: 'topping_fruit', 
    label: 'Fruits', 
    icon: 'fruit'
  },
  { 
    id: 'sauce', 
    label: 'Sauces', 
    icon: 'can'
  }
];

/**
 * Détermine si une catégorie appartient au type salade.
 * @param {string} category - La catégorie à vérifier
 * @returns {boolean}
 */
export const isSaladCategory = (category) => SALAD_CATEGORIES.includes(category);

/**
 * Obtient la clé de limite correspondant à une catégorie d'ingrédient.
 * @param {string} category - La catégorie d'ingrédient
 * @returns {string|null} La clé de limite ou null si non trouvée
 */
export const getLimitKeyForCategory = (category) => CATEGORY_TO_LIMIT_KEY[category] || null;

/**
 * Obtient les étapes de configuration en fonction du type de formule.
 * @param {string} formulaType - Le type de formule (ex: 'salad')
 * @returns {Array} Les étapes de configuration
 */
// Une seule famille de formules pour l'instant : le type est accepté mais ignoré.
export const getStepsForFormulaType = (_formulaType) => SALAD_STEPS;