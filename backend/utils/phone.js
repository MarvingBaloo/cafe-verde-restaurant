// backend/utils/phone.js
const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Normalise un numéro en E.164 (format international, ex. +590690123456).
 * @param {string} raw            numéro saisi
 * @param {string} defaultCountry pays par défaut pour un numéro local SANS indicatif
 *                                (Guadeloupe). Les numéros avec `+indicatif` sont respectés.
 * @returns {string|null} E.164 si valide, la saisie nettoyée si non parsable, null si vide.
 */
function normalizePhone(raw, defaultCountry = 'GP') {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (parsed && parsed.isValid()) return parsed.number;
  return trimmed;
}

module.exports = { normalizePhone };
