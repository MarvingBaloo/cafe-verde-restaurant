// backend/controllers/milkshakeController.js
// CRUD des milkshakes (produits configurables). Un milkshake porte ses propres
// catégories + ingrédients imbriqués (modèle "plat chaud"), pas de catalogue commun.
// Émet des événements Socket.io pour le temps réel.

const { milkshakesCol, findAll: findAllMilkshakes } = require('../models/Milkshake');

const emit = (req, event, payload) => {
  const io = req.app.get('socketio');
  if (io) io.emit(event, payload);
};

// GET /api/milkshakes
exports.getMilkshakes = async (req, res) => {
  try {
    res.json(await findAllMilkshakes());
  } catch (error) {
    console.error('getMilkshakes error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// GET /api/milkshakes/:id
exports.getMilkshakeById = async (req, res) => {
  try {
    const doc = await milkshakesCol.doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Milkshake introuvable' });
    res.json({ id: doc.id, _id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('getMilkshakeById error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// POST /api/milkshakes
exports.createMilkshake = async (req, res) => {
  try {
    const data = {
      name:        req.body.name,
      description: req.body.description ?? '',
      price:       req.body.price,
      image:       req.body.image || '',
      categories:  req.body.categories || [],
      categoryId:  req.body.categoryId || null,
      isAvailable: req.body.isAvailable !== false,
      createdAt:   new Date(),
      updatedAt:   new Date(),
    };
    const docRef = await milkshakesCol.add(data);
    const created = { id: docRef.id, _id: docRef.id, ...data };
    emit(req, 'milkshake_created', created);
    res.status(201).json(created);
  } catch (error) {
    console.error('createMilkshake error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// PUT /api/milkshakes/:id
exports.updateMilkshake = async (req, res) => {
  try {
    const updateFields = {};
    ['name', 'description', 'price', 'image', 'categories', 'categoryId', 'isAvailable']
      .forEach(f => { if (req.body[f] !== undefined) updateFields[f] = req.body[f]; });
    updateFields.updatedAt = new Date();

    const docRef = milkshakesCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Milkshake introuvable' });

    await docRef.update(updateFields);
    const updated = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };
    emit(req, 'milkshake_updated', updated);
    res.json(updated);
  } catch (error) {
    console.error('updateMilkshake error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// DELETE /api/milkshakes/:id
exports.deleteMilkshake = async (req, res) => {
  try {
    const docRef = milkshakesCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Milkshake introuvable' });

    await docRef.delete();
    emit(req, 'milkshake_deleted', { id: req.params.id, _id: req.params.id });
    res.json({ success: true, message: 'Milkshake supprimé', id: req.params.id });
  } catch (error) {
    console.error('deleteMilkshake error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// PATCH /api/milkshakes/:id/toggle-availability
exports.toggleMilkshakeAvailability = async (req, res) => {
  try {
    const docRef = milkshakesCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Milkshake introuvable' });

    const isAvailable = !existing.data().isAvailable;
    await docRef.update({ isAvailable, updatedAt: new Date() });
    const updated = { id: docRef.id, _id: docRef.id, ...existing.data(), isAvailable };
    emit(req, 'milkshake_updated', updated);
    res.json(updated);
  } catch (error) {
    console.error('toggleMilkshakeAvailability error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
