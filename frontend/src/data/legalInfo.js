// frontend/src/data/legalInfo.js
//
// Alimente les pages Mentions légales, CGV, CGU et Politique de confidentialité.
//
// ⚠️ L'identité de l'établissement (adresse, SIRET, TVA, téléphone) vient de
// `utils/merchant.js` — MERCHANT est la SOURCE UNIQUE, partagée avec le ticket
// de caisse et la facture. Ne jamais recopier ces valeurs ici : une adresse ou
// un SIRET qui diverge d'un document à l'autre est un défaut de conformité.
//
// ⚠️ À COMPLÉTER : les valeurs entre crochets ci-dessous ne sont connues que de
// l'associé (dénomination légale, forme juridique, RCS, médiateur…). Tant
// qu'elles ne sont pas fournies, les pages légales publiques affichent ces
// marqueurs.
//
// ⚠️ Ces textes sont des modèles génériques. Ils ne remplacent pas la
// validation d'un juriste avant mise en production.

import { MERCHANT } from '../utils/merchant';

// Les lignes d'adresse de MERCHANT sont formatées pour un ticket (une par ligne) ;
// les mentions légales veulent une adresse sur une seule ligne.
const adressePostale = MERCHANT.addressLines
  .map((l) => l.replace(/,\s*$/, ''))
  .join(', ');

export const legalInfo = {
  // --- Identité de l'éditeur ---
  siteName: MERCHANT.name,
  raisonSociale: '[RAISON SOCIALE]',
  formeJuridique: '[FORME JURIDIQUE — ex: SAS, SARL, auto-entrepreneur]',
  capitalSocial: '[CAPITAL SOCIAL — ex: 1 000 €]',
  adresse: adressePostale,
  siret: MERCHANT.siret,
  rcs: '[RCS — ex: RCS Pointe-à-Pitre 123 456 789]',
  tvaIntra: MERCHANT.vat,

  // --- Contact ---
  email: '[EMAIL DE CONTACT]',
  telephone: MERCHANT.phone,

  // --- Responsable de publication ---
  directeurPublication: '[NOM DU DIRECTEUR DE LA PUBLICATION]',

  // --- Hébergement (valeurs réelles de la stack — à vérifier) ---
  hebergeurFront: 'Vercel Inc. — 340 S Lemon Ave #4133, Walnut, CA 91789, USA — vercel.com',
  hebergeurBack: 'Google Cloud Platform (Cloud Run) — Google Cloud EMEA Limited, Velasco, Clanwilliam Place, Dublin 2, Irlande',
  hebergeurData: 'Google Firebase (Firestore / Storage / Auth) — Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA',

  // --- Médiation / RGPD ---
  mediateur: '[NOM ET COORDONNÉES DU MÉDIATEUR DE LA CONSOMMATION]',
  dpoContact: '[EMAIL DU CONTACT DONNÉES / DPO]',

  // --- Dates de mise à jour (format libre, ex: "3 juin 2026") ---
  lastUpdated: '[DATE DE MISE À JOUR]',
};

export default legalInfo;
