const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { getHoursConfig } = require('../models/Setting');
const { getOnlineOrderingStatus, closedMessage, validateScheduledPickup } = require('../utils/hours');

// Paiement carte en ligne (client).
// Carte uniquement : `automatic_payment_methods` activait Link et huit moyens à
// redirection (Bancontact, EPS, Klarna, MB Way, Satispay…) sans usage ici, dont
// les iframes bloquaient la confirmation côté navigateur.
const createPaymentIntent = async (req, res) => {
  const { amount, scheduledFor = null } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Montant invalide' });

  // Restaurant fermé : on refuse ICI, avant que la carte du client ne soit sollicitée.
  // Bloquer plus loin (à la création de la commande) débiterait un client dont la
  // commande serait ensuite refusée — l'encaissement orphelin qu'on connaît déjà.
  // Ne concerne que le paiement en ligne : le terminal de caisse a ses propres routes.
  const hoursConfig = await getHoursConfig();
  if (scheduledFor) {
    // Commande à l'avance : c'est justement parce que c'est fermé qu'elle existe.
    // Le créneau est revalidé ici ET à la création de la commande : ce premier contrôle
    // évite de débiter quelqu'un pour un créneau que le serveur refusera ensuite.
    const check = validateScheduledPickup(hoursConfig, scheduledFor, new Date());
    if (!check.ok) return res.status(400).json({ message: check.message });
  } else {
    const status = getOnlineOrderingStatus(hoursConfig, new Date());
    if (!status.open) {
      return res.status(503).json({ message: closedMessage(status), closed: true, status });
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: 'eur',
    payment_method_types: ['card'],
  });
  res.json({ clientSecret: paymentIntent.client_secret });
};

// --- Terminal Stripe (S710) — intégration server-driven ---
// Le backend pilote le lecteur via son readerId ; la caisse ne fait que déclencher
// puis interroger le statut. Le montant s'affiche sur le S710 dès `processPaymentIntent`.

// Le lecteur ne traite qu'une action à la fois : une action fantôme (caisse fermée en pleine
// transaction, navigateur rafraîchi) bloquerait tout paiement suivant. On purge sans état d'âme,
// l'absence d'action en cours faisant lever une erreur qu'on ignore.
const clearReaderAction = async (readerId) => {
  try { await stripe.terminal.readers.cancelAction(readerId); } catch { /* rien en cours */ }
};

// Métadonnées Stripe : uniquement des chaînes non vides, sinon l'API rejette la création.
const cleanMetadata = (meta) => Object.entries(meta || {}).reduce((acc, [k, v]) => {
  if (v !== undefined && v !== null && String(v) !== '') acc[k] = String(v).slice(0, 500);
  return acc;
}, {});

// TPE simulé (local) : lecteur simulé du compte de TEST, piloté depuis la caisse par
// `simulateTerminalCard`. Jamais actif avec une clé live, quoi que dise la variable.
const simulatorEnabled = () =>
  process.env.STRIPE_TERMINAL_SIMULATED === 'true' && (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');

// Cartes de test Stripe : le lecteur simulé réagit comme un vrai TPE.
const SIMULATED_CARDS = { pay: '4242424242424242', decline: '4000000000000002' };

// Envoie un montant au lecteur : crée un PaymentIntent card_present (capture manuelle)
// puis demande au reader de le collecter. En mode simulé, le montant attend la carte comme
// sur le vrai TPE, jusqu'à ce que la caisse choisisse l'issue (cf. simulateTerminalCard).
const collectTerminalPayment = async (req, res) => {
  const { amount, metadata } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Montant invalide' });
  const readerId = process.env.STRIPE_TERMINAL_READER_ID;
  if (!readerId) return res.status(500).json({ message: 'STRIPE_TERMINAL_READER_ID non configuré' });
  try {
    await clearReaderAction(readerId);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      payment_method_types: ['card_present'],
      capture_method: 'manual',
      // Sans elles, un paiement retrouvé chez Stripe (capture tardive, rapprochement compta)
      // n'est rattachable à aucune commande.
      metadata: cleanMetadata({ source: 'caisse', ...(metadata || {}) }),
    });
    await stripe.terminal.readers.processPaymentIntent(readerId, { payment_intent: paymentIntent.id });
    res.json({ paymentIntentId: paymentIntent.id });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Erreur terminal' });
  }
};

// Statut du paiement en cours — la caisse poll jusqu'à `requires_capture` (client a payé).
// ⚠️ On remonte AUSSI le statut de l'action du lecteur, et c'est lui qui fait foi pour l'échec :
// un refus de carte intermédiaire (sans contact refusé, « PIN requis »…) remplit
// `last_payment_error` alors que le lecteur poursuit son flux et redemande la carte. Sortir sur
// cette erreur, c'est abandonner une transaction que le client va réussir quelques secondes plus
// tard — et laisser une autorisation à capturer à la main. Seul `action.status === 'failed'`
// est définitif.
const getTerminalPaymentStatus = async (req, res) => {
  const { paymentIntentId } = req.query;
  if (!paymentIntentId) return res.status(400).json({ message: 'paymentIntentId requis' });
  const readerId = process.env.STRIPE_TERMINAL_READER_ID;
  try {
    // Les deux lectures sont indépendantes : en série, leurs allers-retours s'additionnent à
    // chaque tour de polling. Le lecteur injoignable ne doit pas faire échouer l'ensemble.
    const [paymentIntent, reader] = await Promise.all([
      stripe.paymentIntents.retrieve(paymentIntentId),
      readerId ? stripe.terminal.readers.retrieve(readerId).catch(() => null) : null,
    ]);
    let readerStatus = null;
    let failureMessage = null;
    const action = reader?.action;
    // L'action ne nous renseigne que si elle porte bien NOTRE PaymentIntent : le champ est
    // tantôt un id, tantôt l'objet développé selon la version d'API.
    const actionPi = action?.process_payment_intent?.payment_intent;
    if (action && (actionPi === paymentIntentId || actionPi?.id === paymentIntentId)) {
      readerStatus = action.status; // in_progress | succeeded | failed
      failureMessage = action.failure_message || null;
    }
    // Le code est stable, le message est reformulable côté Stripe : la caisse traduit sur le code.
    const lastError = paymentIntent.last_payment_error;
    res.json({
      status: paymentIntent.status,
      readerStatus,
      failureMessage,
      error: lastError?.message || null,
      errorCode: lastError?.decline_code || lastError?.code || null,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Capture le paiement une fois collecté (statut requires_capture → succeeded).
const captureTerminalPayment = async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) return res.status(400).json({ message: 'paymentIntentId requis' });
  try {
    const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
    res.json({ success: true, status: paymentIntent.status });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Annule la transaction en cours (le caissier abandonne) : action du reader puis le PI.
// Cas délicat : le client a pu payer entre l'affichage de l'erreur et le clic sur « Annuler ».
// On ne tranche alors PAS à sa place — on libère le lecteur et on remonte `already_paid` pour
// que la caissière choisisse (encaisser la commande ou relâcher l'autorisation), `force`
// portant sa décision d'annuler quand même.
const cancelTerminalPayment = async (req, res) => {
  const readerId = process.env.STRIPE_TERMINAL_READER_ID;
  const { paymentIntentId, force } = req.body;
  try {
    if (readerId) await clearReaderAction(readerId);
    if (!paymentIntentId) return res.json({ success: true, outcome: 'cancelled' });
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status === 'requires_capture' && !force) {
      return res.json({
        success: true,
        outcome: 'already_paid',
        paymentIntentId,
        amount: paymentIntent.amount / 100,
      });
    }
    // `succeeded` (déjà capturé) et `canceled` n'ont plus rien à annuler.
    if (!['succeeded', 'canceled'].includes(paymentIntent.status)) {
      await stripe.paymentIntents.cancel(paymentIntentId).catch(() => {});
    }
    res.json({ success: true, outcome: 'cancelled' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Pourboires encaissés au terminal sur une période.
// Le S710 collecte le pourboire lui-même (réglage du lecteur) : ni la caisse ni la
// commande Firestore n'en gardent trace, seul `amount_details.tip` du PaymentIntent
// le porte. On lit donc directement chez Stripe — rien n'est stocké de notre côté,
// ce qui rend le rapport exact et rétroactif sur tout l'historique.
const MAX_TIP_PAGES = 50; // garde-fou : 5 000 paiements max par période interrogée

const getTips = async (req, res) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  // Mêmes bornes que la compta : les jours reçus désignent des journées en heure
  // Guadeloupe (UTC−4), pas en UTC — sinon décalage d'un jour sur les extrémités.
  const from = req.query.from ? new Date(req.query.from + 'T00:00:00.000-04:00') : defaultFrom;
  const to   = req.query.to   ? new Date(req.query.to   + 'T23:59:59.999-04:00') : defaultTo;
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ message: 'Période invalide' });
  }

  try {
    const byDay = {};
    const byIntent = {}; // pi_xxx → pourboire, pour rattacher chaque commande à sa transaction
    let total = 0, tipCount = 0, paymentsCount = 0, truncated = false;
    let startingAfter = null;

    // Stripe ne sait pas filtrer sur le pourboire : on parcourt la période entière.
    for (let page = 0; page < MAX_TIP_PAGES; page++) {
      const params = {
        limit: 100,
        created: { gte: Math.floor(from.getTime() / 1000), lte: Math.floor(to.getTime() / 1000) },
      };
      if (startingAfter) params.starting_after = startingAfter;
      const batch = await stripe.paymentIntents.list(params);

      for (const pi of batch.data) {
        if (pi.status !== 'succeeded') continue;
        paymentsCount++;
        const tip = pi.amount_details?.tip?.amount || 0;
        if (!tip) continue;
        tipCount++;
        total += tip;
        byIntent[pi.id] = tip / 100;
        const day = new Date(pi.created * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Guadeloupe' });
        byDay[day] = (byDay[day] || 0) + tip;
      }

      startingAfter = batch.data.length ? batch.data[batch.data.length - 1].id : null;
      if (!batch.has_more || !startingAfter) break;
      if (page === MAX_TIP_PAGES - 1) truncated = true;
    }

    res.json({
      total: total / 100,
      tipCount,
      paymentsCount,
      truncated,
      byIntent,
      byDay: Object.entries(byDay)
        .map(([day, amount]) => ({ day, amount: amount / 100 }))
        .sort((a, b) => a.day.localeCompare(b.day)),
    });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Erreur Stripe' });
  }
};

const stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.json({ received: true });
  try {
    stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  res.json({ received: true });
};

const getTerminalSimulator = (req, res) => res.json({ enabled: simulatorEnabled() });

// Présente une carte de test au lecteur simulé : le client paie, ou sa carte est refusée.
const simulateTerminalCard = async (req, res) => {
  if (!simulatorEnabled()) return res.status(404).json({ message: 'TPE simulé inactif' });
  const number = SIMULATED_CARDS[req.body?.outcome];
  if (!number) return res.status(400).json({ message: 'Issue inconnue' });
  try {
    await stripe.testHelpers.terminal.readers.presentPaymentMethod(process.env.STRIPE_TERMINAL_READER_ID, {
      type: 'card_present', card_present: { number },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Simulation impossible' });
  }
};

module.exports = {
  createPaymentIntent,
  getTerminalSimulator,
  simulateTerminalCard,
  collectTerminalPayment,
  getTerminalPaymentStatus,
  captureTerminalPayment,
  cancelTerminalPayment,
  getTips,
  stripeWebhook,
};
