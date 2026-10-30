// backend/controllers/devController.js
// Toutes ces actions supposent un demandeur de rôle 'dev' (garanti par devOnly).
const asyncHandler = require('express-async-handler');
const { admin } = require('../config/firebase');
const {
  ingredients: ingredientsCol,
  products: productsCol,
  formulas: formulasCol,
  menus: menusCol,
  dishes: dishesCol,
  users: usersCol,
  orders: ordersCol,
  activityLogs: activityLogsCol,
} = require('../config/firestore');
const { findAll, findByEmail, findById } = require('../models/User');
const Stripe = require('stripe');
const { getTaxConfig } = require('../models/Setting.js');
const { buildOrderTax } = require('../utils/tax');
const { allocateOrderNumber } = require('../utils/orderNumber');
const { paymentIntentIdsOf } = require('../utils/cardPayments');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const VALID_ROLES = ['client', 'admin', 'superadmin', 'kitchen', 'dev'];

const sendSuccess = (res, data, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

const isAdminFromRole = (role) =>
  role === 'admin' || role === 'superadmin' || role === 'dev';

// Collections sauvegardées ET restaurables (les 8)
const BACKUP_COLLECTIONS = {
  ingredients: ingredientsCol,
  products: productsCol,
  formulas: formulasCol,
  menus: menusCol,
  dishes: dishesCol,
  users: usersCol,
  orders: ordersCol,
  activityLogs: activityLogsCol,
};

// Collections que le mode 'replace' peut purger (jamais users)
const REPLACEABLE = ['ingredients', 'products', 'formulas', 'menus', 'dishes', 'orders', 'activityLogs'];

/**
 * @desc    Créer un compte de n'importe quel rôle (avec login Firebase Auth)
 * @route   POST /api/dev/users
 * @access  Dev
 */
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    res.status(400);
    throw new Error('Nom, email, mot de passe et rôle requis');
  }
  if (!VALID_ROLES.includes(role)) {
    res.status(400);
    throw new Error('Rôle invalide');
  }

  const existingEmail = await findByEmail(email);
  if (existingEmail) {
    res.status(400);
    throw new Error('Cet email est déjà utilisé');
  }

  // 1. Créer le compte Firebase Auth
  const fbUser = await admin.auth().createUser({
    email: email.toLowerCase().trim(),
    password,
    displayName: name,
  });

  // 2. Custom claim si dev
  if (role === 'dev') {
    await admin.auth().setCustomUserClaims(fbUser.uid, { role: 'dev' });
  }

  // 3. Doc Firestore
  const userData = {
    name: name.trim(),
    email: email.toLowerCase().trim(),
    phone: null,
    firebaseUid: fbUser.uid,
    role,
    isAdmin: isAdminFromRole(role),
    loyaltyPoints: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const docRef = await usersCol.add(userData);
  const user = { id: docRef.id, _id: docRef.id, ...userData };

  const io = req.app.get('socketio');
  if (io) io.emit('user_updated', { id: docRef.id, ...userData });

  sendSuccess(res, user, 'Compte créé', 201);
});

/**
 * @desc    Lister TOUS les comptes (dev inclus)
 * @route   GET /api/dev/users
 * @access  Dev
 */
const listUsers = asyncHandler(async (req, res) => {
  const users = await findAll();
  sendSuccess(res, users);
});

/**
 * @desc    Éditer un compte (name/email/role/loyaltyPoints)
 * @route   PUT /api/dev/users/:id
 * @access  Dev
 */
const updateUser = asyncHandler(async (req, res) => {
  const { name, email, role, loyaltyPoints } = req.body;
  const docRef = usersCol.doc(req.params.id);
  const existing = await docRef.get();

  if (!existing.exists) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }
  const current = existing.data();

  // Anti-lockout : un dev ne peut pas modifier son propre rôle (risque de se retirer l'accès)
  const requesterId = req.user._id || req.user.id;
  if (role && req.params.id === requesterId && role !== current.role) {
    res.status(400);
    throw new Error('Vous ne pouvez pas modifier votre propre rôle');
  }

  if (email && email.toLowerCase().trim() !== (current.email || '')) {
    const taken = await findByEmail(email);
    if (taken && taken._id !== req.params.id) {
      res.status(400);
      throw new Error('Cet email est déjà utilisé');
    }
  }

  const updateFields = { updatedAt: new Date() };
  if (name) updateFields.name = name.trim();
  if (email) updateFields.email = email.toLowerCase().trim();
  if (role) {
    if (!VALID_ROLES.includes(role)) {
      res.status(400);
      throw new Error('Rôle invalide');
    }
    updateFields.role = role;
    updateFields.isAdmin = isAdminFromRole(role);
  }
  if (loyaltyPoints !== undefined) updateFields.loyaltyPoints = loyaltyPoints;

  // Synchroniser le custom claim si le rôle change vers/depuis dev
  if (role && current.firebaseUid) {
    try {
      if (role === 'dev') {
        await admin.auth().setCustomUserClaims(current.firebaseUid, { role: 'dev' });
      } else if (current.role === 'dev') {
        await admin.auth().setCustomUserClaims(current.firebaseUid, null);
      }
    } catch (err) {
      console.error('⚠️ setCustomUserClaims échec:', err.message);
    }
  }

  await docRef.update(updateFields);
  const updated = { id: req.params.id, _id: req.params.id, ...current, ...updateFields };

  const io = req.app.get('socketio');
  if (io) io.emit('user_updated', { id: req.params.id, ...current, ...updateFields });

  sendSuccess(res, updated, 'Compte mis à jour');
});

/**
 * @desc    Supprimer un compte (Firestore + Firebase Auth best-effort)
 * @route   DELETE /api/dev/users/:id
 * @access  Dev
 */
const deleteUser = asyncHandler(async (req, res) => {
  const requesterId = req.user._id || req.user.id;
  if (req.params.id === requesterId) {
    res.status(400);
    throw new Error('Vous ne pouvez pas supprimer votre propre compte');
  }

  const docRef = usersCol.doc(req.params.id);
  const existing = await docRef.get();
  if (!existing.exists) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }
  const data = existing.data();

  if (data.firebaseUid) {
    try {
      await admin.auth().deleteUser(data.firebaseUid);
    } catch (err) {
      console.error('⚠️ Suppression Firebase Auth échouée:', err.message);
    }
  }

  await docRef.delete();

  const io = req.app.get('socketio');
  if (io) io.emit('user_deleted', { id: req.params.id });

  sendSuccess(res, null, 'Compte supprimé');
});

/**
 * @desc    Backup : dump JSON des 8 collections
 * @route   GET /api/dev/backup
 * @access  Dev
 */
const backup = asyncHandler(async (req, res) => {
  const result = {};
  for (const [name, col] of Object.entries(BACKUP_COLLECTIONS)) {
    const snap = await col.get();
    result[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    collections: result,
  };

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="backup-${date}.json"`);
  res.status(200).send(JSON.stringify(payload, null, 2));
});

/**
 * @desc    Restore : ré-injecte un backup (UPSERT par défaut, users jamais purgés)
 * @route   POST /api/dev/restore
 * @access  Dev
 */
const restore = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const collections = body.collections;
  const mode = body.mode === 'replace' ? 'replace' : 'upsert';

  if (!collections || typeof collections !== 'object') {
    res.status(400);
    throw new Error('Backup invalide : champ "collections" manquant');
  }

  const summary = {};

  for (const [name, col] of Object.entries(BACKUP_COLLECTIONS)) {
    const docs = Array.isArray(collections[name]) ? collections[name] : [];
    const backupIds = new Set(docs.map((d) => d.id).filter(Boolean));

    // Mode replace : purge les docs absents du backup, SAUF users
    if (mode === 'replace' && REPLACEABLE.includes(name)) {
      const snap = await col.get();
      for (const d of snap.docs) {
        if (!backupIds.has(d.id)) {
          await col.doc(d.id).delete();
        }
      }
    }

    // UPSERT par id
    let count = 0;
    for (const doc of docs) {
      if (!doc.id) continue;
      const { id, ...data } = doc;
      await col.doc(id).set(data);
      count++;
    }
    summary[name] = count;
  }

  sendSuccess(res, { mode, summary }, 'Restauration effectuée');
});

/**
 * @desc    Définir/réinitialiser le mot de passe d'un compte (Firebase Auth)
 * @route   PUT /api/dev/users/:id/password
 * @access  Dev
 */
const setPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400);
    throw new Error('Mot de passe requis (6 caractères minimum)');
  }

  const doc = await usersCol.doc(req.params.id).get();
  if (!doc.exists) {
    res.status(404);
    throw new Error('Utilisateur non trouvé');
  }

  const { firebaseUid } = doc.data();
  if (!firebaseUid) {
    res.status(400);
    throw new Error("Ce compte n'a pas de connexion Firebase (créé en caisse) — aucun mot de passe à définir");
  }

  await admin.auth().updateUser(firebaseUid, { password });
  sendSuccess(res, null, 'Mot de passe mis à jour');
});

// --- Réintégration d'un paiement Stripe orphelin ---
// Un paiement encaissé chez Stripe sans commande côté app (capture tardive, caisse tombée entre
// l'autorisation et la capture) fausse le CA et la TVA. On le rapatrie depuis son seul identifiant.
// ⚠️ Le panier n'a JAMAIS transité par Stripe : les articles sont irrécupérables et ne peuvent
// être que reconstitués de mémoire, d'où la possibilité de compléter la commande plus tard.

// Le paymentIntentId vit à plusieurs endroits selon le canal (web / caisse / part d'addition séparée,
// et chaque carte d'un règlement qui en a passé plusieurs au terminal).
// Se fier à un seul champ ferait créer un doublon qui compterait deux fois dans le CA.
const findOrderByPaymentIntent = async (paymentIntentId, aroundDate) => {
  const asOrder = (doc) => ({ id: doc.id, _id: doc.id, ...doc.data() });

  const direct = await ordersCol.where('paymentIntentId', '==', paymentIntentId).limit(1).get();
  if (!direct.empty) return asOrder(direct.docs[0]);

  const nested = await ordersCol.where('paymentDetails.paymentIntentId', '==', paymentIntentId).limit(1).get();
  if (!nested.empty) return asOrder(nested.docs[0]);

  // splitPayments[] est un tableau d'objets : non interrogeable par Firestore. On balaie la
  // fenêtre autour du paiement plutôt que toute la collection.
  const from = new Date(aroundDate); from.setDate(from.getDate() - 2);
  const to = new Date(aroundDate); to.setDate(to.getDate() + 8);
  // Même balayage pour la 2e, 3e… carte passée au terminal sur un même règlement (cardPayments) :
  // seule la première est interrogeable, via `paymentDetails.paymentIntentId`.
  const window = await ordersCol.where('createdAt', '>=', from).where('createdAt', '<=', to).get();
  for (const doc of window.docs) {
    const data = doc.data();
    if (paymentIntentIdsOf(data.paymentDetails).includes(paymentIntentId)) return asOrder(doc);
    const parts = data.splitPayments || [];
    if (parts.some((p) => paymentIntentIdsOf(p).includes(paymentIntentId))) return asOrder(doc);
  }
  return null;
};

// Lignes reconstituées de mémoire : libellé + quantité + prix, taux de TVA facultatif
// (vide = taux du mode de consommation). Le montant Stripe reste seul juge du total.
const normalizeItems = (items) => (Array.isArray(items) ? items : [])
  .map((it) => {
    const name = String(it?.name || '').trim();
    if (!name) return null;
    const quantity = Math.max(1, parseInt(it?.quantity, 10) || 1);
    const price = Math.max(0, parseFloat(it?.price) || 0);
    const rate = parseFloat(it?.taxRate);
    return {
      name: name.slice(0, 120),
      quantity,
      price,
      ...(isNaN(rate) ? {} : { taxRate: rate }),
    };
  })
  .filter(Boolean);

// Comparaison de noms tolérante à la casse et aux accents : « Jean Dupont » == « jean dupont ».
const normName = (s) => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const fetchIntent = async (paymentIntentId) => {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const tip = pi.amount_details?.tip?.amount || 0;
  const card = pi.latest_charge?.payment_method_details?.card_present
    || pi.latest_charge?.payment_method_details?.card
    || null;
  return {
    pi,
    tip: tip / 100,
    // Le pourboire n'est ni du CA ni une base TVA : la commande vaut le paiement moins le tip.
    net: (pi.amount - tip) / 100,
    card,
    // Nom du PORTEUR de la carte, pas du client identifié en caisse : c'est la seule piste
    // pour un paiement d'avant le 15/08/2026, créé sans aucune métadonnée. Suggestion à
    // confirmer par un humain, jamais une vérité — on ne l'écrit pas sans validation.
    cardHolder: card?.cardholder_name || pi.latest_charge?.billing_details?.name || null,
  };
};

const stripePaymentPreview = asyncHandler(async (req, res) => {
  const { paymentIntentId } = req.params;
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
    return res.status(400).json({ message: 'Identifiant invalide (attendu : pi_…)' });
  }
  let data;
  try {
    data = await fetchIntent(paymentIntentId);
  } catch (err) {
    return res.status(404).json({ message: err.message || 'Paiement introuvable chez Stripe' });
  }
  const { pi, tip, net, card, cardHolder } = data;
  const createdAt = new Date(pi.created * 1000);
  const linked = await findOrderByPaymentIntent(pi.id, createdAt);
  sendSuccess(res, {
    paymentIntentId: pi.id,
    status: pi.status,               // succeeded | requires_capture | canceled | …
    amount: pi.amount / 100,
    tip,
    net,
    createdAt,
    metadata: pi.metadata || {},
    cardBrand: card?.brand || null,
    cardLast4: card?.last4 || null,
    cardHolder,
    linkedOrder: linked
      ? { id: linked.id, orderNumber: linked.orderNumber || null, status: linked.status, totalPrice: linked.totalPrice }
      : null,
  });
});

const importOrderFromStripe = asyncHandler(async (req, res) => {
  const { paymentIntentId, items, consumptionMode, customerName, userId, confirmMismatch } = req.body || {};
  if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId || '')) {
    return res.status(400).json({ message: 'Identifiant invalide (attendu : pi_…)' });
  }

  // Rattacher une fiche client est ce qui rend la réintégration complète : sans elle, la vente
  // existe mais le client n'a jamais touché ses points. Un nom seul ne suffit pas.
  let client = null;
  if (userId) {
    client = await findById(userId);
    if (!client) return res.status(404).json({ message: 'Client introuvable.' });
  }

  let data;
  try {
    data = await fetchIntent(paymentIntentId);
  } catch (err) {
    return res.status(404).json({ message: err.message || 'Paiement introuvable chez Stripe' });
  }
  let { pi, tip, net, card } = data;
  const paidAt = new Date(pi.created * 1000);

  const linked = await findOrderByPaymentIntent(pi.id, paidAt);
  if (linked) {
    return res.status(409).json({
      message: `Ce paiement est déjà rattaché à la commande ${linked.orderNumber || linked.id}.`,
    });
  }

  // Seul garde-fou automatique contre un rattachement à un client qui n'était pas là : le nom
  // encaissé en caisse, présent dans les métadonnées depuis le 15/08/2026. « Anonyme » ne dit
  // rien (personne n'était identifié à la vente) et n'empêche donc pas le rattachement.
  // Contrôlé AVANT la capture : refuser après aurait encaissé l'argent pour rien.
  const stripeCustomer = pi.metadata?.customer || null;
  if (client && stripeCustomer && normName(stripeCustomer) !== 'anonyme'
      && normName(stripeCustomer) !== normName(client.name) && !confirmMismatch) {
    return res.status(409).json({
      code: 'name_mismatch',
      message: `Ce paiement a été encaissé pour « ${stripeCustomer} », or vous rattachez « ${client.name} ».`,
      mismatch: { stripeCustomer, selected: client.name },
    });
  }

  // Cas central : le paiement est resté autorisé sans jamais être encaissé. On le capture ici
  // plutôt que d'obliger à passer par le Dashboard Stripe.
  if (pi.status === 'requires_capture') {
    pi = await stripe.paymentIntents.capture(pi.id);
    const refreshed = await fetchIntent(pi.id);
    ({ pi, tip, net, card } = refreshed);
  }
  if (pi.status !== 'succeeded') {
    return res.status(400).json({ message: `Paiement non encaissable (statut Stripe : ${pi.status}).` });
  }
  if (net <= 0) {
    return res.status(400).json({ message: 'Montant net nul : rien à réintégrer.' });
  }

  const taxConfig = await getTaxConfig();
  const mode = ['dineIn', 'takeaway'].includes(consumptionMode) ? consumptionMode : (taxConfig.defaultMode || 'dineIn');
  const products = normalizeItems(items);
  const tax = buildOrderTax({
    products,
    totalPrice: net,
    finalPrice: net,
    consumptionMode: mode,
    config: taxConfig,
  });

  const orderNumber = await allocateOrderNumber('caisse');
  const orderData = {
    user: client ? (client.id || client._id) : null,
    customerName: (customerName && String(customerName).trim())
      || client?.name
      || pi.metadata?.customer
      || 'Réintégration Stripe',
    totalPrice: net,
    finalPrice: net,
    orderNumber,
    paid: true,
    // Date du PAIEMENT, pas de l'import : sinon le CA du jour serait faussé des deux côtés.
    paidAt,
    createdAt: paidAt,
    updatedAt: new Date(),
    formula: null, formulaQuantity: 1, ingredients: [], salads: [], menu: null,
    products, dishes: [], cartProducts: [], bubbleTeas: [], milkshakes: [],
    status: 'delivered',
    cancelType: null, cancelReason: null, cancelledAmount: 0,
    reachedKitchen: false,
    paymentMethod: 'card',
    paymentDetails: { cardAmount: net, paymentIntentId: pi.id, cardBrand: card?.brand || null, cardLast4: card?.last4 || null },
    paymentIntentId: pi.id,
    source: 'stripe_import',
    isSplit: false, splitMode: null, splitCount: null, splitPayments: null,
    pointsRedeemed: 0, discountAmount: 0, manualDiscount: 0, discount: null,
    consumptionMode: mode,
    taxBreakdown: tax.breakdown, totalHT: tax.totalHT, totalTVA: tax.totalTVA,
    serviceRate: taxConfig.serviceRate || 0,
    stripeTip: tip, // hors CA, conservé pour le rapprochement avec le relevé Stripe
    importedBy: req.user?.email || req.user?._id || 'dev',
    importedAt: new Date(),
    // Sur quoi le rattachement s'est appuyé, pour pouvoir l'auditer plus tard : le nom encaissé
    // en caisse (absent avant le 15/08/2026) et le porteur de la carte.
    importSource: {
      stripeCustomer,
      cardHolder: data.cardHolder || null,
      mismatchConfirmed: Boolean(client && stripeCustomer && confirmMismatch
        && normName(stripeCustomer) !== normName(client.name)),
    },
    // Points effectivement crédités par cet import (renseigné plus bas) : sans cette trace,
    // un détachement ultérieur ne saurait pas combien retirer.
    loyaltyCredited: 0,
  };

  const docRef = await ordersCol.add(orderData);

  // Crédit après création : la garde findOrderByPaymentIntent interdit un second import du même
  // paiement, donc pas de double crédit possible. Si l'écriture échoue, la vente reste valide —
  // on le dit franchement plutôt que de laisser croire à un crédit qui n'a pas eu lieu.
  let loyalty = null;
  if (client) {
    const uid = client.id || client._id;
    const pointsEarned = Math.floor(net); // 1 € encaissé = 1 pt, comme une vente en caisse
    try {
      const snap = await usersCol.doc(uid).get();
      const newBalance = (snap.data()?.loyaltyPoints || 0) + pointsEarned;
      await usersCol.doc(uid).update({ loyaltyPoints: newBalance, updatedAt: new Date() });
      await docRef.update({ loyaltyCredited: pointsEarned });
      orderData.loyaltyCredited = pointsEarned;
      loyalty = { pointsEarned, newBalance };
    } catch (err) {
      loyalty = { pointsEarned, failed: true };
    }
  }

  const message = loyalty?.failed
    ? `Commande réintégrée, mais les ${loyalty.pointsEarned} pts n'ont pas pu être crédités — à ajuster dans « Comptes & points ».`
    : loyalty
      ? `Commande réintégrée, +${loyalty.pointsEarned} pts pour ${orderData.customerName}`
      : 'Commande réintégrée';
  sendSuccess(res, { id: docRef.id, _id: docRef.id, ...orderData, loyalty }, message, 201);
});

// Retour ultérieur sur une commande réintégrée : la caissière se souvient du contenu.
// Le montant reste celui du paiement Stripe — les lignes ne sont qu'une reconstitution.
const updateImportedOrderItems = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { items, consumptionMode, customerName, userId, confirmMismatch } = req.body || {};

  const docRef = ordersCol.doc(id);
  const snap = await docRef.get();
  if (!snap.exists) return res.status(404).json({ message: 'Commande introuvable' });

  const order = snap.data();
  if (order.source !== 'stripe_import') {
    return res.status(400).json({ message: 'Seule une commande réintégrée depuis Stripe peut être recomposée.' });
  }

  // userId absent du corps = on ne touche pas au client ; null = détacher ; un id = (re)rattacher.
  const previousUserId = order.user || null;
  const nextUserId = userId === undefined ? previousUserId : (userId || null);
  const clientChanged = nextUserId !== previousUserId;

  let client = null;
  if (nextUserId) {
    client = await findById(nextUserId);
    if (!client) return res.status(404).json({ message: 'Client introuvable.' });

    // Le nom encaissé en caisse vit chez Stripe ; la copie en base n'est qu'une commodité.
    // Le relire couvre aussi les commandes importées avant que l'app ne recopie ce champ.
    // Best-effort : Stripe injoignable ne doit pas bloquer une simple correction de libellé.
    let stripeCustomer = order.importSource?.stripeCustomer || null;
    if (!stripeCustomer && order.paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(order.paymentIntentId);
        stripeCustomer = pi.metadata?.customer || null;
      } catch { /* garde inopérante, jamais bloquante */ }
    }
    if (clientChanged && stripeCustomer && normName(stripeCustomer) !== 'anonyme'
        && normName(stripeCustomer) !== normName(client.name) && !confirmMismatch) {
      return res.status(409).json({
        code: 'name_mismatch',
        message: `Ce paiement a été encaissé pour « ${stripeCustomer} », or vous rattachez « ${client.name} ».`,
        mismatch: { stripeCustomer, selected: client.name },
      });
    }
  }

  const taxConfig = await getTaxConfig();
  const mode = ['dineIn', 'takeaway'].includes(consumptionMode) ? consumptionMode : (order.consumptionMode || 'dineIn');
  const products = normalizeItems(items);
  const tax = buildOrderTax({
    products,
    totalPrice: order.totalPrice,
    finalPrice: order.finalPrice != null ? order.finalPrice : order.totalPrice,
    consumptionMode: mode,
    config: taxConfig,
  });

  const updates = {
    products,
    consumptionMode: mode,
    taxBreakdown: tax.breakdown,
    totalHT: tax.totalHT,
    totalTVA: tax.totalTVA,
    updatedAt: new Date(),
  };

  if (customerName !== undefined) {
    updates.customerName = String(customerName).trim() || client?.name || 'Réintégration Stripe';
  } else if (client && !order.customerName) {
    updates.customerName = client.name;
  }

  const net = order.finalPrice != null ? order.finalPrice : order.totalPrice;
  if (clientChanged) {
    updates.user = nextUserId;
    updates.importSource = {
      ...(order.importSource || {}),
      attachedLate: true,
      mismatchConfirmed: Boolean(confirmMismatch),
    };
  }

  await docRef.update(updates);

  // Transfert de fidélité. Le retrait est plafonné à 0 : si l'ancien client a déjà dépensé les
  // points reçus à tort, on ne le met pas en négatif — l'écart est signalé, pas absorbé en silence.
  const moves = [];
  if (clientChanged) {
    const credited = order.loyaltyCredited || 0;
    if (previousUserId && credited > 0) {
      try {
        const prevSnap = await usersCol.doc(previousUserId).get();
        const before = prevSnap.data()?.loyaltyPoints || 0;
        const after = Math.max(0, before - credited);
        await usersCol.doc(previousUserId).update({ loyaltyPoints: after, updatedAt: new Date() });
        moves.push({
          direction: 'removed',
          name: order.customerName || 'client précédent',
          points: before - after,
          shortfall: credited - (before - after),
        });
      } catch (err) {
        moves.push({ direction: 'removed', name: order.customerName || 'client précédent', points: credited, failed: true });
      }
    }

    let creditedNow = 0;
    if (client) {
      const uid = client.id || client._id;
      const pointsEarned = Math.floor(net);
      try {
        const userSnap = await usersCol.doc(uid).get();
        const newBalance = (userSnap.data()?.loyaltyPoints || 0) + pointsEarned;
        await usersCol.doc(uid).update({ loyaltyPoints: newBalance, updatedAt: new Date() });
        creditedNow = pointsEarned;
        moves.push({ direction: 'added', name: client.name, points: pointsEarned, newBalance });
      } catch (err) {
        moves.push({ direction: 'added', name: client.name, points: pointsEarned, failed: true });
      }
    }
    await docRef.update({ loyaltyCredited: creditedNow });
    updates.loyaltyCredited = creditedNow;
  }

  const parts = moves.map((m) => {
    if (m.failed) return `échec du ${m.direction === 'added' ? 'crédit' : 'retrait'} de ${m.points} pts (${m.name}) — à ajuster dans « Comptes & points »`;
    if (m.direction === 'added') return `+${m.points} pts pour ${m.name}`;
    return m.shortfall > 0
      ? `−${m.points} pts pour ${m.name} (${m.shortfall} pts déjà dépensés, non repris)`
      : `−${m.points} pts pour ${m.name}`;
  });
  const message = parts.length ? `Commande mise à jour · ${parts.join(' · ')}` : 'Commande mise à jour';
  const loyalty = { moves, failed: moves.some((m) => m.failed) };
  sendSuccess(res, { id, _id: id, ...order, ...updates, loyalty }, message);
});

module.exports = {
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  backup,
  restore,
  setPassword,
  stripePaymentPreview,
  importOrderFromStripe,
  updateImportedOrderItems,
};
