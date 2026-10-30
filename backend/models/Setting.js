// backend/models/Setting.js
// Couche d'accès Firestore pour la collection "settings" (réglages globaux).
// Un document = un bloc de réglages identifié par un id fixe.
// Ici : doc `tax` (config TVA) et doc `hours` (horaires + fenêtre de commande en ligne).

const { settings: settingsCol } = require('../config/firestore');
const { parseTime, RESTAURANT_TIMEZONE } = require('../utils/hours');

const TAX_DOC_ID = 'tax';
const HOURS_DOC_ID = 'hours';

// Défauts Guadeloupe (taux normal 8,5 %) — modifiables par le gérant via l'Espace Gérant.
const DEFAULT_TAX_CONFIG = {
  rates: { dineIn: 8.5, takeaway: 8.5 },
  defaultMode: 'dineIn', // mode appliqué aux commandes en ligne
  serviceRate: 0,        // % « service compris » affiché sur le ticket (0 = masqué)
};

/** Normalise un doc de config TVA (valeurs sûres, jamais d'undefined). */
function formatTaxConfig(data) {
  const d = data || {};
  return {
    rates: {
      dineIn:   Number(d.rates?.dineIn   ?? DEFAULT_TAX_CONFIG.rates.dineIn),
      takeaway: Number(d.rates?.takeaway ?? DEFAULT_TAX_CONFIG.rates.takeaway),
    },
    defaultMode: d.defaultMode === 'takeaway' ? 'takeaway' : 'dineIn',
    serviceRate: Number(d.serviceRate ?? DEFAULT_TAX_CONFIG.serviceRate),
    updatedAt: d.updatedAt ?? null,
    updatedBy: d.updatedBy ?? null,
  };
}

/** Lit la config TVA. Retourne les défauts si le doc n'existe pas encore. */
async function getTaxConfig() {
  const doc = await settingsCol.doc(TAX_DOC_ID).get();
  if (!doc.exists) return formatTaxConfig(DEFAULT_TAX_CONFIG);
  return formatTaxConfig(doc.data());
}

/** Met à jour la config TVA (patch partiel : rates et/ou defaultMode). */
async function setTaxConfig(patch = {}, updatedBy = null) {
  const current = await getTaxConfig();
  const next = formatTaxConfig({
    rates: { ...current.rates, ...(patch.rates || {}) },
    defaultMode: patch.defaultMode ?? current.defaultMode,
    serviceRate: patch.serviceRate ?? current.serviceRate,
  });
  next.updatedAt = new Date();
  next.updatedBy = updatedBy || null;
  await settingsCol.doc(TAX_DOC_ID).set(next, { merge: true });
  return next;
}

// --- Horaires d'ouverture / fenêtre de commande en ligne ---

// 0 = dimanche … 6 = samedi. `null` = fermé ce jour-là.
// Défaut = les horaires réels de Café Verdé (Lun-Sam 12h-21h en continu, fermé le dimanche).
const DEFAULT_HOURS_CONFIG = {
  timezone: RESTAURANT_TIMEZONE,
  days: {
    0: null,
    1: { open: '12:00', close: '21:00' },
    2: { open: '12:00', close: '21:00' },
    3: { open: '12:00', close: '21:00' },
    4: { open: '12:00', close: '21:00' },
    5: { open: '12:00', close: '21:00' },
    6: { open: '12:00', close: '21:00' },
  },
  preOrderLead: 60,           // minutes avant l'ouverture : la prise de commande démarre déjà
  lastOrderMargin: 30,        // minutes avant la fermeture : plus aucune commande en ligne n'entre
  onlineOrderingEnabled: true, // coupure manuelle immédiate (panne, imprévu du jour)
  closedDates: [],             // fermetures exceptionnelles prévues, au format 'YYYY-MM-DD'
};

/** Normalise un créneau de journée. Renvoie null (= fermé) dès que la saisie est inexploitable. */
function formatDaySlot(slot) {
  if (!slot) return null;
  const open = parseTime(slot.open);
  const close = parseTime(slot.close);
  // Un créneau à cheval sur minuit (close <= open) n'est pas géré : la saisie le refuse
  // (voir settingController). Ici on se contente de ne jamais laisser passer un créneau faux.
  if (open === null || close === null || close <= open) return null;
  return { open: slot.open, close: slot.close };
}

/** Normalise un doc d'horaires (valeurs sûres, jamais d'undefined). */
function formatHoursConfig(data) {
  const d = data || {};
  const days = {};
  for (let i = 0; i <= 6; i += 1) {
    // `null` = jour fermé, et c'est une valeur voulue : il faut la distinguer de « absent ».
    // Un `??` sur le défaut rouvrirait tout seul un jour que le gérant a fermé.
    const src = d.days || {};
    const raw = i in src ? src[i] : (String(i) in src ? src[String(i)] : undefined);
    days[i] = formatDaySlot(raw === undefined ? DEFAULT_HOURS_CONFIG.days[i] : raw);
  }
  const margin = Number(d.lastOrderMargin ?? DEFAULT_HOURS_CONFIG.lastOrderMargin);
  const lead = Number(d.preOrderLead ?? DEFAULT_HOURS_CONFIG.preOrderLead);
  return {
    timezone: RESTAURANT_TIMEZONE, // non modifiable : le restaurant ne déménage pas de fuseau
    days,
    preOrderLead: Number.isFinite(lead) && lead >= 0 ? Math.round(lead) : 0,
    lastOrderMargin: Number.isFinite(margin) && margin >= 0 ? Math.round(margin) : 0,
    onlineOrderingEnabled: d.onlineOrderingEnabled !== false,
    closedDates: Array.isArray(d.closedDates)
      ? [...new Set(d.closedDates.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s))))].sort()
      : [],
    updatedAt: d.updatedAt ?? null,
    updatedBy: d.updatedBy ?? null,
  };
}

/** Lit les horaires. Retourne les défauts si le doc n'existe pas encore. */
async function getHoursConfig() {
  const doc = await settingsCol.doc(HOURS_DOC_ID).get();
  if (!doc.exists) return formatHoursConfig(DEFAULT_HOURS_CONFIG);
  return formatHoursConfig(doc.data());
}

/** Met à jour les horaires (patch partiel). */
async function setHoursConfig(patch = {}, updatedBy = null) {
  const current = await getHoursConfig();
  const next = formatHoursConfig({
    days: { ...current.days, ...(patch.days || {}) },
    preOrderLead: patch.preOrderLead ?? current.preOrderLead,
    lastOrderMargin: patch.lastOrderMargin ?? current.lastOrderMargin,
    onlineOrderingEnabled: patch.onlineOrderingEnabled ?? current.onlineOrderingEnabled,
    closedDates: patch.closedDates ?? current.closedDates,
  });
  next.updatedAt = new Date();
  next.updatedBy = updatedBy || null;
  // `set` sans merge : `days` est un objet dont une journée passée à null doit
  // réellement disparaître — un merge Firestore la conserverait.
  await settingsCol.doc(HOURS_DOC_ID).set(next);
  return next;
}

module.exports = { settingsCol, TAX_DOC_ID, DEFAULT_TAX_CONFIG, formatTaxConfig, getTaxConfig, setTaxConfig,
  HOURS_DOC_ID, DEFAULT_HOURS_CONFIG, formatHoursConfig, getHoursConfig, setHoursConfig };
