// backend/config/firestore.js
// Initialise l'instance Firestore et expose une référence par collection.
// firebase.js DOIT avoir été exécuté avant ce module (server.js le garantit).

const admin = require('firebase-admin');
require('./firebase'); // garantit l'initialisation de l'app Firebase Admin

const db = admin.firestore();

const collections = {
  ingredients:           db.collection('ingredients'),
  dishes:                db.collection('dishes'),
  products:              db.collection('products'),
  formulas:              db.collection('formulas'),
  menus:                 db.collection('menus'),
  users:                 db.collection('users'),
  orders:                db.collection('orders'),
  activityLogs:          db.collection('activityLogs'),
  bubbleTeas:            db.collection('bubbleTeas'),
  milkshakes:            db.collection('milkshakes'),
  productCategories:     db.collection('productCategories'),
  settings:              db.collection('settings'),
};

console.log(`[Firestore] Initialized with ${Object.keys(collections).length} collections`);

module.exports = { db, ...collections };
