// Refus du lecteur traduits en consignes pour la caissière : Stripe renvoie une description
// technique en anglais, alors qu'elle a besoin de savoir s'il faut attendre (le client s'y
// reprend, ça va aboutir) ou proposer un autre moyen de paiement.
// On indexe sur le CODE, jamais sur le message : le message est reformulable côté Stripe.
const DECLINE_MESSAGES = {
  online_or_offline_pin_required: 'Le client doit insérer sa carte et taper son code',
  offline_pin_required: 'Le client doit insérer sa carte et taper son code',
  incorrect_pin: 'Code incorrect — le client peut réessayer',
  pin_try_exceeded: 'Trop de codes erronés, carte bloquée — proposez un autre paiement',
  card_removed: 'Carte retirée trop tôt — représentez-la sur le terminal',
  card_read_timed_out: 'Carte mal lue — représentez-la sur le terminal',
  try_again_later: 'Refus temporaire de la banque — représentez la carte',
  insufficient_funds: 'Provision insuffisante — proposez un autre paiement',
  withdrawal_count_limit_exceeded: 'Plafond de la carte atteint — proposez un autre paiement',
  expired_card: 'Carte expirée — proposez un autre paiement',
  card_not_supported: 'Carte non acceptée — proposez un autre paiement',
  currency_not_supported: 'Devise non acceptée par la carte',
  invalid_amount: 'Montant refusé par la banque',
  not_permitted: 'Opération non autorisée par la banque',
  do_not_honor: 'Carte refusée par la banque',
  generic_decline: 'Carte refusée par la banque',
  card_declined: 'Carte refusée par la banque',
};

// Variantes pour un refus qui CLÔT la transaction : la caisse annule le PaymentIntent et libère
// le lecteur juste après, donc la carte ne peut plus y être représentée. Sans ces variantes, on
// affichait « le client peut réessayer » au moment même où on lui retirait cette possibilité
// (constaté le 05/09/2026 sur un `incorrect_pin`). Les codes dont la consigne est déjà
// « proposez un autre paiement » restent valables dans les deux cas et n'ont pas de variante.
const ABORTED_MESSAGES = {
  online_or_offline_pin_required: 'Code requis — relancez l\'encaissement, le client devra insérer sa carte',
  offline_pin_required: 'Code requis — relancez l\'encaissement, le client devra insérer sa carte',
  incorrect_pin: 'Code incorrect — relancez l\'encaissement',
  card_removed: 'Carte retirée trop tôt — relancez l\'encaissement',
  card_read_timed_out: 'Carte mal lue — relancez l\'encaissement',
  try_again_later: 'Refus temporaire de la banque — relancez l\'encaissement',
};

// Repli sur le message Stripe : un code non répertorié ne doit jamais être moins informatif
// qu'avant traduction. Compléter la table au fil des refus réellement rencontrés en caisse.
// `aborted` : la transaction est abandonnée dans la foulée (cf. ABORTED_MESSAGES).
export const declineLabel = (code, fallback, aborted = false) =>
  (aborted ? ABORTED_MESSAGES[code] : null) || DECLINE_MESSAGES[code] || fallback || 'Paiement refusé';
