// backend/utils/orderNumber.js
// Numéro de commande unique, aléatoire, préfixé par le canal :
//   CA-K7QM4X  → prise en caisse
//   WB-K7QM4X  → passée en ligne
//
// Aléatoire assumé (aucun ordre déductible), mais l'unicité n'est PAS laissée au
// hasard : chaque tirage est confronté à la base avant d'être retenu. C'est ce qui
// manquait à l'ancien WEB-XXXX, qui pouvait produire deux fois le même numéro.

const { ordersCol } = require('../models/Order.js');

// Sans caractères ambigus à l'oral ni à la lecture : ni O/0, ni I/1.
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 6; // 31^6 ≈ 887 millions de combinaisons
const MAX_ATTEMPTS = 5;

const CHANNEL_PREFIX = { online: 'WB' };
const DEFAULT_PREFIX = 'CA';

function randomCode() {
  let code = '';
  for (let i = 0; i < LENGTH; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

/** true si le numéro est déjà porté par une commande. */
async function isTaken(orderNumber) {
  const snap = await ordersCol.where('orderNumber', '==', orderNumber).limit(1).get();
  return !snap.empty;
}

/**
 * Tire un numéro libre. Retente tant que le tirage est déjà pris (invraisemblable à
 * cette longueur, mais la garantie ne coûte qu'une lecture).
 *
 * Best-effort assumé sur les deux modes de défaillance :
 * - la vérification échoue techniquement → on garde le tirage (1 chance sur 887 M
 *   d'être un doublon) plutôt que de priver la commande de numéro ;
 * - les 5 tirages sont tous pris → null, et la commande retombe sur l'affichage
 *   #XXXX dérivé de son id. Un encaissement ne doit jamais échouer pour un numéro.
 */
async function allocateOrderNumber(source) {
  const prefix = CHANNEL_PREFIX[source] || DEFAULT_PREFIX;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `${prefix}-${randomCode()}`;
    try {
      if (!(await isTaken(candidate))) return candidate;
    } catch (err) {
      console.warn('⚠️ Vérification d\'unicité du numéro impossible :', err.message);
      return candidate;
    }
  }

  console.warn(`⚠️ Aucun numéro libre après ${MAX_ATTEMPTS} tirages — commande sans numéro.`);
  return null;
}

module.exports = { allocateOrderNumber };
