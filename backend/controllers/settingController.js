// backend/controllers/settingController.js
const asyncHandler = require('express-async-handler');
const { getTaxConfig, setTaxConfig, getHoursConfig, setHoursConfig } = require('../models/Setting');
const { getOnlineOrderingStatus, getSchedulingOffer, getTodayPickupOffer, closedMessage, parseTime } = require('../utils/hours');

/**
 * @desc    Lit la configuration TVA globale
 * @route   GET /api/settings/tax
 * @access  Public
 * @note    Public à dessein : la boutique la lit AVANT toute connexion pour appliquer
 *          le mode de consommation par défaut. Protégée, l'erreur était avalée en
 *          silence côté client et le réglage du gérant ne s'appliquait jamais à un
 *          visiteur non connecté. Les taux ne sont pas un secret — ils figurent sur
 *          chaque ticket. `updatedBy` est en revanche un identifiant interne : il ne
 *          sort pas d'une route ouverte.
 */
const getTax = asyncHandler(async (req, res) => {
  const { updatedBy, ...config } = await getTaxConfig();
  res.json(config);
});

/**
 * @desc    Met à jour la configuration TVA globale (taux par défaut + mode en ligne)
 * @route   PUT /api/settings/tax
 * @access  Private (Espace Gérant)
 */
const updateTax = asyncHandler(async (req, res) => {
  const { rates, defaultMode, serviceRate } = req.body;
  const patch = {};

  // Validation aux frontières : taux numériques dans [0, 100], mode valide.
  if (rates && typeof rates === 'object') {
    patch.rates = {};
    for (const k of ['dineIn', 'takeaway']) {
      if (rates[k] !== undefined) {
        const v = Number(rates[k]);
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          return res.status(400).json({ message: `Taux « ${k} » invalide (attendu : 0 à 100).` });
        }
        patch.rates[k] = v;
      }
    }
  }
  if (defaultMode !== undefined) {
    if (!['dineIn', 'takeaway'].includes(defaultMode)) {
      return res.status(400).json({ message: 'Mode par défaut invalide.' });
    }
    patch.defaultMode = defaultMode;
  }
  if (serviceRate !== undefined) {
    const s = Number(serviceRate);
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      return res.status(400).json({ message: 'Taux de service invalide (0 à 100).' });
    }
    patch.serviceRate = s;
  }

  const updated = await setTaxConfig(patch, req.user?.id || null);

  const io = req.app.get('socketio');
  if (io) io.emit('tax_config_updated', updated);

  res.json(updated);
});

/**
 * @desc    Lit les horaires d'ouverture et l'état courant de la commande en ligne
 * @route   GET /api/settings/hours
 * @access  Public
 * @note    Public à dessein : la boutique doit savoir si elle peut prendre une commande
 *          AVANT toute connexion. `status` est calculé ici — l'horloge du serveur fait foi,
 *          celle du visiteur peut être fausse ou réglée sur un autre fuseau.
 */
const getHours = asyncHandler(async (req, res) => {
  const config = await getHoursConfig();
  const now = new Date();
  const status = getOnlineOrderingStatus(config, now);
  res.json({
    config,
    status,
    message: closedMessage(status),
    // Créneaux de retrait du jour, proposés dès que la commande est ouverte (null = aucun).
    todayPickup: getTodayPickupOffer(config, now),
    // Journée pour laquelle une commande à l'avance est acceptée (null = aucune).
    scheduling: getSchedulingOffer(config, now),
    serverTime: now.toISOString(),
  });
});

/**
 * @desc    Met à jour les horaires d'ouverture
 * @route   PUT /api/settings/hours
 * @access  Private (Espace Gérant)
 */
const updateHours = asyncHandler(async (req, res) => {
  const { days, preOrderLead, lastOrderMargin, onlineOrderingEnabled, closedDates } = req.body;
  const patch = {};

  // Validation aux frontières : on refuse une saisie fausse plutôt que de la normaliser
  // en silence — un gérant qui tape 18h-02h doit comprendre pourquoi ça ne passe pas.
  if (days && typeof days === 'object') {
    patch.days = {};
    for (const key of Object.keys(days)) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i > 6) {
        return res.status(400).json({ message: `Jour « ${key} » invalide (attendu : 0 à 6).` });
      }
      const slot = days[key];
      if (slot === null) { patch.days[i] = null; continue; } // jour fermé
      const open = parseTime(slot?.open);
      const close = parseTime(slot?.close);
      if (open === null || close === null) {
        return res.status(400).json({ message: 'Horaire invalide (format attendu : HH:MM).' });
      }
      if (close <= open) {
        return res.status(400).json({ message: "L'heure de fermeture doit être après l'heure d'ouverture (un service à cheval sur minuit n'est pas géré)." });
      }
      patch.days[i] = { open: slot.open, close: slot.close };
    }
  }

  if (preOrderLead !== undefined) {
    const l = Number(preOrderLead);
    if (!Number.isFinite(l) || l < 0 || l > 720) {
      return res.status(400).json({ message: "Avance de prise de commande invalide (0 à 720 minutes)." });
    }
    patch.preOrderLead = Math.round(l);
  }

  if (lastOrderMargin !== undefined) {
    const m = Number(lastOrderMargin);
    if (!Number.isFinite(m) || m < 0 || m > 720) {
      return res.status(400).json({ message: 'Marge de dernière commande invalide (0 à 720 minutes).' });
    }
    patch.lastOrderMargin = Math.round(m);
  }

  if (onlineOrderingEnabled !== undefined) {
    patch.onlineOrderingEnabled = !!onlineOrderingEnabled;
  }

  if (closedDates !== undefined) {
    if (!Array.isArray(closedDates)) {
      return res.status(400).json({ message: 'Liste de fermetures exceptionnelles invalide.' });
    }
    for (const d of closedDates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
        return res.status(400).json({ message: `Date de fermeture « ${d} » invalide (attendu : AAAA-MM-JJ).` });
      }
    }
    patch.closedDates = closedDates;
  }

  const updated = await setHoursConfig(patch, req.user?.id || null);

  const io = req.app.get('socketio');
  if (io) io.emit('hours_config_updated', { config: updated, status: getOnlineOrderingStatus(updated, new Date()) });

  res.json({ config: updated, status: getOnlineOrderingStatus(updated, new Date()) });
});

module.exports = { getTax, updateTax, getHours, updateHours };
