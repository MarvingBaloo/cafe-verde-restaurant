const express = require('express');
const { getIngredients, addIngredient, updateIngredient, deleteIngredient } = require('../controllers/ingredientController.js');
const { upload, compressImage, generateUniqueFilename, calculateCompression } = require('../utils/uploadConfig.js');
const { validateCreateIngredientMiddleware, validateUpdateIngredientMiddleware } = require('../validators/ingredientValidator.js');
const { bucket } = require('../config/firebase');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @description Route pour uploader et compresser une image d'ingrédient
 * POST /api/ingredients/upload
 * @access Private/Admin
 */
router.post('/upload', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'Aucun fichier uploadé' 
      });
    }

    // Compression
    const compressedBuffer = await compressImage(req.file.buffer, {
      maxWidth: 800,
      maxHeight: 800,
      quality: 85,
      format: 'webp'
    });

    // Nom de fichier unique
    const filename = generateUniqueFilename(req.file.originalname, 'webp');

    // Upload vers Firebase Storage
    const file = bucket.file(`ingredients/${filename}`);
    await file.save(compressedBuffer, {
      metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' },
      resumable: false
    });
    await file.makePublic();

    const compressionStats = calculateCompression(req.file.size, compressedBuffer.length);
    console.log(`✅ Image ingrédient uploadée sur Firebase: ingredients/${filename} (${compressionStats.compressedKB} KB)`);

    const imageUrl = `https://storage.googleapis.com/${bucket.name}/ingredients/${filename}`;
    res.json({
      success: true,
      data: {
        imageUrl,
        filename,
        originalSize: compressionStats.originalKB + ' KB',
        compressedSize: compressionStats.compressedKB + ' KB',
        compressionRatio: compressionStats.ratio + '%',
        savedSpace: compressionStats.savedKB + ' KB'
      }
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
 * @description Routes pour les ingrédients (Collection)
 * GET : Récupérer la liste
 * POST : Ajouter un ingrédient (avec validation)
 */
router.route('/')
  .get(getIngredients)
  .post(protect, admin, validateCreateIngredientMiddleware, addIngredient);

/**
 * @description Routes pour un ingrédient spécifique (Item)
 * PUT : Mettre à jour (Stock, Prix, etc.) (avec validation)
 */
router.route('/:id')
  .put(protect, admin, validateUpdateIngredientMiddleware, updateIngredient)
  .delete(protect, admin, deleteIngredient);

module.exports = router;
