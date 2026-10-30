// Crée (une fois) un lecteur Stripe Terminal SIMULÉ sur le compte de TEST, pour dérouler en local
// tous les comportements du TPE (attente, annulation, refus, PIN) sans S710 physique.
//
//   node backend/scripts/createSimulatedReader.js
//
// Puis, dans backend/.env (local uniquement) :
//   STRIPE_TERMINAL_READER_ID=<tmr_… affiché>
//   STRIPE_TERMINAL_SIMULATED=true
//
// Refuse de tourner avec une clé live : un lecteur simulé n'existe qu'en mode test.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const key = process.env.STRIPE_SECRET_KEY || '';
if (!key.startsWith('sk_test_')) {
  console.error('Clé Stripe de TEST requise (sk_test_…) — rien n\'a été créé.');
  process.exit(1);
}
const stripe = require('stripe')(key);

(async () => {
  const existing = await stripe.terminal.readers.list({ device_type: 'simulated_wisepos_e', limit: 10 });
  if (existing.data.length) {
    console.log(`Lecteur simulé déjà présent : ${existing.data[0].id}`);
    return;
  }
  const location = await stripe.terminal.locations.create({
    display_name: 'Café Verdé — caisse locale (test)',
    address: { line1: 'Test', city: 'Pointe-à-Pitre', postal_code: '97110', country: 'FR' },
  });
  const reader = await stripe.terminal.readers.create({
    registration_code: 'simulated-wpe',
    label: 'TPE simulé (local)',
    location: location.id,
  });
  console.log(`Lecteur simulé créé : ${reader.id}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
