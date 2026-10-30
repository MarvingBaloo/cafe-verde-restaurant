// backend/server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");

// Charger les variables d'environnement AVANT les require ci-dessous :
// paymentController instancie Stripe avec process.env.STRIPE_SECRET_KEY dès son chargement.
dotenv.config();

// Importation des fichiers de routes standardisées
const ingredientRoutes = require('./routes/ingredientRoutes');
const dishRoutes = require('./routes/dishRoutes');
const bubbleTeaRoutes = require('./routes/bubbleTeaRoutes');
const milkshakeRoutes = require('./routes/milkshakeRoutes');
const productRoutes = require('./routes/productRoutes');
const productCategoryRoutes = require('./routes/productCategoryRoutes');
const configRoutes = require('./routes/configRoutes');
const settingRoutes = require('./routes/settingRoutes');
const orderRoutes = require('./routes/orderRoutes');
const menuRoutes = require('./routes/menuRoutes');
const formulaRoutes = require('./routes/formulaRoutes');
const aiRoutes = require('./routes/aiRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const devRoutes = require('./routes/devRoutes');
const { stripeWebhook } = require('./controllers/paymentController');
const { enrichActivity } = require('./services/activityEnrichment');

// Importation des utilitaires de gestion d'erreurs
const { errorHandler, notFoundHandler, requestLogger } = require('./utils/errorHandler');

// --- Configuration initiale ---
require('./config/firebase'); // Init Firebase Storage (plante au démarrage si mal configuré)

const app = express();
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json());

// Servir les fichiers statiques (images uploadées)
app.use('/uploads', express.static('uploads'));

// CONFIGURATION CORS CENTRALISÉE
// On définit l'URL exacte du frontend. Pas de wildcard "*" ici.
const allowedOrigins = [
  "http://localhost:5173", 
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176"
];

const corsOptions = {
  origin: true, // Renvoie dynamiquement l'origine exacte de la requête
  credentials: true, // Autorise les cookies/auth headers
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
};

// Application du CORS pour Express (HTTP)
app.use(cors(corsOptions));

// Middleware de logging des requêtes
app.use(requestLogger);

// --- Configuration du serveur HTTP et de Socket.io ---
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true, // Doit correspondre exactement à l'option HTTP
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  },
  // Configuration additionnelle pour éviter les problèmes de connexion
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// IMPORTANT : On rend 'io' accessible partout
app.set('socketio', io);

// --- Routes de l'API ---
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/dishes', dishRoutes);
app.use('/api/bubble-teas', bubbleTeaRoutes);
app.use('/api/milkshakes', milkshakeRoutes);
app.use('/api/products',          productRoutes);
app.use('/api/product-categories', productCategoryRoutes);
app.use('/api/config', configRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/menus', menuRoutes);
app.use('/api/formulas', formulaRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dev',         devRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payment', paymentRoutes);

app.get('/', (req, res) => {
  res.send('API en cours d\'exécution...');
});

// Handler pour routes non trouvées (DOIT être après toutes les routes)
app.use(notFoundHandler);

// --- Gestion des événements Socket.io ---
io.on('connection', (socket) => {
  console.log(`🔌 Client connecté via WebSocket : ${socket.id}`);
  
  // Tracking d'activité en temps réel
  socket.on('track_activity', async (activityData) => {
    try {
      // Invisibilité dev : on n'enregistre ni ne diffuse l'activité d'un compte dev
      if (activityData?.user) {
        const { findById } = require('./models/User');
        const actor = await findById(activityData.user);
        if (actor?.role === 'dev') return;
      }

      const analyticsService = require('./services/analyticsService');
      const activity = await analyticsService.logActivity(activityData);
      if (!activity) return; // logActivity a déjà loggé l'erreur
      
      // Logs de débogage
      console.log(`📊 Activité reçue: ${activity.eventType} depuis socket ${socket.id}`);
      console.log(`👥 Super admins dans room 'superadmin-room': ${io.sockets.adapter.rooms.get('superadmin-room')?.size || 0}`);

      // Enrichissement (texte lisible, icône, couleur, infos user) — partagé avec l'historique
      const payload = await enrichActivity(activity);

      // Broadcast aux super admins connectés pour mise à jour en temps réel
      io.to('superadmin-room').emit('new_activity', payload);

      console.log(`📤 Broadcast envoyé à superadmin-room: ${activity.eventType}`);
      console.log(`ℹ️ Données: ${JSON.stringify(activity.eventData || {})}`);
      
    } catch (error) {
      console.error('❌ Erreur tracking Socket.io:', error);
      console.error('❌ Données reçues:', activityData);
    }
  });
  
  // Permettre aux super admins de rejoindre la room de notifications
  socket.on('join_superadmin', () => {
    socket.join('superadmin-room');
    console.log(`👑 Super Admin rejoint la room de monitoring (${socket.id})`);
  });
  
  socket.on('disconnect', () => {
    console.log(`❌ Client déconnecté : ${socket.id}`);
  });
});

// Middleware global de gestion d'erreurs (DOIT être après toutes les routes et avant le démarrage)
app.use(errorHandler);

// --- Démarrage du serveur ---
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Serveur en écoute sur le port ${PORT}`);
  console.log(`🛡️  CORS autorisé pour : ${allowedOrigins.join(', ')}`);
});

// --- Commandes programmées (payées d'avance pour le lendemain) ---
// Elles doivent apparaître en cuisine à leur heure, sans que personne n'ait à recharger.
// Une minuterie suffit : tant qu'un KDS ou une caisse est ouvert, le socket maintient
// l'instance Cloud Run vivante. Instance endormie = personne en cuisine, et la libération
// se fera au premier chargement de la liste des commandes (voir getOrders).
const { promoteScheduledOrders } = require('./controllers/orderController');
const SCHEDULED_SWEEP_MS = 5 * 60 * 1000;
setInterval(() => { promoteScheduledOrders(io); }, SCHEDULED_SWEEP_MS).unref();