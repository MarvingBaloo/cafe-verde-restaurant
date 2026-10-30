const express = require('express');
const {
  getBubbleTeas, getBubbleTeaById, createBubbleTea, updateBubbleTea,
  deleteBubbleTea, toggleBubbleTeaAvailability,
} = require('../controllers/bubbleTeaController');
const { protect, admin } = require('../middleware/authMiddleware');
const {
  validateCreateBubbleTeaMiddleware, validateUpdateBubbleTeaMiddleware,
} = require('../validators/bubbleTeaValidator');
const { upload, compressImage, generateUniqueFilename, calculateCompression } = require('../utils/uploadConfig');
const { bucket } = require('../config/firebase');

const router = express.Router();

/**
 * POST /api/bubble-teas/upload — upload + compression d'une image de bubble tea.
 * Réponse plate (imageUrl à la racine), cohérente avec dishRoutes.
 */
router.post('/upload', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier uploadé' });

    const compressedBuffer = await compressImage(req.file.buffer, {
      maxWidth: 800, maxHeight: 800, quality: 85, format: 'webp'
    });
    const filename = generateUniqueFilename(req.file.originalname, 'webp');
    const file = bucket.file(`bubble-teas/${filename}`);
    await file.save(compressedBuffer, {
      metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' },
      resumable: false
    });
    await file.makePublic();

    const stats = calculateCompression(req.file.size, compressedBuffer.length);
    const imageUrl = `https://storage.googleapis.com/${bucket.name}/bubble-teas/${filename}`;
    res.json({ imageUrl, filename, compressedSize: stats.compressedKB + ' KB', message: 'Image uploadée avec succès' });
  } catch (error) {
    console.error('❌ Erreur upload bubble tea:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'upload", error: error.message });
  }
});

router.patch('/:id/toggle-availability', protect, admin, toggleBubbleTeaAvailability);
router.route('/')
  .get(getBubbleTeas)
  .post(protect, admin, validateCreateBubbleTeaMiddleware, createBubbleTea);
router.route('/:id')
  .get(getBubbleTeaById)
  .put(protect, admin, validateUpdateBubbleTeaMiddleware, updateBubbleTea)
  .delete(protect, admin, deleteBubbleTea);

module.exports = router;
