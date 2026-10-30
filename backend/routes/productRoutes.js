const express = require('express');
const { upload, compressImage, generateUniqueFilename, calculateCompression } = require('../utils/uploadConfig');
const { bucket } = require('../config/firebase');

// Importation des contrôleurs et middlewares
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleProductAvailability
} = require('../controllers/productController.js');

const { protect, admin } = require('../middleware/authMiddleware');
const {
  validateCreateProductMiddleware,
  validateUpdateProductMiddleware
} = require('../validators/productValidator');

const router = express.Router();

/**
 * @route   POST /api/products/upload
 * @desc    Uploader une image de produit
 * @access  Private/Admin
 */
router.post('/upload', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'Aucun fichier uploadé'
      });
    }

    // Compression via uploadConfig (cohérence avec ingredientRoutes et dishRoutes)
    const compressedBuffer = await compressImage(req.file.buffer, {
      maxWidth: 800,
      maxHeight: 800,
      quality: 85,
      format: 'webp'
    });

    const filename = generateUniqueFilename(req.file.originalname, 'webp');

    // Upload vers Firebase Storage
    const file = bucket.file(`products/${filename}`);
    await file.save(compressedBuffer, {
      metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' },
      resumable: false
    });
    await file.makePublic();

    const compressionStats = calculateCompression(req.file.size, compressedBuffer.length);
    console.log(`✅ Image produit uploadée sur Firebase: products/${filename} (${compressionStats.compressedKB} KB)`);

    const imageUrl = `https://storage.googleapis.com/${bucket.name}/products/${filename}`;

    res.json({
      success: true,
      data: {
        imageUrl,
        originalSize: compressionStats.originalKB + ' KB',
        compressedSize: compressionStats.compressedKB + ' KB',
        compression: compressionStats.ratio + '%'
      },
      message: 'Image uploadée avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur upload:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'upload',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/products
 * @desc    Récupérer tous les produits
 * @access  Public
 */
router.get('/', getProducts);

/**
 * @route   GET /api/products/:id
 * @desc    Récupérer un produit par ID
 * @access  Public
 */
router.get('/:id', getProductById);

/**
 * @route   POST /api/products
 * @desc    Créer un nouveau produit
 * @access  Private/Admin
 */
router.post('/', protect, admin, validateCreateProductMiddleware, createProduct);

/**
 * @route   PUT /api/products/:id
 * @desc    Mettre à jour un produit
 * @access  Private/Admin
 */
router.put('/:id', protect, admin, validateUpdateProductMiddleware, updateProduct);

/**
 * @route   DELETE /api/products/:id
 * @desc    Supprimer un produit
 * @access  Private/Admin
 */
router.delete('/:id', protect, admin, deleteProduct);

/**
 * @route   PATCH /api/products/:id/toggle-availability
 * @desc    Basculer la disponibilité d'un produit
 * @access  Private/Admin
 */
router.patch('/:id/toggle-availability', protect, admin, toggleProductAvailability);

module.exports = router;
