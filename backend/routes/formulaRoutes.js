const express = require('express');
const router = express.Router();
const {
  getFormulas,
  getFormulaById,
  createFormula,
  updateFormula,
  deleteFormula,
  uploadFormulaImage,
  upload
} = require('../controllers/formulaController');
const { protect, admin } = require('../middleware/authMiddleware');

// Routes publiques
router.get('/', getFormulas);
router.get('/:id', getFormulaById);

// Routes protégées (Admin uniquement)
router.post('/', protect, admin, createFormula);
router.put('/:id', protect, admin, updateFormula);
router.delete('/:id', protect, admin, deleteFormula);
router.post('/:id/image', protect, admin, upload.single('image'), uploadFormulaImage);

module.exports = router;
