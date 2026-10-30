// backend/controllers/dishController.js
const { dishesCol, findAll, findById } = require('../models/Dish');

// GET /api/dishes — liste publique, triée par création décroissante
exports.getDishes = async (req, res) => {
  try {
    const dishes = await findAll();
    res.json(dishes);
  } catch (error) {
    console.error('getDishes error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// POST /api/dishes — création (req.body déjà validé par validateCreateDishMiddleware)
exports.createDish = async (req, res) => {
  try {
    const dishData = {
      name:                   req.body.name,
      description:            req.body.description ?? '',
      price:                  req.body.price,
      image:                  req.body.image || '',
      category:               req.body.category || 'hot_dish',
      sides:                  req.body.sides || [],
      maxSides:               req.body.maxSides ?? 0,
      dietaryTags:            req.body.dietaryTags || [],
      isAvailable:            req.body.isAvailable !== false,
      createdAt:              new Date(),
      updatedAt:              new Date()
    };

    const docRef = await dishesCol.add(dishData);
    const createdDish = { id: docRef.id, _id: docRef.id, ...dishData };
    const io = req.app.get('socketio');
    if (io) io.emit('dish_created', createdDish);
    res.status(201).json(createdDish);
  } catch (error) {
    console.error('createDish error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// PUT /api/dishes/:id — mise à jour partielle (req.body déjà validé par validateUpdateDishMiddleware)
exports.updateDish = async (req, res) => {
  try {
    const { id } = req.params;

    const updateFields = {};
    ['name', 'description', 'price', 'image', 'category', 'sides', 'maxSides', 'dietaryTags', 'isAvailable']
      .forEach(field => {
        if (req.body[field] !== undefined) updateFields[field] = req.body[field];
      });
    updateFields.updatedAt = new Date();

    const docRef = dishesCol.doc(id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Plat introuvable' });

    await docRef.update(updateFields);

    // Fusion locale pour éviter un second aller-retour Firestore
    const updatedDish = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };
    const io = req.app.get('socketio');
    if (io) io.emit('dish_updated', updatedDish);
    res.json(updatedDish);
  } catch (error) {
    console.error('updateDish error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// DELETE /api/dishes/:id
exports.deleteDish = async (req, res) => {
  try {
    const docRef = dishesCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Plat introuvable' });

    await docRef.delete();
    const io = req.app.get('socketio');
    if (io) io.emit('dish_deleted', { id: req.params.id, _id: req.params.id });
    res.json({ success: true, message: 'Plat supprimé' });
  } catch (error) {
    console.error('deleteDish error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
