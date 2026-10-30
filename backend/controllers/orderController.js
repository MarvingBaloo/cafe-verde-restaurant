const { ordersCol, VALID_STATUSES, formatOrder, toMs, findAll, findByUser, findById } = require('../models/Order.js');
const { usersCol, findByEmail, findByPhone } = require('../models/User.js');
const { sendSuccess } = require('../utils/responseFormatter');
const { ApiError } = require('../utils/errorHandler');
const { sendEmail, sendSms } = require('../services/brevoService');
const { renderEmailHtml, renderSmsText, orderLabel } = require('../services/receiptRenderer');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { normalizePhone } = require('../utils/phone');
const { POINTS_PER_EURO } = require('../utils/loyalty');
const { db } = require('../config/firestore');
const { getTaxConfig, getHoursConfig } = require('../models/Setting.js');
const { getOnlineOrderingStatus, closedMessage, validateScheduledPickup, kitchenReleaseAt } = require('../utils/hours');
const { buildOrderTax } = require('../utils/tax');
const { allocateOrderNumber } = require('../utils/orderNumber');
const { mergeSplitPayments } = require('../utils/splitPayments');
const { terminalPassages, withTerminalFields, sanitizeCardPayments, sumKind } = require('../utils/cardPayments');
const { VALID_CANCEL_TYPES } = require('../validators/orderValidator');
const { findAll: findAllProductCategories } = require('../models/ProductCategory.js');
const { findAll: findAllBubbleTeas } = require('../models/BubbleTea.js');
const { findAll: findAllMilkshakes } = require('../models/Milkshake.js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/** Mode de consommation valide (par défaut : config en ligne, sinon sur place). */
function resolveConsumptionMode(raw, config) {
  if (raw === 'dineIn' || raw === 'takeaway') return raw;
  return config?.defaultMode === 'takeaway' ? 'takeaway' : 'dineIn';
}

/** Map id → catégorie (pour résoudre le taux TVA hérité d'un produit). Best-effort. */
async function loadCategoriesById() {
  try {
    const cats = await findAllProductCategories();
    return Object.fromEntries(cats.map(c => [c._id || c.id, c]));
  } catch {
    return {};
  }
}

/** Map id → categoryId de classement TVA pour les composables (bubble teas / milkshakes). Best-effort. */
async function loadComposableCategoryMaps() {
  try {
    const [teas, shakes] = await Promise.all([findAllBubbleTeas(), findAllMilkshakes()]);
    return {
      bubbleTea: Object.fromEntries(teas.map(b => [b._id || b.id, b.categoryId || null])),
      milkshake: Object.fromEntries(shakes.map(m => [m._id || m.id, m.categoryId || null])),
    };
  } catch {
    return { bubbleTea: {}, milkshake: {} };
  }
}

/** Injecte le categoryId de classement dans chaque item composable (depuis le catalogue), pour la TVA. */
function enrichComposables(items, idField, catById) {
  return (items || []).map(it => {
    const catId = it.categoryId ?? catById[it[idField] || it._id || it.id] ?? null;
    return catId ? { ...it, categoryId: catId } : it;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Fidélité silencieuse pour un client anonyme : quand il fournit un email/numéro pour
 * recevoir son ticket, on rattache ce contact à une fiche client (créée ou existante)
 * et on crédite les points de la commande. Aucune information donnée au client.
 * Si plus tard il crée un compte avec ce même contact → réconciliation E.164 de `protect`
 * → les points sont récupérés. Best-effort : ne doit jamais faire échouer l'envoi du ticket.
 */
async function linkAnonymousLoyalty(order, channel, dest) {
  // Normalise le contact fourni pour le ticket.
  const contact = {};
  if (channel === 'email') {
    contact.email = dest.toLowerCase().trim();
  } else {
    const phone = normalizePhone(dest);
    if (!phone) return;
    contact.phone = phone;
  }

  // Helper : complète email/phone manquant sur une fiche, sans jamais écraser.
  const completeContact = async (userId, data) => {
    const patch = {};
    if (contact.email && !data.email) patch.email = contact.email;
    if (contact.phone && !data.phone) patch.phone = contact.phone;
    if (Object.keys(patch).length) { patch.updatedAt = new Date(); await usersCol.doc(userId).update(patch); }
  };

  // Commande déjà rattachée (ex : 2e envoi par l'autre canal) → on complète seulement les
  // fiches LÉGÈRES (sans compte Auth). Un vrai compte n'est jamais modifié : le ticket peut
  // avoir été envoyé à un tiers. Pas de re-crédit (idempotent).
  if (order.user) {
    const snap = await usersCol.doc(order.user).get();
    if (!snap.exists) return;
    const data = snap.data();
    if (data.firebaseUid) return; // vrai compte : ne pas toucher
    await completeContact(order.user, data);
    return;
  }

  // Commande anonyme : créer/retrouver la fiche par le contact, rattacher, créditer.
  const fiche = channel === 'email' ? await findByEmail(contact.email) : await findByPhone(contact.phone);
  let userId;
  if (fiche) {
    userId = fiche.id || fiche._id;
    await completeContact(userId, fiche);
  } else {
    const ref = await usersCol.add({
      name: 'Client',
      phone: contact.phone || null,
      email: contact.email || null,
      firebaseUid: null,
      role: 'client',
      isAdmin: false,
      loyaltyPoints: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    userId = ref.id;
  }

  // Rattache la commande + crédite les points (hors split, comme createOrder).
  await ordersCol.doc(order._id).update({ user: userId, updatedAt: new Date() });
  const pointsEarned = order.isSplit ? 0 : Math.floor(Number(order.finalPrice ?? order.totalPrice ?? 0));
  if (pointsEarned > 0) {
    const snap = await usersCol.doc(userId).get();
    const cur = snap.exists ? (snap.data().loyaltyPoints || 0) : 0;
    await usersCol.doc(userId).update({ loyaltyPoints: cur + pointsEarned, updatedAt: new Date() });
  }
}

// Fidélité d'une commande séparée (split), agrégée PAR CLIENT.
// Chaque part est rattachée à son client (part.user) ou, à défaut, au client global (globalUserId).
// - points UTILISÉS (redeemed) : réduisent le net réglé de la part.
// - net d'une part = amount − redeemed/POINTS_PER_EURO ; points GAGNÉS = floor(net) (1 € payé = 1 pt).
// Retourne { [userId]: { redeemed, earned } } (un même client sur plusieurs parts est fusionné).
// Le net est cumulé par client AVANT l'arrondi : un client sur plusieurs entrées (deux parts, ou
// une part réglée en plusieurs fois) ne doit pas perdre un point à chaque arrondi intermédiaire.
function splitLoyaltyByUser(splitPayments, globalUserId) {
  const agg = {};
  for (const part of (splitPayments || [])) {
    const uid = part.user || globalUserId || null;
    if (!uid) continue;
    const amt = Number(part.amount) || 0;
    if (amt <= 0) continue;
    const redeemed = Math.max(0, Math.floor(Number(part.pointsRedeemed) || 0));
    const net = Math.max(0, amt - redeemed / POINTS_PER_EURO);
    if (!agg[uid]) agg[uid] = { redeemed: 0, net: 0 };
    agg[uid].redeemed += redeemed;
    agg[uid].net += net;
  }
  return Object.fromEntries(
    Object.entries(agg).map(([uid, { redeemed, net }]) => [uid, { redeemed, earned: Math.floor(net) }])
  );
}

// Prépare l'ajustement fidélité d'un split : lit chaque client, VALIDE le solde (lève 400 si les
// points utilisés dépassent le solde, AVANT toute écriture), et renvoie le plan à appliquer ensuite.
async function planSplitLoyalty(splitPayments, globalUserId) {
  // Une part déjà créditée au moment de son encaissement (convive parti avant la fin du repas,
  // cf. recordPartPayment) ne doit pas l'être une seconde fois à la clôture.
  // ⚠️ Le filtre est ICI et surtout PAS dans splitLoyaltyByUser : le remboursement total s'appuie
  // sur la même fonction pour INVERSER les points, et doit reprendre TOUTES les parts — celles
  // créditées en avance ont bien reçu leurs points, simplement plus tôt.
  const pending = (splitPayments || []).filter(p => p && !p.loyaltyApplied);
  const agg = splitLoyaltyByUser(pending, globalUserId);
  const plan = [];
  for (const [uid, { redeemed, earned }] of Object.entries(agg)) {
    if (redeemed === 0 && earned === 0) continue;
    const snap = await usersCol.doc(uid).get();
    if (!snap.exists) continue; // fiche client introuvable → ignorée (best-effort)
    const cur = snap.data().loyaltyPoints || 0;
    if (redeemed > cur) {
      throw new ApiError(`Points insuffisants pour ${snap.data().name || 'ce client'} (demandé ${redeemed}, dispo ${cur}).`, 400);
    }
    plan.push({ uid, newBalance: Math.max(0, cur - redeemed + earned), redeemed, earned });
  }
  return plan;
}

// Applique le plan calculé par planSplitLoyalty (1 écriture par client).
async function applySplitLoyalty(plan) {
  for (const p of (plan || [])) {
    await usersCol.doc(p.uid).update({ loyaltyPoints: p.newBalance, updatedAt: new Date() });
    console.log(`🎁 Split — ${p.uid} : -${p.redeemed} / +${p.earned} pts → ${p.newBalance}`);
  }
}

// Total des points utilisés sur l'ensemble des parts d'un split (pour finalPrice / persistance).
function splitPointsRedeemedTotal(splitPayments) {
  return (splitPayments || []).reduce((s, p) => s + Math.max(0, Math.floor(Number(p.pointsRedeemed) || 0)), 0);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Sources de paiement CARTE d'une commande, avec leur PaymentIntent Stripe.
 * Seuls ces montants sont remboursables via l'API Stripe (espèces / tickets / points : trace locale).
 * - Split : une source par part réglée en carte ou mixte (`index` = numéro de part, 1-based).
 * - Simple : PI de la commande (paiement en ligne) ou de `paymentDetails` (caisse : carte ou mixte).
 * `amount` = montant réellement encaissé par carte (net de la remise points pour une part).
 */
function cardPaymentSources(order) {
  // Un règlement peut avoir passé plusieurs cartes au terminal (cf. utils/cardPayments.js) :
  // une source par passage, chacune avec son PaymentIntent.
  const expand = (entry, legacyAmount, index, label) => {
    const list = terminalPassages(entry, legacyAmount);
    return list.map((c, k) => ({
      index,
      label: list.length > 1 ? `${label} — ${c.kind === 'meal_card' ? 'titre-resto' : 'carte'} ${k + 1}` : label,
      paymentIntentId: c.paymentIntentId,
      amount: c.amount,
    }));
  };

  // Vente annulée après encaissement : les règlements vivent dans `cancelPayments` (la commande
  // n'a jamais été réglée, donc ni splitPayments ni paymentDetails). Montants déjà nets de points.
  if (order.status === 'cancelled' && Array.isArray(order.cancelPayments)) {
    return order.cancelPayments.flatMap((p, i) => expand(
      p,
      p.method === 'mixed' ? (Number(p.cardAmount) || 0) : (p.method === 'card' ? (Number(p.amount) || 0) : 0),
      p.partIndex != null ? Number(p.partIndex) : null,
      p.partIndex != null ? `Part ${p.partIndex}` : `Règlement ${i + 1}`,
    ));
  }

  if (order.isSplit && Array.isArray(order.splitPayments)) {
    // Une part réglée en plusieurs fois (article ajouté après un premier encaissement) produit
    // plusieurs entrées de même `index` → on numérote les règlements pour que les libellés restent distincts.
    const seen = {};
    return order.splitPayments.flatMap((p, i) => {
      const index = p.index != null ? Number(p.index) : i + 1;
      seen[index] = (seen[index] || 0) + 1;
      const rank = seen[index];
      const redeemed = Math.max(0, Math.floor(Number(p.pointsRedeemed) || 0));
      const legacyAmount = p.method === 'card'
        ? Math.max(0, (Number(p.amount) || 0) - redeemed / POINTS_PER_EURO)
        : p.method === 'mixed' ? Number(p.cardAmount) || 0 : 0;
      return expand(p, legacyAmount, index, rank > 1 ? `Part ${index} (règlement ${rank})` : `Part ${index}`);
    });
  }

  const paid = round2(order.finalPrice != null ? order.finalPrice : order.totalPrice);
  const details = order.paymentDetails || null;
  if (Array.isArray(details?.cardPayments) && details.cardPayments.length) {
    return expand(details, 0, null, 'Paiement carte');
  }
  // Le PI de commande (paiement en ligne) prime ; sinon celui posé par la caisse dans paymentDetails.
  const pi = order.paymentIntentId || details?.paymentIntentId || null;
  const amount = order.paymentMethod === 'mixed'
    ? round2(Number(details?.cardAmount) || 0)
    : order.paymentMethod === 'card' ? paid : (order.paymentIntentId ? paid : 0);

  return amount > 0 ? [{ index: null, label: 'Paiement carte', paymentIntentId: pi, amount }] : [];
}

// Moyens dont le détail (`paymentDetails`) est conservé : il porte les PaymentIntents du terminal.
// `ticket` en fait partie depuis que le titre-restaurant peut être une carte passée au terminal.
const DETAILED_METHODS = ['card', 'mixed', 'ticket'];

/** Montants déjà remboursés via Stripe, groupés par PaymentIntent (d'après les refunds tracés). */
function stripeRefundedByPI(order) {
  const acc = {};
  for (const r of (Array.isArray(order.refunds) ? order.refunds : [])) {
    for (const s of (Array.isArray(r.stripe) ? r.stripe : [])) {
      if (!s.paymentIntentId) continue;
      acc[s.paymentIntentId] = round2((acc[s.paymentIntentId] || 0) + (Number(s.amount) || 0));
    }
  }
  return acc;
}

/**
 * Marque les PaymentIntents d'une commande avec son id → la commande est retrouvable
 * depuis le Dashboard Stripe. Best-effort : n'échoue jamais la requête appelante.
 */
async function tagPaymentIntents(order, orderId) {
  const sources = cardPaymentSources(order).filter((s) => s.paymentIntentId);
  await Promise.all(sources.map((s) => stripe.paymentIntents.update(s.paymentIntentId, {
    metadata: {
      orderId,
      orderNumber: order.orderNumber || '',
      customerName: order.customerName || '',
    },
  }).catch((err) => console.warn(`⚠️ Stripe metadata (${s.paymentIntentId}) :`, err.message))));
}

/**
 * @description Récupère toutes les commandes
 * @route   GET /api/orders
 * @access  Private (staff voit toutes les commandes, un client voit les siennes)
 */
/**
 * Libère les commandes programmées dont l'heure est venue : `scheduled` → `pending`,
 * puis émission `new_order` pour qu'elles apparaissent en cuisine comme n'importe
 * quelle commande du jour.
 *
 * Pas de tâche planifiée : ce balayage est déclenché par la vie de l'application
 * (chargement des commandes, minuterie du serveur). Si personne ne consulte rien,
 * la libération attend le premier accès — ce qui est sans conséquence : si ni le KDS
 * ni la caisse ne sont ouverts, il n'y a personne pour préparer la commande.
 *
 * Best-effort : ne jette jamais, une panne ici ne doit pas faire échouer l'appel qui l'a
 * déclenchée.
 *
 * @returns {Promise<number>} nombre de commandes libérées
 */
const promoteScheduledOrders = async (io = null) => {
  try {
    const snap = await ordersCol.where('status', '==', 'scheduled').get();
    if (snap.empty) return 0;
    const now = Date.now();
    let released = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const dueAt = toMs(data.kitchenReleaseAt) || toMs(data.scheduledFor);
      if (!dueAt || dueAt > now) continue;
      await doc.ref.update({ status: 'pending', updatedAt: new Date() });
      released += 1;
      if (io) {
        const fresh = await doc.ref.get();
        io.emit('new_order', formatOrder(fresh));
      }
    }
    if (released) console.log(`⏰ ${released} commande(s) programmée(s) envoyée(s) en cuisine`);
    return released;
  } catch (err) {
    console.error('⏰ Libération des commandes programmées impossible :', err.message);
    return 0;
  }
};

const getOrders = async (req, res, next) => {
  try {
    if (!req.user) throw new ApiError('Non autorisé', 401);

    // Le KDS et la caisse rechargent la liste : c'est le moment naturel de libérer
    // les commandes programmées arrivées à échéance.
    await promoteScheduledOrders(req.app.get('socketio'));

    const isStaff = req.user.isAdmin || req.user.role === 'kitchen';
    const orders = isStaff ? await findAll() : await findByUser(req.user.id);

    sendSuccess(res, orders, 'Liste des commandes récupérée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Récupère une commande par son ID
 * @route   GET /api/orders/:id
 * @access  Private (staff ou propriétaire de la commande)
 */
const getOrderById = async (req, res, next) => {
  try {
    const order = await findById(req.params.id);

    if (!order) {
      throw new ApiError('Commande non trouvée', 404);
    }

    if (!req.user) throw new ApiError('Non autorisé', 401);

    // order.user est une string Firestore — comparaison directe (pas de .toString() nécessaire)
    const isStaff = req.user.isAdmin || req.user.role === 'kitchen';
    if (!isStaff && order.user !== req.user.id) {
      throw new ApiError('Accès non autorisé', 403);
    }

    sendSuccess(res, order, 'Commande récupérée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Crée une nouvelle commande et crédite la fidélité
 * @route   POST /api/orders
 * @access  Public (authentifié ou invité)
 */
const createOrder = async (req, res, next) => {
  try {
    console.log('📦 [DEBUG SERVER] createOrder appelé');
    console.log('📦 [DEBUG SERVER] Body reçu:', JSON.stringify(req.body, null, 2));

    console.log('📦 [DEBUG ORDER] Validation Check:', {
      hasName:    !!req.body.customerName,
      hasFormula: !!req.body.formula,
      hasPrice:   !!req.body.totalPrice
    });

    const { customerName, totalPrice, formula, formulaQuantity = 1, ingredients, menu, products, dishes, cartProducts, bubbleTeas, milkshakes, salads = null, user, phone = null, pointsToRedeem = 0, manualDiscount = 0, discount = null, paymentMethod = null, paymentDetails = null, paymentIntentId = null, source = null, status = 'pending', consumptionMode: rawConsumptionMode = null, isSplit = false, splitMode = null, splitCount = null, splitPayments = null, cancelType = null, cancelReason = null, cancelledAmount = 0, cancelPayments = null, reachedKitchen = true, scheduledFor = null } = req.body;

    // La route est ouverte (commande anonyme), mais rattacher une commande à un client
    // débite ses points et crédite son historique : le serveur doit savoir QUI appelle.
    // Ne vérifier que l'existence du client et son solde revient à confier l'autorisation
    // à son id — or un id de document ne change jamais et figure dans tout export de
    // sauvegarde : ce qui a fuité une fois reste exploitable pour toujours.
    // Personnel : peut agir pour n'importe quel client (la caisse encaisse pour autrui).
    // Client : pour lui-même seulement. Anonyme : aucune commande nominative.
    // Les parts d'une addition séparée portent leur propre client (part.user) : les inclure,
    // sinon le contrôle se contourne en passant par splitPayments.
    const clientsCites = [user, ...(splitPayments || []).map((p) => p && p.user)].filter(Boolean);
    if (clientsCites.length) {
      if (!req.user) {
        throw new ApiError('Authentification requise pour rattacher une commande à un client.', 401);
      }
      const estPersonnel = req.user.isAdmin || req.user.role === 'kitchen';
      if (!estPersonnel && clientsCites.some((id) => id !== req.user.id)) {
        throw new ApiError('Accès non autorisé à la fiche de ce client.', 403);
      }
    }

    // Une commande en ligne identifie toujours son client : par le compte (connecté), ou par
    // un téléphone (invité) — c'est la condition pour recevoir la confirmation de commande et,
    // pour un invité, pour que la fidélité se rattache plus tard à un compte partageant ce numéro
    // (cf. linkAnonymousLoyalty). Sans ça un client reparterait sans aucune preuve de sa commande.
    let guestPhone = null;
    if (source === 'online' && !user) {
      const parsedPhone = phone ? parsePhoneNumberFromString(phone, 'GP') : null;
      if (!parsedPhone || !parsedPhone.isValid()) {
        throw new ApiError('Numéro de téléphone requis pour commander sans compte.', 400);
      }
      guestPhone = parsedPhone.number;
    }

    // Heure de retrait : le créneau demandé est revalidé côté serveur — le front propose,
    // le serveur dispose. Ce n'est plus réservé au lendemain : toute commande en ligne porte
    // désormais un créneau, choisi le jour même (à partir de l'ouverture, ou de maintenant
    // + le délai de préparation) ou pour le lendemain quand la journée est close.
    let scheduledPickupAt = null;
    let scheduledReleaseAt = null;
    if (scheduledFor && source === 'online') {
      const hoursConfig = await getHoursConfig();
      const check = validateScheduledPickup(hoursConfig, scheduledFor, new Date());
      if (check.ok) {
        scheduledPickupAt = check.pickupAt;
      } else if (paymentIntentId) {
        // ⚠️ Client déjà débité : les créneaux avancent avec l'heure, celui qu'il a choisi a
        // pu sortir de la liste pendant le 3-D Secure. Le refuser ici laisserait l'argent
        // encaissé sans commande — même raison que la garde d'horaires juste en dessous.
        // On honore l'heure demandée, la cuisine verra la commande tout de suite.
        const demande = new Date(scheduledFor);
        scheduledPickupAt = Number.isNaN(demande.getTime()) ? null : demande;
        console.warn(`⏰ Créneau conservé malgré la revalidation (paiement déjà encaissé) : ${check.message}`);
      } else {
        throw new ApiError(check.message, 400);
      }
      if (scheduledPickupAt) scheduledReleaseAt = kitchenReleaseAt(hoursConfig, scheduledPickupAt);
    }

    // Restaurant fermé : une commande en ligne est refusée avant toute écriture.
    // ⚠️ Une commande DÉJÀ adossée à un paiement Stripe passe quand même : le client a été
    // débité (retour 3-D Secure arrivé après l'heure de dernière commande) et lui refuser sa
    // commande laisserait l'argent encaissé sans ticket, sans TVA et sans passage en cuisine.
    // La caisse (`source: 'caisse'`) et les réintégrations Stripe ne sont jamais concernées :
    // la caissière clôture ses tickets après la fermeture, c'est son travail.
    if (source === 'online' && !paymentIntentId && !scheduledPickupAt) {
      const hoursStatus = getOnlineOrderingStatus(await getHoursConfig(), new Date());
      if (!hoursStatus.open) {
        throw new ApiError(closedMessage(hoursStatus), 503);
      }
    }

    // Remise commerciale (avant points), montant € — le front fait foi, plafonné au total.
    const manualDiscountAmount = Math.max(0, Math.min(Number(manualDiscount) || 0, Number(totalPrice) || 0));

    // --- LOGIQUE REMBOURSEMENT POINTS ---
    let pointsRedeemed = 0;
    let discountAmount = 0;
    let finalPrice = Math.max(0, totalPrice - manualDiscountAmount);
    let userDataForRedeem = null;

    if (pointsToRedeem && pointsToRedeem > 0) {
      if (!user) {
        return res.status(400).json({ message: "Utilisateur requis pour utiliser des points." });
      }
      if (!Number.isInteger(pointsToRedeem) || pointsToRedeem < 0) {
        return res.status(400).json({ message: "Le nombre de points est invalide." });
      }
      const userSnap = await usersCol.doc(user).get();
      if (!userSnap.exists) {
        return res.status(400).json({ message: "Utilisateur introuvable." });
      }
      userDataForRedeem = userSnap.data();
      if ((userDataForRedeem.loyaltyPoints || 0) < pointsToRedeem) {
        return res.status(400).json({ message: "Points insuffisants." });
      }
      pointsRedeemed = pointsToRedeem;
      discountAmount = pointsToRedeem / POINTS_PER_EURO;
      finalPrice = Math.max(0, totalPrice - manualDiscountAmount - discountAmount);
    }

    // Points utilisés PAR PART (split) : réduisent le net réglé → impactent finalPrice et la compta.
    // En split, la remise points globale (pointsToRedeem) est nulle (côté caisse) → pas de double comptage.
    if (isSplit) {
      const splitRedeemed = splitPointsRedeemedTotal(splitPayments);
      if (splitRedeemed > 0) {
        pointsRedeemed += splitRedeemed;
        discountAmount += splitRedeemed / POINTS_PER_EURO;
        finalPrice = Math.max(0, totalPrice - manualDiscountAmount - discountAmount);
      }
    }

    // Validation basique — accepte salade(s), plat seul, produit à l'unité, ou mixte
    const hasSalads = Array.isArray(salads) && salads.length > 0;
    const hasSalade = !!formula || hasSalads;
    const hasDishes = Array.isArray(dishes) && dishes.length > 0;
    const hasCartProducts = Array.isArray(cartProducts) && cartProducts.length > 0;
    const hasProducts = Array.isArray(products) && products.length > 0;
    const hasBubbleTeas = Array.isArray(bubbleTeas) && bubbleTeas.length > 0;
    const hasMilkshakes = Array.isArray(milkshakes) && milkshakes.length > 0;
    // Un ticket 'open' (mis en attente) peut encore être vide ; tout le reste exige un total et un article.
    const isOpenTicket = status === 'open';
    if (!customerName || (!isOpenTicket && (!totalPrice || (!hasSalade && !hasDishes && !hasCartProducts && !hasProducts && !hasBubbleTeas && !hasMilkshakes)))) {
      throw new ApiError('Les informations de la commande sont incomplètes.', 400);
    }

    // Repli legacy : les anciens écrans lisent un seul `formula`/`ingredients`/`formulaQuantity`.
    // On le renseigne depuis la 1re salade quand seul `salads[]` est fourni.
    const primarySalad = hasSalads ? salads[0] : null;
    const legacyFormula = formula || primarySalad?.formula || null;
    const legacyIngredients = (Array.isArray(ingredients) && ingredients.length ? ingredients : primarySalad?.ingredients) || [];
    const legacyFormulaQuantity = formula ? (formulaQuantity || 1) : (primarySalad?.quantity || 1);

    // Commande passée en ligne (côté client) → numéro WEB-XXXX. Caisse/autres : pas de numéro (affichage legacy #id).
    const isOnline = source === 'online';
    // "Payer sur place" (paymentMethod 'onsite') = commande non réglée ; tout le reste est réglé à la création.
    // Une vente annulée n'est JAMAIS réglée, quoi qu'envoie le front : sans ce garde-fou elle
    // entrerait dans le chiffre d'affaires (la compta filtre sur `paid === true`) et créditerait
    // des points. Ce qui a été encaissé avant l'annulation vit dans `cancelledAmount`.
    const paid = status !== 'cancelled' && paymentMethod !== 'onsite';

    // Sécurité paiement carte en ligne : une commande online réglée (> 0) doit être adossée
    // à un vrai PaymentIntent Stripe payé, du bon montant, jamais réutilisé. Le paiement à la
    // caisse (terminal/espèces) et le "payer sur place" (paid=false) ne sont pas concernés.
    if (isOnline && paid && finalPrice > 0) {
      if (!paymentIntentId) throw new ApiError('Paiement en ligne requis.', 400);
      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      } catch {
        throw new ApiError('Paiement introuvable.', 400);
      }
      if (pi.status !== 'succeeded') throw new ApiError('Paiement non confirmé.', 402);
      if (pi.amount_received < Math.round(finalPrice * 100) - 1) {
        throw new ApiError('Montant payé insuffisant.', 402);
      }
      const dup = await ordersCol.where('paymentIntentId', '==', paymentIntentId).limit(1).get();
      if (!dup.empty) throw new ApiError('Ce paiement a déjà été utilisé.', 409);
    }

    // --- TVA (prix TTC) : mode de consommation + ventilation figée à la création ---
    const taxConfig = await getTaxConfig();
    const categoriesById = await loadCategoriesById();
    const composableCats = await loadComposableCategoryMaps();
    const consumptionMode = resolveConsumptionMode(rawConsumptionMode, taxConfig);
    const tax = buildOrderTax({
      products, cartProducts,
      bubbleTeas: enrichComposables(bubbleTeas, 'bubbleTeaId', composableCats.bubbleTea),
      milkshakes: enrichComposables(milkshakes, 'milkshakeId', composableCats.milkshake),
      totalPrice, finalPrice, consumptionMode, config: taxConfig, categoriesById,
    });

    // Numéro alloué une seule fois à la création : un ticket ouvert le conserve
    // jusqu'à l'encaissement (settle/update ne réallouent jamais).
    const orderNumber = await allocateOrderNumber(source);

    // Un créneau dont l'heure de sortie cuisine est déjà passée (le cas courant : « dans
    // 15 minutes » en plein service) part directement en cuisine. Seule une commande
    // réellement en avance — avant l'ouverture, ou un retrait choisi plus tard dans la
    // journée — attend son heure hors KDS, jusqu'à ce que `promoteScheduledOrders` la libère.
    // Sans cette distinction, une commande à retirer dans un quart d'heure resterait invisible
    // jusqu'au prochain balayage (5 min) alors que la cuisine devrait déjà la préparer.
    const effectiveStatus = (scheduledReleaseAt && scheduledReleaseAt.getTime() > Date.now())
      ? 'scheduled'
      : status;

    const orderData = {
      user:           user || null,
      customerName,
      customerPhone:  guestPhone,
      totalPrice,
      orderNumber,
      paid,
      scheduledFor:     scheduledPickupAt || null,
      kitchenReleaseAt: scheduledReleaseAt || null,
      formula:        legacyFormula,
      formulaQuantity: legacyFormulaQuantity,
      ingredients:    legacyIngredients,
      salads:         hasSalads ? salads : [],
      menu:           menu || null,
      products:       products || [],
      dishes:         dishes || [],
      cartProducts:   cartProducts || [],
      bubbleTeas:     bubbleTeas || [],
      milkshakes:     milkshakes || [],
      status:         effectiveStatus || 'pending',
      // Annulation tracée : nature de l'annulation + ce qui reste à rendre au client.
      cancelType:     status === 'cancelled' ? (cancelType || 'no_payment') : null,
      cancelReason:   status === 'cancelled' ? (cancelReason || null) : null,
      cancelledAmount: status === 'cancelled' ? (cancelledAmount || 0) : 0,
      // Références des règlements encaissés avant l'annulation (moyen + PaymentIntent + payeur) :
      // c'est ce qui rend le remboursement possible depuis l'app, cf. cardPaymentSources.
      cancelPayments: status === 'cancelled' ? (Array.isArray(cancelPayments) ? cancelPayments.map(withTerminalFields) : []) : null,
      reachedKitchen: reachedKitchen !== false,
      paymentMethod:  paymentMethod || null,
      // Carte, mixte et titre-restaurant passé au terminal : on garde `paymentDetails` — il porte
      // le(s) paymentIntentId du terminal, indispensable(s) pour rembourser réellement sur la carte.
      paymentDetails: DETAILED_METHODS.includes(paymentMethod) ? (withTerminalFields(paymentDetails) || null) : null,
      paymentIntentId: paymentIntentId || null,
      source:         source || null,
      isSplit:        !!isSplit,
      splitMode:      isSplit ? splitMode : null,
      splitCount:     isSplit ? splitCount : null,
      splitPayments:  isSplit ? (splitPayments || []).map(withTerminalFields) : null,
      pointsRedeemed,
      discountAmount,
      manualDiscount: manualDiscountAmount,
      discount:       discount || null,
      finalPrice,
      consumptionMode,
      taxBreakdown:   tax.breakdown,
      totalHT:        tax.totalHT,
      totalTVA:       tax.totalTVA,
      serviceRate:    taxConfig.serviceRate,
      paidAt:         paid ? new Date() : null,
      createdAt:      new Date(),
      updatedAt:      new Date(),
    };

    // Split réglé : on VALIDE les soldes points par client AVANT de persister (lève 400 si insuffisant).
    const splitLoyaltyPlan = (paid && isSplit) ? await planSplitLoyalty(splitPayments, user) : null;

    const docRef = await ordersCol.add(orderData);
    const createdOrder = { id: docRef.id, _id: docRef.id, ...orderData };

    // Rattache la commande à ses PaymentIntents côté Stripe (Dashboard). Best-effort.
    if (paid) await tagPaymentIntents(orderData, docRef.id);

    // LOGIQUE FIDÉLITÉ (GAMIFICATION)
    // Commande non réglée ("payer sur place") : aucun mouvement de points à la création — tout est traité à l'encaissement (settleOnlineOrder).
    if (paid) {
      if (isSplit) {
        // Split : débit des points utilisés + gain sur le net, PAR CLIENT (part.user ou client global).
        await applySplitLoyalty(splitLoyaltyPlan);
      } else if (user && (pointsRedeemed > 0 || !isSplit)) {
        const userDoc = userDataForRedeem
          ? { exists: true, data: () => userDataForRedeem }
          : await usersCol.doc(user).get();

        if (userDoc.exists) {
          const loyaltyPoints = userDoc.data().loyaltyPoints || 0;
          const pointsEarned = Math.floor(finalPrice);
          const newPoints = Math.max(0, loyaltyPoints - pointsRedeemed + pointsEarned);
          await usersCol.doc(user).update({ loyaltyPoints: newPoints });
          console.log(`🎁 Fidélité : +${pointsEarned} pts, -${pointsRedeemed} pts → total : ${newPoints}`);
        }
      }
    }

    // --- TEMPS RÉEL (SOCKET.IO) ---
    // Un ticket 'open' (mis en attente) ne part PAS au KDS tant qu'il n'est pas envoyé en cuisine.
    // Une commande 'scheduled' (payée pour demain) non plus : elle resterait affichée toute la
    // nuit et la cuisine la préparerait pour rien. Elle part au KDS via promoteScheduledOrders.
    // Une vente créée directement 'cancelled' n'est qu'une trace : elle ne doit surtout pas
    // partir au KDS comme une commande à préparer.
    const io = req.app.get('socketio');
    if (io) {
      if (orderData.status === 'cancelled') io.emit('order:cancelled', { orderId: createdOrder._id, order: createdOrder });
      else if (orderData.status === 'scheduled') io.emit('order_scheduled', createdOrder);
      else if (orderData.status !== 'open') io.emit('new_order', createdOrder);
    }

    // Confirmation de commande (email/SMS) : le client doit repartir avec une preuve de sa
    // commande — le numéro et l'heure de retrait, surtout maintenant qu'elle en porte une.
    // ⚠️ Fire-and-forget, volontairement PAS attendu : Brevo peut mettre plusieurs secondes à
    // répondre, et rien ne doit retarder la réponse HTTP — un client qui vient de payer ne doit
    // pas regarder un bouton tourner pendant qu'un SMS part en arrière-plan.
    if (source === 'online') {
      (async () => {
        try {
          let channel = null, dest = null;
          if (user) {
            // Connecté : email par défaut (gratuit), SMS seulement s'il n'a pas d'email
            // (compte créé par téléphone).
            const snap = await usersCol.doc(user).get();
            const data = snap.exists ? snap.data() : null;
            if (data?.email) { channel = 'email'; dest = data.email; }
            else if (data?.phone) { channel = 'sms'; dest = data.phone; }
          } else if (guestPhone) {
            channel = 'sms'; dest = guestPhone;
          }
          if (channel && dest) {
            await deliverReceipt(createdOrder, { channel, dest, detail: true });
            // Fidélité silencieuse : un invité qui a donné son téléphone est rattaché/crédité —
            // au compte existant si ce numéro en a déjà un, sinon une fiche légère créée pour lui.
            if (paid && !user) {
              try { await linkAnonymousLoyalty(createdOrder, channel, dest); }
              catch (e) { console.error('Fidélité anonyme (non bloquant) :', e.message); }
            }
          }
        } catch (e) {
          console.error('Confirmation de commande (non bloquant) :', e.message);
        }
      })();
    }

    sendSuccess(res, createdOrder, 'Commande créée avec succès', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * @description Met à jour une commande existante
 * @route   PUT /api/orders/:id
 * @access  Private/Admin
 */
const updateOrder = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }

    // 'dishes' intentionnellement absent : comportement existant conservé
    const allowedFields = ['customerName', 'totalPrice', 'formula', 'ingredients', 'menu', 'products'];
    const updateFields = { updatedAt: new Date() };
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) updateFields[field] = req.body[field];
    });

    const docRef = ordersCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Commande non trouvée', 404);

    await docRef.update(updateFields);
    const updatedOrder = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };

    const io = req.app.get('socketio');
    if (io) io.emit('order_updated', updatedOrder);

    sendSuccess(res, updatedOrder, 'Commande mise à jour avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Met à jour le statut d'une commande
 * @route   PUT /api/orders/:id/status
 * @access  Public (Admin peut modifier, invité peut-être limité)
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      throw new ApiError('Statut non valide', 400);
    }

    const docRef = ordersCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Commande non trouvée', 404);

    const updateFields = { status, updatedAt: new Date() };
    await docRef.update(updateFields);
    const updatedOrder = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updateFields };

    // --- TEMPS RÉEL (SOCKET.IO) ---
    // Notifie le KDS et potentiellement le client du changement de statut
    const io = req.app.get('socketio');
    if (io) io.emit('order_updated', updatedOrder);

    sendSuccess(res, updatedOrder, 'Statut de commande mis à jour avec succès');
  } catch (error) {
    next(error);
  }
};

// Ce que la commande a réellement fait sur les soldes de fidélité, pour l'inverser si elle
// disparaît : { [userId]: { earned, redeemed } } — `earned` à retirer, `redeemed` à rendre.
// Une suppression ne laissait aucune trace et les points restaient acquis.
// - remboursée intégralement : refundOrder a déjà tout inversé ;
// - réintégration Stripe : `loyaltyCredited` est la trace du crédit réel (0 avant le 2026-08-21) ;
// - parts d'une addition séparée : toutes si la table est réglée, sinon seulement celles dont les
//   points ont été appliqués à l'encaissement (convive parti avant la fin, `loyaltyApplied`) ;
// - commande simple : points gagnés (moins ceux déjà retirés par un remboursement partiel) et
//   points utilisés, seulement si elle a été réglée — une annulée ou une impayée n'a rien donné.
function deletionLoyaltyByUser(order) {
  if (order.status === 'refunded') return {};
  if (order.source === 'stripe_import') {
    const credited = Math.max(0, Math.floor(Number(order.loyaltyCredited) || 0));
    return order.user && credited > 0 ? { [order.user]: { earned: credited, redeemed: 0 } } : {};
  }
  const parts = order.splitPayments || [];
  if (parts.length) {
    const applied = order.paid ? parts : parts.filter(p => p && p.loyaltyApplied);
    return splitLoyaltyByUser(applied, order.user);
  }
  if (!order.paid || !order.user) return {};
  const alreadyRemoved = (order.refunds || []).reduce((s, r) => s + (r.pointsRemoved || 0), 0);
  const earned = Math.max(0, Math.floor(Number(order.finalPrice ?? order.totalPrice) || 0) - alreadyRemoved);
  const redeemed = Math.max(0, Math.floor(Number(order.pointsRedeemed) || 0));
  return earned || redeemed ? { [order.user]: { earned, redeemed } } : {};
}

// Mouvements de solde correspondants. Le solde ne descend jamais sous 0 : si le client a déjà
// dépensé ses points, `shortfall` dit combien n'ont pas pu être repris.
async function loyaltyReversalMoves(agg, readUser) {
  const moves = [];
  for (const [uid, { earned, redeemed }] of Object.entries(agg)) {
    if (!earned && !redeemed) continue;
    const snap = await readUser(uid);
    if (!snap.exists) continue;
    const balance = snap.data().loyaltyPoints || 0;
    const target = balance - earned + redeemed;
    const newBalance = Math.max(0, target);
    moves.push({ uid, name: snap.data().name || 'Client', earned, redeemed, balance, newBalance, shortfall: newBalance - target });
  }
  return moves;
}

/**
 * @description Aperçu des points qui seront repris si ces commandes sont supprimées — affiché
 *              dans la confirmation avant d'agir. Aucune écriture.
 * @route   POST /api/orders/deletion-impact   { ids: string[] }
 * @access  Private/Admin
 */
const getDeletionImpact = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (!ids.length) throw new ApiError('Aucune commande indiquée.', 400);

    const total = {};
    for (const id of ids) {
      const snap = await ordersCol.doc(id).get();
      if (!snap.exists) continue;
      for (const [uid, { earned, redeemed }] of Object.entries(deletionLoyaltyByUser(snap.data()))) {
        if (!total[uid]) total[uid] = { earned: 0, redeemed: 0 };
        total[uid].earned += earned;
        total[uid].redeemed += redeemed;
      }
    }
    const moves = await loyaltyReversalMoves(total, uid => usersCol.doc(uid).get());
    sendSuccess(res, { moves }, 'Impact fidélité calculé');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Supprime une commande et inverse ce qu'elle a fait sur les soldes de fidélité,
 *              dans la même transaction : la commande ne disparaît pas sans ses points.
 * @route   DELETE /api/orders/:id
 * @access  Private/Admin
 */
const deleteOrder = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }

    const docRef = ordersCol.doc(req.params.id);
    const moves = await db.runTransaction(async (tx) => {
      const existing = await tx.get(docRef);
      if (!existing.exists) throw new ApiError('Commande non trouvée', 404);
      const planned = await loyaltyReversalMoves(
        deletionLoyaltyByUser(existing.data()),
        uid => tx.get(usersCol.doc(uid)),
      );
      for (const m of planned) {
        tx.update(usersCol.doc(m.uid), { loyaltyPoints: m.newBalance, updatedAt: new Date() });
      }
      tx.delete(docRef);
      return planned;
    });

    const io = req.app.get('socketio');
    if (io) io.emit('order_deleted', { id: req.params.id });

    sendSuccess(res, { id: req.params.id, loyalty: moves }, 'Commande supprimée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Récupère les commandes d'un utilisateur spécifique
 * @route   GET /api/orders/user/:userId
 * @access  Private (Admin ou utilisateur propriétaire)
 */
const getOrdersByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!req.user) {
      throw new ApiError('Non autorisé, aucun token fourni', 401);
    }

    // Normaliser les IDs pour comparaison
    const requestUserId = userId.trim();
    const authUserId = req.user._id ? req.user._id.toString() : req.user.id;

    if (authUserId !== requestUserId && !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé', 403);
    }

    const orders = await findByUser(requestUserId);
    sendSuccess(res, orders, `Commandes de l'utilisateur ${requestUserId} récupérées avec succès`);
  } catch (error) {
    next(error);
  }
};

/**
 * @description Annule une commande (gérant uniquement)
 * @route   PATCH /api/orders/:id/cancel
 * @access  Private/Gérant
 */
const cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const canCancel = user.isAdmin;
    if (!canCancel) {
      return res.status(403).json({ message: 'Accès refusé. Droits administrateur requis.' });
    }

    const docRef = ordersCol.doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      return res.status(404).json({ message: 'Commande introuvable.' });
    }

    // Nature de l'annulation : ce qu'il reste à faire (rien / rembourser / vérifier).
    const { cancelType, cancelReason, cancelledAmount, cancelPayments } = req.body || {};
    const updates = {
      status: 'cancelled',
      cancelType: VALID_CANCEL_TYPES.includes(cancelType) ? cancelType : 'no_payment',
      cancelReason: (typeof cancelReason === 'string' && cancelReason.trim()) ? cancelReason.trim().slice(0, 300) : null,
      cancelledAmount: parseFloat(cancelledAmount) > 0 ? parseFloat(cancelledAmount) : 0,
      // Références des règlements déjà encaissés → indispensables pour rembourser depuis l'app.
      cancelPayments: Array.isArray(cancelPayments) ? cancelPayments : [],
      updatedAt: new Date(),
    };
    await docRef.update(updates);
    const order = { id: docRef.id, _id: docRef.id, ...existing.data(), ...updates };

    // Le PaymentIntent d'une vente abandonnée resterait sinon orphelin chez Stripe (non
    // rattaché à une commande), introuvable autrement que par date et montant.
    if (updates.cancelPayments.length) await tagPaymentIntents(order, order._id);

    const io = req.app.get('socketio');
    if (io) io.emit('order:cancelled', { orderId: order._id, order });

    res.json({ success: true, order });
  } catch (error) {
    console.error('cancelOrder error:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

/**
 * @description Récupère les commandes en ligne NON réglées d'un client (pour la caisse).
 *              Comme pour les tickets ouverts, service et encaissement sont deux cycles
 *              indépendants : une commande servie ('delivered') reste récupérable tant
 *              qu'elle n'est pas payée, sinon elle devient inencaissable depuis la caisse.
 * @route   GET /api/orders/online-unpaid/:userId
 * @access  Private/Admin
 */
const getUnpaidOnlineOrders = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }
    const all = await findByUser(req.params.userId);
    const list = all.filter(o =>
      o.source === 'online' && !o.paid && ['pending', 'preparing', 'ready', 'delivered'].includes(o.status)
    );
    sendSuccess(res, list, 'Commandes en ligne non réglées récupérées');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Tickets ouverts en caisse : commandes créées au comptoir, pas encore réglées.
 *              Service et encaissement sont deux cycles indépendants : un ticket marqué 'servi'
 *              ('delivered') reste ouvert tant qu'il n'est pas payé, sinon il devient
 *              inaccessible depuis la caisse. Seuls 'cancelled'/'refunded' sortent de la liste.
 * @route   GET /api/orders/open
 * @access  Private/Admin
 */
const getOpenTickets = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }
    const all = await findAll();
    const list = all.filter(o =>
      o.source === 'caisse' && !o.paid && ['open', 'pending', 'preparing', 'ready', 'delivered'].includes(o.status)
    );
    sendSuccess(res, list, 'Tickets ouverts récupérés');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Met à jour le CONTENU d'un ticket ouvert (ajout d'articles au fil du service) sans
 *              l'encaisser : réécrit les articles + totalPrice, garde paid:false, resync le KDS.
 *              Le front fait foi pour le total (cohérent avec createOrder/settle).
 * @route   PUT /api/orders/:id/items
 * @access  Private/Admin
 */
const updateOpenTicketItems = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }

    const docRef = ordersCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Commande non trouvée', 404);

    const current = existing.data();
    if (current.source !== 'caisse' || current.paid) {
      throw new ApiError('Cette commande n\'est pas un ticket ouvert modifiable.', 400);
    }

    const {
      customerName, totalPrice, formula, formulaQuantity = 1, ingredients, menu,
      products, dishes, cartProducts, bubbleTeas, milkshakes, salads = null, status,
      consumptionMode: rawConsumptionMode = null,
    } = req.body;

    // Transition de statut autorisée pour un ticket ouvert : rester 'open' (en attente) ou
    // passer 'pending' (= envoi en cuisine). On ne touche au statut que s'il est fourni et valide.
    const newStatus = (status === 'open' || status === 'pending') ? status : current.status;

    const hasSalads = Array.isArray(salads) && salads.length > 0;
    const hasSalade = !!formula || hasSalads;
    const hasDishes = Array.isArray(dishes) && dishes.length > 0;
    const hasCartProducts = Array.isArray(cartProducts) && cartProducts.length > 0;
    const hasProducts = Array.isArray(products) && products.length > 0;
    const hasBubbleTeas = Array.isArray(bubbleTeas) && bubbleTeas.length > 0;
    const hasMilkshakes = Array.isArray(milkshakes) && milkshakes.length > 0;
    // Un ticket qui reste 'open' (en attente) peut être vide ; l'envoi en cuisine exige un article + un total.
    if (newStatus !== 'open') {
      if (!totalPrice) throw new ApiError('Total manquant.', 400);
      if (!hasSalade && !hasDishes && !hasCartProducts && !hasProducts && !hasBubbleTeas && !hasMilkshakes) {
        throw new ApiError('Le ticket doit contenir au moins un article.', 400);
      }
    }

    const primarySalad = hasSalads ? salads[0] : null;
    const legacyFormula = formula || primarySalad?.formula || null;
    const legacyIngredients = (Array.isArray(ingredients) && ingredients.length ? ingredients : primarySalad?.ingredients) || [];
    const legacyFormulaQuantity = formula ? (formulaQuantity || 1) : (primarySalad?.quantity || 1);

    // TVA (prix TTC) : remises/points seulement à l'encaissement, donc base = totalPrice ici.
    const taxConfig = await getTaxConfig();
    const categoriesById = await loadCategoriesById();
    const composableCats = await loadComposableCategoryMaps();
    const consumptionMode = resolveConsumptionMode(rawConsumptionMode ?? current.consumptionMode, taxConfig);
    const tax = buildOrderTax({
      products, cartProducts,
      bubbleTeas: enrichComposables(bubbleTeas, 'bubbleTeaId', composableCats.bubbleTea),
      milkshakes: enrichComposables(milkshakes, 'milkshakeId', composableCats.milkshake),
      totalPrice, finalPrice: totalPrice, consumptionMode, config: taxConfig, categoriesById,
    });

    const updateFields = {
      customerName:   customerName || current.customerName,
      totalPrice,
      finalPrice:     totalPrice, // remises/points appliqués seulement à l'encaissement (settle)
      consumptionMode,
      taxBreakdown:   tax.breakdown,
      totalHT:        tax.totalHT,
      totalTVA:       tax.totalTVA,
      serviceRate:    taxConfig.serviceRate,
      formula:        legacyFormula,
      formulaQuantity: legacyFormulaQuantity,
      ingredients:    legacyIngredients,
      salads:         hasSalads ? salads : [],
      menu:           menu !== undefined ? menu : (current.menu || null),
      products:       products || [],
      dishes:         dishes || [],
      cartProducts:   cartProducts || [],
      bubbleTeas:     bubbleTeas || [],
      milkshakes:     milkshakes || [],
      status:         newStatus,
      updatedAt:      new Date(),
    };

    await docRef.update(updateFields);
    const updatedOrder = { id: docRef.id, _id: docRef.id, ...current, ...updateFields };

    // KDS : un ticket qui passe de 'open' à 'pending' est une NOUVELLE commande pour la cuisine
    // (new_order) ; un ticket déjà en cuisine qu'on modifie est une mise à jour (order_updated) ;
    // un ticket qui reste 'open' (toujours en attente) n'est pas notifié au KDS.
    const io = req.app.get('socketio');
    if (io && newStatus !== 'open') {
      io.emit(current.status === 'open' ? 'new_order' : 'order_updated', updatedOrder);
    }

    sendSuccess(res, updatedOrder, 'Ticket ouvert mis à jour');
  } catch (error) {
    next(error);
  }
};

const VALID_PART_METHODS = ['cash', 'card', 'ticket', 'mixed', 'points'];

/**
 * @description Enregistre un règlement PARTIEL sur un ticket ouvert : un convive paie sa part et
 *              s'en va pendant que la table continue de consommer.
 *
 *              Le règlement est persisté IMMÉDIATEMENT dans `splitPayments[]` — c'est ce qui le
 *              rend récupérable si la caisse tombe, et ce qui permet de le rembourser si la table
 *              est annulée ensuite (cf. cardPaymentSources, qui lit déjà les parts d'un split).
 *
 *              Le ticket reste NON réglé : rien n'entre en comptabilité avant sa clôture, qui
 *              compte la table entière en une seule fois (settleOnlineOrder). Aucun double
 *              comptage n'est donc possible, et le filtre `paid === true` de la compta reste vrai.
 *
 *              ⚠️ La fidélité de la part est appliquée ICI, pas à la clôture. Sinon
 *              `planSplitLoyalty` revaliderait le solde du convive plusieurs heures après son
 *              départ : s'il a dépensé ses points ailleurs entre-temps, la validation lève un 400
 *              et bloque l'encaissement de TOUTE la table. L'entrée porte donc `loyaltyApplied`
 *              et `splitLoyaltyByUser` l'ignore à la clôture.
 * @route   POST /api/orders/:id/part-payment
 * @access  Private/Admin
 */
const recordPartPayment = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }

    const docRef = ordersCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Commande non trouvée', 404);

    const current = existing.data();
    if (current.source !== 'caisse') throw new ApiError('Seul un ticket de caisse accepte un règlement partiel.', 400);
    if (current.paid) throw new ApiError('Cette commande est déjà réglée.', 400);
    if (current.status === 'cancelled') throw new ApiError('Cette commande est annulée.', 400);

    const {
      amount, method, items = null, pointsRedeemed = 0,
      user: partUser = null, userName = null, splitMode = null,
      paymentIntentId = null, cashGiven = 0, change = 0,
      cardAmount = 0, ticketAmount = 0, cashAmount = 0, cardPayments = null, ticketGiven = 0,
    } = req.body || {};

    const gross = round2(Number(amount) || 0);
    if (!(gross > 0)) throw new ApiError('Montant de la part invalide.', 400);
    if (!VALID_PART_METHODS.includes(method)) throw new ApiError('Moyen de paiement invalide.', 400);

    const redeemed = Math.max(0, Math.floor(Number(pointsRedeemed) || 0));
    if (redeemed > 0 && !partUser) throw new ApiError('Client requis pour utiliser des points.', 400);
    // Cartes passées au terminal pour cette part (plusieurs possibles, cf. utils/cardPayments.js).
    const passages = sanitizeCardPayments(cardPayments);
    // Net réellement encaissé par cette part : c'est lui qui donne les points gagnés (1 € = 1 pt).
    const net = round2(Math.max(0, gross - redeemed / POINTS_PER_EURO));

    // Le cumul des parts ne doit pas dépasser ce que la table doit : un trop-perçu ne se rattrape
    // que par un remboursement. Toléré si le total du ticket est encore à 0 (ticket vide).
    const alreadyPaid = round2((current.splitPayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const ceiling = round2(Number(current.totalPrice) || 0);
    if (ceiling > 0 && round2(alreadyPaid + gross) > ceiling + 0.01) {
      throw new ApiError(`Cette part dépasse le reste à payer (${round2(ceiling - alreadyPaid).toFixed(2)} €).`, 400);
    }

    // Fidélité de la part : solde VALIDÉ avant toute écriture, comme planSplitLoyalty.
    let loyalty = null;
    if (partUser) {
      const snap = await usersCol.doc(partUser).get();
      if (!snap.exists) throw new ApiError('Client introuvable.', 400);
      const balance = snap.data().loyaltyPoints || 0;
      if (redeemed > balance) {
        throw new ApiError(`Points insuffisants pour ${snap.data().name || 'ce client'} (demandé ${redeemed}, dispo ${balance}).`, 400);
      }
      const earned = Math.floor(net);
      loyalty = { uid: partUser, earned, newBalance: Math.max(0, balance - redeemed + earned) };
    }

    const entry = {
      index: (current.splitPayments || []).length + 1,
      // Identifiant stable du règlement : c'est lui qui permet à la clôture d'écarter une part
      // que la caisse renverrait par erreur, au lieu de l'encaisser deux fois (cf. mergeSplitPayments).
      partId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      amount: gross,
      method,
      ...(Array.isArray(items) && items.length
        ? { items: items.map(it => ({ label: String(it.label || ''), price: round2(it.price) })) }
        : {}),
      ...(redeemed > 0 ? { pointsRedeemed: redeemed } : {}),
      ...(partUser ? { user: partUser, userName: userName || null } : {}),
      ...(method === 'cash' ? { cashGiven: Number(cashGiven) || 0, change: round2(change) } : {}),
      ...(method === 'card' ? { paymentIntentId: paymentIntentId || null } : {}),
      // Titre-restaurant : papier (rien au terminal) ou carte passée au terminal (`passages`).
      ...(method === 'ticket' ? (passages.length
        ? {
            ticketAmount: round2(Math.max(0, net - sumKind(passages, 'meal_card'))),
            cardPayments: passages, mealCardAmount: sumKind(passages, 'meal_card'),
            paymentIntentId: passages[0].paymentIntentId,
          }
        : { ticketAmount: net, ...(Number(ticketGiven) > 0 ? { ticketGiven: round2(ticketGiven) } : {}) }) : {}),
      ...(method === 'mixed' ? {
        cardAmount: passages.length ? sumKind(passages, 'card') : round2(cardAmount),
        ...(passages.length ? { cardPayments: passages, mealCardAmount: sumKind(passages, 'meal_card') } : {}),
        ticketAmount: round2(ticketAmount), cashAmount: round2(cashAmount),
        paymentIntentId: passages[0]?.paymentIntentId || paymentIntentId || null,
        cashGiven: Number(cashGiven) || 0, change: round2(change),
      } : {}),
      // Points déjà crédités/débités : la clôture doit ignorer cette part (cf. splitLoyaltyByUser).
      ...(loyalty ? { loyaltyApplied: true } : {}),
      paidAt: new Date(),
    };

    const splitPayments = [...(current.splitPayments || []), entry];
    const updateFields = {
      splitPayments,
      isSplit: true,
      // Le mode est posé par le premier règlement et ne change plus ensuite.
      splitMode: current.splitMode || splitMode || 'free',
      splitCount: splitPayments.length,
      // Lecture directe pour la caisse et la liste des tickets ouverts : ce que la table a déjà versé.
      prepaidAmount: round2(alreadyPaid + gross),
      updatedAt: new Date(),
    };

    await docRef.update(updateFields);
    const updatedOrder = { id: docRef.id, _id: docRef.id, ...current, ...updateFields };

    if (loyalty) {
      await usersCol.doc(loyalty.uid).update({ loyaltyPoints: loyalty.newBalance, updatedAt: new Date() });
      console.log(`🎁 Part réglée — ${loyalty.uid} : -${redeemed} / +${loyalty.earned} pts → ${loyalty.newBalance}`);
    }

    // Rattache le PaymentIntent de la part à la commande côté Stripe. Best-effort.
    await tagPaymentIntents(updatedOrder, docRef.id);

    // Mouvement d'argent, pas de service : le ticket ne change pas d'état pour la cuisine, et un
    // ticket encore 'open' ne doit surtout pas apparaître au KDS à cette occasion.
    const io = req.app.get('socketio');
    if (io && current.status !== 'open') io.emit('order_updated', updatedOrder);

    sendSuccess(res, updatedOrder, 'Règlement partiel enregistré');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Encaisse à la caisse une commande passée en ligne (option A : on met à jour
 *              la commande existante, pas de doublon KDS). Réécrit les articles (online + ajouts
 *              du manager), marque la commande réglée et crédite la fidélité (c'est ici le paiement réel).
 * @route   PUT /api/orders/:id/settle
 * @access  Private/Admin
 */
const settleOnlineOrder = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }

    const docRef = ordersCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Commande non trouvée', 404);

    const current = existing.data();
    // Encaissable : une commande en ligne non réglée, OU un ticket ouvert caisse (source 'caisse' + non réglé).
    const isOpenTicket = current.source === 'caisse' && !current.paid;
    if (current.source !== 'online' && !isOpenTicket) {
      throw new ApiError('Cette commande ne peut pas être encaissée ainsi.', 400);
    }
    if (current.paid) throw new ApiError('Cette commande est déjà réglée.', 400);

    const {
      customerName, totalPrice, formula, formulaQuantity = 1, ingredients, menu, products, dishes,
      cartProducts, bubbleTeas, milkshakes, salads = null, pointsToRedeem = 0, manualDiscount = 0, discount = null, paymentMethod = null, paymentDetails = null,
      consumptionMode: rawConsumptionMode = null,
      isSplit = false, splitMode = null, splitCount = null, splitPayments = null,
    } = req.body;

    if (!totalPrice) throw new ApiError('Total manquant.', 400);

    // --- Règlements déjà encaissés sur ce ticket (un convive a payé sa part et est parti) ---
    // La caisse compose le solde SANS les connaître : les remplacer effacerait l'argent déjà
    // encaissé, les concaténer tels quels produirait deux « Part 1 ».
    const priorParts = (current.splitPayments || []).filter(p => p && Number(p.amount) > 0);
    // Un solde réglé en paiement simple écrirait `splitPayments: null` et effacerait ces parts.
    // Plutôt que de reconstituer une part à partir d'un paiement simple — ce qui mêlerait deux
    // traitements de points et risquerait un double crédit — on refuse : rien n'est perdu, et
    // la caisse encaisse le solde comme une part.
    if (priorParts.length && !isSplit) {
      throw new ApiError('Ce ticket porte déjà des parts encaissées : le solde doit être réglé en addition séparée.', 400);
    }
    // Sans part déjà encaissée, `mergedSplitPayments` EST le tableau reçu : comportement inchangé.
    const {
      splitPayments: mergedSplitPayments,
      splitCount: mergedSplitCount,
      merged: splitMerged,
    } = mergeSplitPayments(current.splitPayments, splitPayments);

    // Fidélité : on garde l'utilisateur d'origine s'il existe (commande en ligne).
    // Un ticket ouvert naît anonyme → on accepte un client identifié seulement à l'encaissement.
    const userId = current.user || req.body.user || null;

    // Remise commerciale (avant points), montant € — le front fait foi, plafonné au total.
    const manualDiscountAmount = Math.max(0, Math.min(Number(manualDiscount) || 0, Number(totalPrice) || 0));

    // --- REMBOURSEMENT POINTS (identique à createOrder) ---
    let pointsRedeemed = 0;
    let discountAmount = 0;
    let finalPrice = Math.max(0, totalPrice - manualDiscountAmount);
    let userDataForRedeem = null;

    if (pointsToRedeem && pointsToRedeem > 0) {
      if (!userId) throw new ApiError('Utilisateur requis pour utiliser des points.', 400);
      if (!Number.isInteger(pointsToRedeem) || pointsToRedeem < 0) throw new ApiError('Le nombre de points est invalide.', 400);
      const userSnap = await usersCol.doc(userId).get();
      if (!userSnap.exists) throw new ApiError('Utilisateur introuvable.', 400);
      userDataForRedeem = userSnap.data();
      if ((userDataForRedeem.loyaltyPoints || 0) < pointsToRedeem) throw new ApiError('Points insuffisants.', 400);
      pointsRedeemed = pointsToRedeem;
      discountAmount = pointsToRedeem / POINTS_PER_EURO;
      finalPrice = Math.max(0, totalPrice - manualDiscountAmount - discountAmount);
    }

    // Points utilisés PAR PART (split) : réduisent le net réglé → finalPrice / compta (cf. createOrder).
    // Sur les parts FUSIONNÉES : les points dépensés par un convive déjà parti ont réduit ce qu'il
    // a versé, donc le montant encaissé par la table. Les omettre surestimerait le chiffre d'affaires.
    if (isSplit) {
      const splitRedeemed = splitPointsRedeemedTotal(mergedSplitPayments);
      if (splitRedeemed > 0) {
        pointsRedeemed += splitRedeemed;
        discountAmount += splitRedeemed / POINTS_PER_EURO;
        finalPrice = Math.max(0, totalPrice - manualDiscountAmount - discountAmount);
      }
    }

    const hasSalads = Array.isArray(salads) && salads.length > 0;
    const primarySalad = hasSalads ? salads[0] : null;
    const legacyFormula = formula || primarySalad?.formula || current.formula || null;
    const legacyIngredients = (Array.isArray(ingredients) && ingredients.length ? ingredients : primarySalad?.ingredients) || [];
    const legacyFormulaQuantity = formula ? (formulaQuantity || 1) : (primarySalad?.quantity || 1);

    // --- TVA (prix TTC) : mode de conso (corps > commande existante > défaut) + ventilation ---
    const taxConfig = await getTaxConfig();
    const categoriesById = await loadCategoriesById();
    const composableCats = await loadComposableCategoryMaps();
    const consumptionMode = resolveConsumptionMode(rawConsumptionMode ?? current.consumptionMode, taxConfig);
    const tax = buildOrderTax({
      products, cartProducts,
      bubbleTeas: enrichComposables(bubbleTeas ?? current.bubbleTeas, 'bubbleTeaId', composableCats.bubbleTea),
      milkshakes: enrichComposables(milkshakes ?? current.milkshakes, 'milkshakeId', composableCats.milkshake),
      totalPrice, finalPrice, consumptionMode, config: taxConfig, categoriesById,
    });

    const updateFields = {
      user:           userId,
      customerName:   customerName || current.customerName,
      totalPrice,
      formula:        legacyFormula,
      formulaQuantity: legacyFormulaQuantity,
      ingredients:    legacyIngredients,
      salads:         hasSalads ? salads : (current.salads || []),
      menu:           menu !== undefined ? menu : (current.menu || null),
      products:       products || [],
      dishes:         dishes || [],
      cartProducts:   cartProducts || [],
      bubbleTeas:     bubbleTeas || (current.bubbleTeas || []),
      milkshakes:     milkshakes || (current.milkshakes || []),
      paid:           true,
      // Un ticket encore 'open' (jamais lancé) part en cuisine au moment du paiement.
      status:         current.status === 'open' ? 'pending' : current.status,
      paymentMethod:  paymentMethod || null,
      // cf. createOrder : la carte simple porte aussi un paymentIntentId à conserver.
      paymentDetails: DETAILED_METHODS.includes(paymentMethod) ? (withTerminalFields(paymentDetails) || null) : null,
      isSplit:        !!isSplit,
      splitMode:      isSplit ? splitMode : null,
      // Parts fusionnées : celles déjà encaissées sur le ticket + celles du solde (cf. mergeSplitPayments).
      splitCount:     isSplit ? (splitMerged ? mergedSplitCount : splitCount) : null,
      splitPayments:  isSplit ? mergedSplitPayments.map(withTerminalFields) : null,
      pointsRedeemed,
      discountAmount,
      manualDiscount: manualDiscountAmount,
      discount:       discount || null,
      finalPrice,
      consumptionMode,
      taxBreakdown:   tax.breakdown,
      totalHT:        tax.totalHT,
      totalTVA:       tax.totalTVA,
      serviceRate:    taxConfig.serviceRate,
      paidAt:         current.paidAt || new Date(),
      updatedAt:      new Date(),
    };

    // Split : valider les soldes points par client AVANT d'écrire (lève 400 si insuffisant).
    const splitLoyaltyPlan = isSplit ? await planSplitLoyalty(mergedSplitPayments, userId) : null;

    await docRef.update(updateFields);
    const updatedOrder = { id: docRef.id, _id: docRef.id, ...current, ...updateFields };

    // Rattache la commande à ses PaymentIntents côté Stripe (Dashboard). Best-effort.
    await tagPaymentIntents(updatedOrder, docRef.id);

    // FIDÉLITÉ — créditée maintenant (paiement réel). Mêmes règles que createOrder.
    if (isSplit) {
      // Split : débit des points utilisés + gain sur le net, PAR CLIENT.
      await applySplitLoyalty(splitLoyaltyPlan);
    } else if (userId && (pointsRedeemed > 0 || !isSplit)) {
      const userDoc = userDataForRedeem
        ? { exists: true, data: () => userDataForRedeem }
        : await usersCol.doc(userId).get();
      if (userDoc.exists) {
        const loyaltyPoints = userDoc.data().loyaltyPoints || 0;
        const pointsEarned = Math.floor(finalPrice);
        const newPoints = Math.max(0, loyaltyPoints - pointsRedeemed + pointsEarned);
        await usersCol.doc(userId).update({ loyaltyPoints: newPoints });
      }
    }

    // Le KDS reflète les ajouts du manager ; l'espace client voit la commande réglée.
    // Un ticket qui était 'open' apparaît pour la 1re fois au KDS (new_order) ; sinon mise à jour.
    const io = req.app.get('socketio');
    if (io) io.emit(current.status === 'open' ? 'new_order' : 'order_updated', updatedOrder);

    sendSuccess(res, updatedOrder, 'Commande en ligne encaissée avec succès');
  } catch (error) {
    next(error);
  }
};

/**
 * @description Rembourse une commande (total ou partiel).
 *              Moyen "carte" → remboursement RÉEL chez Stripe sur le(s) PaymentIntent(s) d'origine
 *              (`splitPartIndex` permet de viser une part précise d'une addition séparée) ;
 *              espèces / tickets resto / points restent une trace locale.
 *              Total → status 'refunded' (terminal). Partiel → status opérationnel conservé,
 *              l'état est porté par refundedAmount + refunds[].
 * @route   PATCH /api/orders/:id/refund
 * @access  Private/Admin
 */
const refundOrder = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isAdmin) {
      throw new ApiError('Accès non autorisé. Admin requis.', 403);
    }

    const { amount, items = null, reason = null, method = null, splitPartIndex = null } = req.body;

    const docRef = ordersCol.doc(req.params.id);
    const existing = await docRef.get();
    if (!existing.exists) throw new ApiError('Commande non trouvée', 404);

    const order = existing.data();

    // Une vente annulée APRÈS encaissement est remboursable : l'argent est bien entré en caisse,
    // même si la commande n'a jamais été réglée (`paid: false`, cf. createOrder). Ce qu'il faut
    // rendre vit dans `cancelledAmount`, pas dans `finalPrice` (le total de la note abandonnée).
    const isCancelledRefund = order.status === 'cancelled'
      && order.cancelType === 'refund_due'
      && round2(order.cancelledAmount || 0) > 0;

    if (!isCancelledRefund) {
      if (!order.paid) throw new ApiError('Commande non réglée : rien à rembourser.', 400);
      if (order.status === 'cancelled') throw new ApiError('Commande annulée : rien à rembourser.', 400);
    }
    if (order.status === 'refunded') throw new ApiError('Commande déjà remboursée intégralement.', 400);

    // Montant réellement payé par le client (après remise points).
    const paidAmount = isCancelledRefund
      ? round2(order.cancelledAmount)
      : round2(order.finalPrice != null ? order.finalPrice : order.totalPrice);
    const alreadyRefunded = round2(order.refundedAmount || 0);
    const remaining = round2(paidAmount - alreadyRefunded);

    const refundAmount = round2(amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new ApiError('Montant de remboursement invalide.', 400);
    }
    if (refundAmount > remaining + 0.001) {
      throw new ApiError(`Montant supérieur au remboursable (${remaining.toFixed(2)} €).`, 400);
    }

    // Remboursement partiel incompatible avec une remise points globale (cf. split "par article").
    // Évalué sur le montant DEMANDÉ, avant tout appel Stripe : on ne rembourse pas pour échouer ensuite.
    const isFullRequested = round2(alreadyRefunded + refundAmount) >= paidAmount - 0.001;
    if (!isFullRequested && (order.pointsRedeemed || 0) > 0) {
      throw new ApiError('Remboursement partiel impossible sur une commande avec remise en points : rembourser la totalité.', 400);
    }

    // --- REMBOURSEMENT STRIPE (moyen "carte" uniquement) ---
    // Le gérant peut rembourser en espèces une commande payée par carte : dans ce cas on ne
    // touche pas à Stripe. En "carte", on rejoue le(s) PaymentIntent(s) réellement encaissé(s).
    const stripeEntries = [];
    let stripeRefunded = 0;
    let stripeWarning = null;
    let effectiveAmount = refundAmount;

    if (method === 'card') {
      const refundedByPI = stripeRefundedByPI(order);
      let sources = cardPaymentSources(order).filter((s) => s.paymentIntentId);

      // Addition séparée : viser une part précise (sinon cascade sur les parts, dans l'ordre).
      if (splitPartIndex !== null && splitPartIndex !== '' && splitPartIndex !== undefined) {
        const idx = Number(splitPartIndex);
        sources = sources.filter((s) => s.index === idx);
        if (!sources.length) throw new ApiError(`Part ${idx} : aucun paiement carte remboursable.`, 400);
      }

      const available = round2(sources.reduce(
        (s, x) => s + Math.max(0, x.amount - (refundedByPI[x.paymentIntentId] || 0)), 0));
      if (sources.length && refundAmount > available + 0.001) {
        throw new ApiError(`Remboursable sur carte : ${available.toFixed(2)} € (le reste a été réglé autrement).`, 400);
      }

      let left = refundAmount;
      for (const s of sources) {
        if (left <= 0.001) break;
        const remainingOnPI = round2(s.amount - (refundedByPI[s.paymentIntentId] || 0));
        if (remainingOnPI <= 0.001) continue;
        const chunk = round2(Math.min(left, remainingOnPI));
        try {
          const r = await stripe.refunds.create({
            payment_intent: s.paymentIntentId,
            amount: Math.round(chunk * 100),
            metadata: { orderId: req.params.id, ...(reason ? { reason } : {}) },
          });
          stripeEntries.push({
            id: r.id, paymentIntentId: s.paymentIntentId, amount: chunk,
            status: r.status || null, part: s.index,
          });
          stripeRefunded = round2(stripeRefunded + chunk);
          left = round2(left - chunk);
        } catch (err) {
          // Rien n'est encore parti → on refuse net, aucune écriture. Sinon on n'annule pas ce qui
          // est déjà remboursé chez Stripe : on enregistre le montant RÉEL et on le signale.
          if (!stripeEntries.length) throw new ApiError(`Remboursement Stripe refusé : ${err.message}`, 400);
          stripeWarning = `Stripe interrompu : ${stripeRefunded.toFixed(2)} € remboursés sur ${refundAmount.toFixed(2)} € demandés (${err.message}).`;
          break;
        }
      }

      if (stripeEntries.length) effectiveAmount = stripeRefunded;
      else if (!sources.length) {
        stripeWarning = 'Aucun paiement carte tracé sur cette commande : remboursement enregistré, à effectuer manuellement dans le Dashboard Stripe.';
      }
    }

    const newRefundedAmount = round2(alreadyRefunded + effectiveAmount);
    const isFull = newRefundedAmount >= paidAmount - 0.001;

    // --- AJUSTEMENT FIDÉLITÉ ---
    // Total : retire le gain restant + recrédite les points utilisés.
    // Partiel : retire le gain au prorata (1 € = 1 pt), ne recrédite pas les points utilisés.
    let pointsRemoved = 0;
    let pointsCredited = 0;

    if (isCancelledRefund) {
      // Vente annulée : aucun point n'a JAMAIS été crédité ni débité (la fidélité ne s'applique
      // qu'à la finalisation, et createOrder garde `paid: false`). Retirer un gain ici retirerait
      // au client des points qu'il n'a jamais reçus.
    } else if (order.isSplit) {
      // Split : gain/débit ont été appliqués PAR CLIENT (par part). Un refund TOTAL les inverse par client :
      // recrédite les points utilisés (redeemed) et retire le gain (earned) de CHAQUE client concerné.
      // Le partiel-avec-points est déjà bloqué plus haut ; un partiel-sans-points ne touche pas les points.
      if (isFull) {
        const agg = splitLoyaltyByUser(order.splitPayments, order.user);
        for (const [uid, { redeemed, earned }] of Object.entries(agg)) {
          if (redeemed === 0 && earned === 0) continue;
          const snap = await usersCol.doc(uid).get();
          if (!snap.exists) continue;
          const cur = snap.data().loyaltyPoints || 0;
          await usersCol.doc(uid).update({ loyaltyPoints: Math.max(0, cur + redeemed - earned) });
          pointsRemoved += earned;
          pointsCredited += redeemed;
        }
      }
    } else {
      const userId = order.user || null;
      if (userId) {
        const pointsEarnedOriginal = Math.floor(paidAmount);
        const pointsAlreadyRemoved = Array.isArray(order.refunds)
          ? order.refunds.reduce((s, r) => s + (r.pointsRemoved || 0), 0)
          : 0;
        const earnedRemaining = Math.max(0, pointsEarnedOriginal - pointsAlreadyRemoved);

        if (isFull) {
          pointsRemoved = earnedRemaining;
          pointsCredited = order.pointsRedeemed || 0;
        } else {
          pointsRemoved = Math.min(earnedRemaining, Math.floor(effectiveAmount));
        }

        if (pointsRemoved > 0 || pointsCredited > 0) {
          const userSnap = await usersCol.doc(userId).get();
          if (userSnap.exists) {
            const cur = userSnap.data().loyaltyPoints || 0;
            const next = Math.max(0, cur - pointsRemoved + pointsCredited);
            await usersCol.doc(userId).update({ loyaltyPoints: next });
          }
        }
      }
    }

    const refundEntry = {
      amount: effectiveAmount,
      items: Array.isArray(items) ? items : null,
      reason: reason || null,
      method: method || null,
      pointsRemoved,
      pointsCredited,
      // Trace Stripe : refunds réellement créés (vide = remboursement enregistré côté app seulement).
      stripe: stripeEntries.length ? stripeEntries : null,
      stripeRefunded,
      splitPartIndex: splitPartIndex !== null && splitPartIndex !== '' && splitPartIndex !== undefined
        ? Number(splitPartIndex) : null,
      by: req.user.id || null,
      at: new Date(),
    };

    const updateFields = {
      refundedAmount: newRefundedAmount,
      refunds: [...(Array.isArray(order.refunds) ? order.refunds : []), refundEntry],
      updatedAt: new Date(),
    };
    // Total → statut terminal 'refunded'. Partiel → on conserve le statut opérationnel.
    // Une vente annulée reste 'cancelled' : la passer à 'refunded' effacerait le fait qu'elle a
    // été annulée. Son avancement se lit sur refundedAmount vs cancelledAmount.
    if (isFull && !isCancelledRefund) updateFields.status = 'refunded';

    await docRef.update(updateFields);
    const updatedOrder = { id: docRef.id, _id: docRef.id, ...order, ...updateFields };

    const io = req.app.get('socketio');
    if (io) io.emit('order_updated', updatedOrder);

    const baseMessage = isFull ? 'Commande remboursée intégralement' : 'Commande remboursée partiellement';
    const message = stripeWarning
      ? `${baseMessage} — ${stripeWarning}`
      : stripeRefunded > 0
        ? `${baseMessage} — ${stripeRefunded.toFixed(2)} € remboursés sur la carte du client`
        : baseMessage;

    sendSuccess(res, updatedOrder, message);
  } catch (error) {
    next(error);
  }
};

/**
 * Envoie le ticket (ou le justificatif d'une part) d'une commande par email ou SMS.
 * Partagée par la route manuelle d'envoi et la confirmation automatique à la création
 * d'une commande en ligne : un seul endroit décide du contenu du message.
 * Lève une ApiError sur un destinataire invalide — l'appelant décide s'il la montre au
 * client (route manuelle) ou l'avale (best-effort à la création).
 */
async function deliverReceipt(order, { channel, dest, detail = true, part = null }) {
  const subject = part
    ? `Votre justificatif Café Verde — Part ${part.index} · ${orderLabel(order)}`
    : `Votre ticket Café Verde — Commande ${orderLabel(order)}`;

  if (channel === 'email') {
    if (!EMAIL_RE.test(dest)) throw new ApiError('Adresse email invalide.', 400);
    await sendEmail({
      to: dest,
      toName: part?.userName || order.customerName,
      subject,
      html: renderEmailHtml(order, { detail, part }),
    });
  } else {
    // Défaut GP, aligné sur backend/utils/phone.js (réconciliation E.164).
    const parsedPhone = parsePhoneNumberFromString(dest, 'GP');
    if (!parsedPhone || !parsedPhone.isValid()) throw new ApiError('Numéro de téléphone invalide.', 400);
    await sendSms({
      to: parsedPhone.number.replace('+', ''), // E.164 sans le '+' (format attendu par Brevo)
      content: renderSmsText(order, { detail, part }),
    });
  }
}

/**
 * @description Envoie le ticket d'une commande par email ou SMS (via Brevo).
 * @route   POST /api/orders/:id/send-receipt
 * @access  Private (propriétaire de la commande ou admin)
 */
const sendReceipt = async (req, res, next) => {
  try {
    if (!req.user) throw new ApiError('Non autorisé, aucun token fourni', 401);

    const { channel, to } = req.body;
    if (!['email', 'sms'].includes(channel)) throw new ApiError('Canal invalide (email ou sms).', 400);
    const detail = req.body.detail !== false; // ticket « sans détail » si false (défaut : détaillé)

    const order = await findById(req.params.id);
    if (!order) throw new ApiError('Commande non trouvée', 404);

    // Autorisation : propriétaire de la commande ou admin.
    if (!req.user.isAdmin && order.user !== req.user.id) {
      throw new ApiError('Accès non autorisé', 403);
    }

    const dest = (to || '').trim();
    if (!dest) throw new ApiError('Destinataire requis.', 400);

    // Justificatif d'UNE part (convive parti avant la fin du repas) plutôt que la note de la
    // table. `partIndex` est le numéro de part, tel qu'il figure dans splitPayments.
    const rawPart = req.body.partIndex;
    let part = null;
    if (rawPart !== undefined && rawPart !== null && rawPart !== '') {
      const idx = Number(rawPart);
      if (!Number.isInteger(idx) || idx < 1) throw new ApiError('Numéro de part invalide.', 400);
      // Une part peut être réglée en plusieurs fois : toutes ses entrées portent le même numéro.
      const entries = (order.splitPayments || []).filter((x) => Number(x.index) === idx);
      if (!entries.length) throw new ApiError('Part introuvable sur cette commande.', 404);
      part = entries.length === 1
        ? entries[0]
        : { ...entries[0], amount: entries.reduce((s2, x) => s2 + (Number(x.amount) || 0), 0) };
    }

    await deliverReceipt(order, { channel, dest, detail, part });

    // Fidélité silencieuse : rattache/crédite une commande anonyme, ou complète le 2e contact
    // sur la fiche légère. Best-effort, ne bloque jamais l'envoi du ticket.
    if (order.paid && !part) {
      try {
        await linkAnonymousLoyalty(order, channel, dest);
      } catch (e) {
        console.error('Fidélité anonyme (non bloquant) :', e.message);
      }
    }

    sendSuccess(res, { channel, to: dest }, `Ticket envoyé par ${channel === 'email' ? 'email' : 'SMS'}`);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  getDeletionImpact,
  getOrdersByUser,
  cancelOrder,
  getUnpaidOnlineOrders,
  getOpenTickets,
  updateOpenTicketItems,
  recordPartPayment,
  settleOnlineOrder,
  refundOrder,
  sendReceipt,
  promoteScheduledOrders
};
