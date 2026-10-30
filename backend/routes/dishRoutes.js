const express = require('express');
const { getDishes, createDish, updateDish, deleteDish } = require('../controllers/dishController');
const { upload, compressImage, generateUniqueFilename, calculateCompression } = require('../utils/uploadConfig');
const { validateCreateDishMiddleware, validateUpdateDishMiddleware } = require('../validators/dishValidator');
const { bucket } = require('../config/firebase');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * POST /api/dishes/upload
 * Upload et compression d'une image de plat.
 *
 * Réponse plate (imageUrl à la racine) pour cohérence avec productRoutes.
 * NOTE Phase E : harmoniser tous les endpoints upload (ingredients utilise
 * une structure enveloppée { success, data: { imageUrl } } — à unifier).
 */
router.post('/upload', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé' });
    }

    const compressedBuffer = await compressImage(req.file.buffer, {
      maxWidth: 800,
      maxHeight: 800,
      quality: 85,
      format: 'webp'
    });

    const filename = generateUniqueFilename(req.file.originalname, 'webp');

    // Upload vers Firebase Storage
    const file = bucket.file(`dishes/${filename}`);
    await file.save(compressedBuffer, {
      metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' },
      resumable: false
    });
    await file.makePublic();

    const compressionStats = calculateCompression(req.file.size, compressedBuffer.length);
    console.log(`✅ Image plat uploadée sur Firebase: dishes/${filename} (${compressionStats.compressedKB} KB)`);

    const imageUrl = `https://storage.googleapis.com/${bucket.name}/dishes/${filename}`;
    res.json({
      imageUrl,
      filename,
      originalSize: compressionStats.originalKB + ' KB',
      compressedSize: compressionStats.compressedKB + ' KB',
      compressionRatio: compressionStats.ratio + '%',
      message: 'Image uploadée avec succès'
    });
  } catch (error) {
    console.error('❌ Erreur upload dish:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'upload", error: error.message });
  }
});

router.route('/')
  .get(getDishes)
  .post(protect, admin, validateCreateDishMiddleware, createDish);

router.route('/:id')
  .put(protect, admin, validateUpdateDishMiddleware, updateDish)
  .delete(protect, admin, deleteDish);

module.exports = router;
