// backend/controllers/bubbleTeaController.js
// CRUD des bubble teas (produits configurables). Un bubble tea porte ses propres
// catégories + ingrédients imbriqués (modèle "plat chaud"), pas de catalogue commun.
// Émet des événements Socket.io pour le temps réel.

const { bubbleTeasCol, findAll: findAllBubbleTeas } = require('../models/BubbleTea');

const emit = (req, event, payload) => {
  const io = req.app.get('socketio');
  if (io) io.emit(event, payload);
};

// GET /api/bubble-teas
exports.getBubbleTeas = async (req, res) => {
  try {
    res.json(await findAllBubbleTeas());
  } catch (error) {
    console.error('getBubbleTeas error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// GET /api/bubble-teas/:id
exports.getBubbleTeaById = async (req, res) => {
  try {
    const doc = await bubbleTeasCol.doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Bubble tea introuvable' });
    res.json({ id: doc.id, _id: doc.id, ...doc.data() });
  } catch (error) {
    console.error('getBubbleTeaById error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// POST /api/bubble-teas
exports.createBubbleTea = async (req, res) => {
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
    const docRef = await bubbleTeasCol.add(data);
    const created = { id: docRef.id, _id: docRef.id, ...data };
    emit(req, 'bubbletea_created', created);
    res.status(201).json(created);
  } catch (error) {
    console.error('createBubbleTea error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// PUT /api/bubble-teas/:id
exports.updateBubbleTea = async (req, res) => {
  try {
    const updateFields = {};
    ['name', 'description', 'price', 'image', 'categories', 'categoryId', 'isAvailable']
      .forEach(f => { if (req.body[f] !== undefined) updateFields[f] = req.body[f]; });
    updateFields.updatedAt = new Date();

    const docRef = bubbleTeasCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Bubble tea introuvable' });

    await docRef.update(updateFields);
    const updated = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };
    emit(req, 'bubbletea_updated', updated);
    res.json(updated);
  } catch (error) {
    console.error('updateBubbleTea error:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

// DELETE /api/bubble-teas/:id
exports.deleteBubbleTea = async (req, res) => {
  try {
    const docRef = bubbleTeasCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Bubble tea introuvable' });

    await docRef.delete();
    emit(req, 'bubbletea_deleted', { id: req.params.id, _id: req.params.id });
    res.json({ success: true, message: 'Bubble tea supprimé', id: req.params.id });
  } catch (error) {
    console.error('deleteBubbleTea error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// PATCH /api/bubble-teas/:id/toggle-availability
exports.toggleBubbleTeaAvailability = async (req, res) => {
  try {
    const docRef = bubbleTeasCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) return res.status(404).json({ message: 'Bubble tea introuvable' });

    const isAvailable = !existing.data().isAvailable;
    await docRef.update({ isAvailable, updatedAt: new Date() });
    const updated = { id: docRef.id, _id: docRef.id, ...existing.data(), isAvailable };
    emit(req, 'bubbletea_updated', updated);
    res.json(updated);
  } catch (error) {
    console.error('toggleBubbleTeaAvailability error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};
