const admin = require('firebase-admin');

const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'cafe-verde-prod.firebasestorage.app';

// Mode 1 — Cloud Run : K_SERVICE est injecté automatiquement par Google Cloud Run.
// ADC (Application Default Credentials) résout les credentials via le compte de service IAM,
// sans fichier JSON ni variable d'env explicite.
if (process.env.K_SERVICE) {
  console.log('[Firebase] Mode: Cloud Run (ADC via IAM)');
  admin.initializeApp({ storageBucket: STORAGE_BUCKET });

// Mode 2 — Render / autre PaaS : credentials injectés via variable d'environnement.
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.log('[Firebase] Mode: Env var (FIREBASE_SERVICE_ACCOUNT_JSON)');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET
  });

// Mode 3 — Dev local : fichier de clé de service account.
} else {
  let serviceAccount;
  try {
    serviceAccount = require('../firebase-service-account.json');
  } catch {
    throw new Error(
      '[Firebase] No credentials found: not on Cloud Run, ' +
      'FIREBASE_SERVICE_ACCOUNT_JSON not set, and local file missing ' +
      '(backend/firebase-service-account.json introuvable).'
    );
  }
  console.log('[Firebase] Mode: Local file (firebase-service-account.json)');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: STORAGE_BUCKET
  });
}

const bucket = admin.storage().bucket();

module.exports = { admin, bucket };
