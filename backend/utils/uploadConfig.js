/**
 * @file Configuration centralisée pour l'upload de fichiers (Multer)
 * Fournit des configurations réutilisables pour différents types de fichiers
 */

const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs').promises;

/**
 * Configuration de base pour le stockage en mémoire (temporaire)
 */
const memoryStorage = multer.memoryStorage();

/**
 * Filtre de fichiers pour accepter uniquement les images
 * @param {Object} file - Fichier uploadé
 * @param {Function} cb - Callback
 */
const imageFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Seules les images sont autorisées (jpeg, jpg, png, gif, webp)'));
  }
};

/**
 * Configuration pour l'upload d'images (avec limites)
 */
const uploadImageConfig = {
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: imageFileFilter
};

/**
 * Compresse et redimensionne une image
 * @param {Buffer} buffer - Buffer de l'image
 * @param {Object} options - Options de compression
 * @param {number} options.maxWidth - Largeur maximale
 * @param {number} options.maxHeight - Hauteur maximale
 * @param {number} options.quality - Qualité (1-100)
 * @param {string} options.format - Format de sortie (webp, jpeg, png)
 * @returns {Promise<Buffer>} Buffer de l'image compressée
 */
const compressImage = async (buffer, options = {}) => {
  const {
    maxWidth = 800,
    maxHeight = 800,
    quality = 85,
    format = 'webp'
  } = options;

  const sharpInstance = sharp(buffer);

  // Redimensionnement
  const metadata = await sharpInstance.metadata();
  if (metadata.width > maxWidth || metadata.height > maxHeight) {
    sharpInstance.resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  // Compression selon le format
  switch (format) {
    case 'jpeg':
    case 'jpg':
      sharpInstance.jpeg({ quality });
      break;
    case 'png':
      sharpInstance.png({ quality });
      break;
    case 'webp':
    default:
      sharpInstance.webp({ quality });
  }

  return sharpInstance.toBuffer();
};

/**
 * Génère un nom de fichier unique
 * @param {string} originalname - Nom original du fichier
 * @param {string} format - Format de sortie
 * @returns {string} Nom de fichier unique
 */
const generateUniqueFilename = (originalname, format = 'webp') => {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const nameWithoutExt = path.basename(originalname, path.extname(originalname))
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();
  return `${nameWithoutExt}-${uniqueSuffix}.${format}`;
};

/**
 * Calcule le taux de compression
 * @param {number} originalSize - Taille originale en octets
 * @param {number} compressedSize - Taille compressée en octets
 * @returns {Object} Résultats de compression
 */
const calculateCompression = (originalSize, compressedSize) => {
  const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
  return {
    originalKB: (originalSize / 1024).toFixed(2),
    compressedKB: (compressedSize / 1024).toFixed(2),
    ratio: compressionRatio,
    savedKB: ((originalSize - compressedSize) / 1024).toFixed(2)
  };
};

/**
 * Vérifie si un dossier existe, le crée si nécessaire
 * @param {string} dirPath - Chemin du dossier
 */
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
};

/**
 * Instance Multer configurée pour les images
 */
const upload = multer(uploadImageConfig);

module.exports = {
  memoryStorage,
  imageFileFilter,
  uploadImageConfig,
  compressImage,
  generateUniqueFilename,
  calculateCompression,
  ensureDirectoryExists,
  upload
};