const express = require('express');
const {
  getAllCategories, getCategoryById, createCategory, updateCategory, deleteCategory,
} = require('../controllers/productCategoryController');
const { protect, admin } = require('../middleware/authMiddleware');
const {
  validateCreateProductCategoryMiddleware, validateUpdateProductCategoryMiddleware,
} = require('../validators/productCategoryValidator');

const router = express.Router();

router.route('/')
  .get(getAllCategories)
  .post(protect, admin, validateCreateProductCategoryMiddleware, createCategory);

router.route('/:id')
  .get(getCategoryById)
  .put(protect, admin, validateUpdateProductCategoryMiddleware, updateCategory)
  .delete(protect, admin, deleteCategory);

module.exports = router;
