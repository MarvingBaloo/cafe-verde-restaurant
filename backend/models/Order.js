// backend/models/Order.js
// Couche d'accès Firestore pour la collection "orders".

const { orders: ordersCol } = require('../config/firestore');

// 'open' = ticket ouvert mis en attente, pas encore envoyé au KDS.
// ⚠️ Liste DUPLIQUÉE dans validators/orderValidator.js — toute modification va aux deux endroits.
// 'scheduled' = commande payée d'avance pour un service à venir : hors KDS jusqu'à l'heure de sortie.
const VALID_STATUSES = ['open', 'scheduled', 'pending', 'preparing', 'ready', 'delivered', 'cancelled', 'refunded'];

function formatOrder(doc) {
  return { id: doc.id, _id: doc.id, ...doc.data() };
}

/** Convertit un Timestamp Firestore ou Date JS en millisecondes (pour tri en mémoire). */
function toMs(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (val instanceof Date) return val.getTime();
  return 0;
}

/** Toutes les commandes, triées par createdAt décroissant. */
async function findAll() {
  const snap = await ordersCol.get();
  return snap.docs.map(formatOrder).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

/** Commandes d'un utilisateur, triées par createdAt décroissant. */
async function findByUser(userId) {
  const snap = await ordersCol.where('user', '==', userId).get();
  return snap.docs.map(formatOrder).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

/** Une commande par ID Firestore. Retourne null si inexistante. */
async function findById(id) {
  const doc = await ordersCol.doc(id).get();
  if (!doc.exists) return null;
  return formatOrder(doc);
}

module.exports = { ordersCol, VALID_STATUSES, formatOrder, toMs, findAll, findByUser, findById };
