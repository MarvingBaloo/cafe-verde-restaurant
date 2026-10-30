const express = require('express');
const router = express.Router();
const { upload, compressImage, generateUniqueFilename, calculateCompression } = require('../utils/uploadConfig');
const { bucket } = require('../config/firebase');

// Importation des contrôleurs et middlewares
const {
  getMenus,
  getMenuById,
  createMenu,
  updateMenu,
  deleteMenu,
  toggleMenuAvailability
} = require('../controllers/menuController.js');

const { protect, admin } = require('../middleware/authMiddleware');
const {
  validateCreateMenuMiddleware,
  validateUpdateMenuMiddleware
} = require('../validators/menuValidator');

/**
 * @route   POST /api/menus/upload
 * @desc    Uploader une image de menu (compressée, vers Firebase Storage)
 * @access  Private/Admin
 * @returns { success, data: { imageUrl } }
 */
router.post('/upload', protect, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier uploadé' });
    }

    const compressedBuffer = await compressImage(req.file.buffer, {
      maxWidth: 800, maxHeight: 800, quality: 85, format: 'webp'
    });

    const filename = generateUniqueFilename(req.file.originalname, 'webp');
    const file = bucket.file(`menus/${filename}`);
    await file.save(compressedBuffer, {
      metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' },
      resumable: false
    });
    await file.makePublic();

    const compressionStats = calculateCompression(req.file.size, compressedBuffer.length);
    console.log(`✅ Image menu uploadée sur Firebase: menus/${filename} (${compressionStats.compressedKB} KB)`);

    const imageUrl = `https://storage.googleapis.com/${bucket.name}/menus/${filename}`;
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
    console.error('❌ Erreur upload menu:', error);
    res.status(500).json({ success: false, message: 'Erreur lors de l\'upload', error: error.message });
  }
});

/**
 * @route   GET /api/menus
 * @desc    Récupérer tous les menus
 * @access  Public
 */
router.get('/', getMenus);

/**
 * @route   GET /api/menus/:id
 * @desc    Récupérer un menu par ID
 * @access  Public
 */
router.get('/:id', getMenuById);

/**
 * @route   POST /api/menus
 * @desc    Créer un nouveau menu
 * @access  Private/Admin
 */
router.post('/', protect, admin, validateCreateMenuMiddleware, createMenu);

/**
 * @route   PUT /api/menus/:id
 * @desc    Mettre à jour un menu
 * @access  Private/Admin
 */
router.put('/:id', protect, admin, validateUpdateMenuMiddleware, updateMenu);

/**
 * @route   DELETE /api/menus/:id
 * @desc    Supprimer un menu
 * @access  Private/Admin
 */
router.delete('/:id', protect, admin, deleteMenu);

/**
 * @route   PATCH /api/menus/:id/toggle-availability
 * @desc    Basculer la disponibilité d'un menu
 * @access  Private/Admin
 */
router.patch('/:id/toggle-availability', protect, admin, toggleMenuAvailability);

module.exports = router;
