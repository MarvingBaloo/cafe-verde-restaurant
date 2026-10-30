// backend/seeder.js
const dotenv = require('dotenv');
const colors = require('colors');

// dotenv en premier pour que firebase.js lise les variables d'env si besoin
dotenv.config();

const { db } = require('./config/firestore');

// === PLATS CHAUDS ANTILLAIS ===
const dishesData = [
  {
    name: 'Colombo de Poulet',
    description: 'Poulet mariné aux épices antillaises, légumes mijotés et bouillon parfumé.',
    price: 12.50,
    image: '',
    category: 'hot_dish',
    sides: [
      { name: 'Riz blanc', priceAddition: 0 },
      { name: 'Plantain', priceAddition: 1.50 },
      { name: 'Patate douce', priceAddition: 1.00 }
    ],
    maxSides: 1,
    dietaryTags: ['épicé'],
    isAvailable: true
  },
  {
    name: 'Poulet Boucané',
    description: 'Poulet fumé au bois de goyavier, accompagné de sauce chien maison.',
    price: 11.00,
    image: '',
    category: 'hot_dish',
    sides: [
      { name: 'Riz blanc', priceAddition: 0 },
      { name: 'Plantain', priceAddition: 1.50 },
      { name: 'Salade verte', priceAddition: 1.50 }
    ],
    maxSides: 2,
    dietaryTags: ['épicé', 'sans gluten'],
    isAvailable: true
  },
  {
    name: 'Bokit Crevettes',
    description: 'Pain traditionnel guadeloupéen frit, garni de crevettes marinées.',
    price: 9.50,
    image: '',
    category: 'hot_dish',
    sides: [
      { name: 'Frites', priceAddition: 2.00 },
      { name: 'Salade', priceAddition: 1.00 }
    ],
    maxSides: 1,
    dietaryTags: [],
    isAvailable: true
  },
  {
    name: 'Court-Bouillon de Poisson',
    description: 'Poisson frais cuit dans une sauce tomate épicée aux herbes des Antilles.',
    price: 13.50,
    image: '',
    category: 'hot_dish',
    sides: [
      { name: 'Riz créole', priceAddition: 0 },
      { name: 'Plantain', priceAddition: 1.50 }
    ],
    maxSides: 1,
    dietaryTags: ['sans gluten'],
    isAvailable: true
  }
];

// ─── Helpers Firestore pour les ingrédients ──────────────────────────────────

/** Supprime tous les documents d'une collection Firestore (par lots de 500). */
async function deleteFirestoreCollection(collectionRef) {
  const snap = await collectionRef.get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

/** Insère des documents dans une collection Firestore en un seul batch. */
async function insertFirestoreCollection(collectionRef, docs) {
  const batch = db.batch();
  docs.forEach(doc => {
    const docRef = collectionRef.doc();
    batch.set(docRef, { ...doc, createdAt: new Date(), updatedAt: new Date() });
  });
  await batch.commit();
}

// ─────────────────────────────────────────────────────────────────────────────

const importData = async () => {
  try {
    // 1. Nettoyage complet
    await deleteFirestoreCollection(db.collection('ingredients')); // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('products'));    // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('formulas'));    // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('menus'));       // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('users'));       // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('dishes'));      // Firestore (Phase F2)

    console.log('🧹 Nettoyage terminé.'.cyan);

    // 2. Création des Utilisateurs (profils Firestore — passwords gérés par Firebase Auth)
    const usersData = [
      { name: 'Gérant',        email: 'gerant@admin.com',      role: 'admin',   isAdmin: true,  loyaltyPoints: 9999 },
      { name: 'Manager Staff', email: 'manager@admin.com',     role: 'admin',   isAdmin: true,  loyaltyPoints: 0    },
      { name: 'Client Test',   email: 'client@test.com',       role: 'client',  isAdmin: false, loyaltyPoints: 10   },
      { name: 'Cuisine',       email: 'cuisine@cafeverde.com', role: 'kitchen', isAdmin: false, loyaltyPoints: 0    },
    ];

    await insertFirestoreCollection(db.collection('users'), usersData);

    console.log('👤 Comptes créés : Gérant, Manager, Client, Cuisine'.blue);

    // 3. Création des Données (Formules, Menus...)

    // === FORMULES ===
    const formulas = [
      // === FORMULES SALADE ===
      {
        name: "L'Essentiel",
        type: 'salad',
        base_price: 12.90,
        image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=2080&auto=format&fit=crop',
        limits: { base: 1, protein: 1, topping: 3, sauce: 1 },
        extra_cost_per_component: 1.5
      },
      {
        name: 'La Gourmande',
        type: 'salad',
        base_price: 15.90,
        image: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?q=80&w=2070&auto=format&fit=crop',
        limits: { base: 1, protein: 1, topping: 5, sauce: 2 },
        extra_cost_per_component: 1.5
      },
      {
        name: 'La Royale',
        type: 'salad',
        base_price: 19.90,
        image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=2070&auto=format&fit=crop',
        limits: { base: 1, protein: 2, topping: 6, sauce: 2 },
        extra_cost_per_component: 1.5
      },

    ];

    const menus = [
      { name: 'Solo', price_addition: 0, includes: {} }, 
      { name: 'Menu L', price_addition: 3, includes: { drink: true, dessert: true } }, 
      { name: 'Menu XL', price_addition: 5, includes: { drink: true, dessert: true } }, 
    ];

    // === INGRÉDIENTS ===
    const ingredients = [
      // SALADE
      { 
        name: 'Riz Vinaigré', 
        category: 'base_salade', 
        image: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 130, proteins: 2.5, carbs: 28, fat: 0.3 },
        tags: ['neutre', 'base', 'rassasiant', 'japonais']
      },
      { 
        name: 'Salade Batignolle', 
        category: 'base_salade', 
        image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 15, proteins: 1.5, carbs: 2.5, fat: 0.2 },
        tags: ['frais', 'léger', 'croquant', 'vert', 'base']
      },
      { 
        name: 'Saumon Mariné', 
        category: 'proteine', 
        is_premium: true, 
        extra_price: 1, 
        image: 'https://images.unsplash.com/photo-1632808420601-576f70932826?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 150, proteins: 20, carbs: 0, fat: 8 },
        tags: ['protéine', 'poisson', 'premium', 'omega3', 'savoureux']
      },
      { 
        name: 'Poulet Croustillant', 
        category: 'proteine', 
        image: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 165, proteins: 25, carbs: 5, fat: 6 },
        tags: ['protéine', 'viande', 'croquant', 'rassasiant', 'populaire']
      },
      { 
        name: 'Avocat', 
        category: 'topping_legume', 
        is_premium: true, 
        extra_price: 1, 
        image: 'https://images.unsplash.com/photo-1601039641847-7857b994d704?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 120, proteins: 1.5, carbs: 6, fat: 11 },
        tags: ['crémeux', 'premium', 'sain', 'gras-sain', 'onctueux']
      },
      { 
        name: 'Mangue', 
        category: 'topping_fruit', 
        image: 'https://images.unsplash.com/photo-1553279768-865429fa0078?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 60, proteins: 0.8, carbs: 15, fat: 0.4 },
        tags: ['fruité', 'sucré', 'exotique', 'vitaminé', 'juteux']
      },
      { 
        name: 'Sauce Soja Sésame', 
        category: 'sauce',
        image: 'https://images.unsplash.com/photo-1602087933828-49f5de68845d?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 45, proteins: 1, carbs: 3, fat: 3.5 },
        tags: ['salé', 'umami', 'asiatique', 'sésame', 'savoureux']
      },
      { 
        name: 'Spicy Mayo', 
        category: 'sauce',
        image: 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?q=80&w=800&auto=format&fit=crop',
        nutritional_info: { calories: 90, proteins: 0.5, carbs: 1, fat: 10 },
        tags: ['épicé', 'crémeux', 'relevé', 'mayo', 'audacieux']
      },

    ];

    const products = [
      { 
        name: 'Coca Zéro', 
        category: 'drink', 
        price: 2.50,
        nutritional_info: { calories: 0, proteins: 0, carbs: 0, fat: 0 },
        tags: ['boisson', 'zéro-sucre', 'pétillant']
      },
      { 
        name: 'Cookie Choco', 
        category: 'dessert', 
        price: 3.00,
        nutritional_info: { calories: 210, proteins: 2.5, carbs: 28, fat: 10 },
        tags: ['sucré', 'chocolat', 'gourmand']
      },
    ];

    await insertFirestoreCollection(db.collection('formulas'), formulas);       // Firestore (Phase F2)
    await insertFirestoreCollection(db.collection('menus'), menus);             // Firestore (Phase F2)
    await insertFirestoreCollection(db.collection('ingredients'), ingredients); // Firestore (Phase F2)
    await insertFirestoreCollection(db.collection('products'), products);       // Firestore (Phase F2)
    await insertFirestoreCollection(db.collection('dishes'), dishesData);        // Firestore (Phase F2)

    console.log(`📋 ${formulas.length} formules créées dans Firestore.`.green);
    console.log(`🍽️  ${menus.length} menus créés dans Firestore.`.green);
    console.log(`🥗 ${ingredients.length} ingrédients créés dans Firestore.`.green);
    console.log(`🛍️  ${products.length} produits créés dans Firestore.`.green);
    console.log(`🍱 ${dishesData.length} plats antillais créés dans Firestore.`.green);
    console.log('✅ Données importées avec succès !'.green.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ Erreur: ${error}`.red.inverse);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await deleteFirestoreCollection(db.collection('ingredients')); // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('products'));    // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('formulas'));    // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('menus'));       // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('users'));       // Firestore (Phase F2)
    await deleteFirestoreCollection(db.collection('dishes'));      // Firestore (Phase F2)

    console.log('🗑️  Données supprimées !'.red.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ Erreur: ${error}`.red.inverse);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}