/**
 * Utilitaires pour la gestion des URLs d'images
 */

const API_BASE_URL = import.meta.env.VITE_API_URL;

/**
 * Construit l'URL complète d'une image
 * @param {string} imagePath - Chemin de l'image (peut être relatif ou absolu)
 * @returns {string} URL complète de l'image
 */
export const getImageUrl = (imagePath) => {
  if (!imagePath) {
    return null;
  }

  // Si l'image commence par /uploads, c'est une image locale
  if (imagePath.startsWith('/uploads')) {
    return `${API_BASE_URL}${imagePath}`;
  }

  // Si c'est déjà une URL complète (http:// ou https://), la retourner telle quelle
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }

  // Sinon, c'est probablement une URL relative, ajouter le base URL
  return `${API_BASE_URL}${imagePath}`;
};

/**
 * Vérifie si une image existe (a une URL valide)
 * @param {string} imagePath - Chemin de l'image
 * @returns {boolean} True si l'image existe
 */
export const hasImage = (imagePath) => {
  return Boolean(imagePath && imagePath.trim());
};
