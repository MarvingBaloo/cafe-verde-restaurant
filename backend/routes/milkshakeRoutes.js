const express = require('express');
const {
  getMilkshakes, getMilkshakeById, createMilkshake, updateMilkshake,
  deleteMilkshake, toggleMilkshakeAvailability,
} = require('../controllers/milkshakeController');
const { protect, admin } = require('../middleware/authMiddleware');
const {
  validateCreateMilkshakeMiddleware, validateUpdateMilkshakeMiddleware,
} = require('../validators/milkshakeValidator');
const { upload, compressImage, generateUniqueFilename, calculateCompression } = require('../utils/uploadConfig');
const { bucket } = require('../config/firebase');

const router = express.Router();

/**
 * POST /api/milkshakes/upload — upload + compression d'une image de milkshake.
 * Réponse plate (imageUrl à la racine), cohérente avec dishRoutes.
 */
router.post('/upload', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier uploadé' });

    const compressedBuffer = await compressImage(req.file.buffer, {
      maxWidth: 800, maxHeight: 800, quality: 85, format: 'webp'
    });
    const filename = generateUniqueFilename(req.file.originalname, 'webp');
    const file = bucket.file(`milkshakes/${filename}`);
    await file.save(compressedBuffer, {
      metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' },
      resumable: false
    });
    await file.makePublic();

    const stats = calculateCompression(req.file.size, compressedBuffer.length);
    const imageUrl = `https://storage.googleapis.com/${bucket.name}/milkshakes/${filename}`;
    res.json({ imageUrl, filename, compressedSize: stats.compressedKB + ' KB', message: 'Image uploadée avec succès' });
  } catch (error) {
    console.error('❌ Erreur upload milkshake:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'upload", error: error.message });
  }
});

router.patch('/:id/toggle-availability', protect, admin, toggleMilkshakeAvailability);
router.route('/')
  .get(getMilkshakes)
  .post(protect, admin, validateCreateMilkshakeMiddleware, createMilkshake);
router.route('/:id')
  .get(getMilkshakeById)
  .put(protect, admin, validateUpdateMilkshakeMiddleware, updateMilkshake)
  .delete(protect, admin, deleteMilkshake);

module.exports = router;
