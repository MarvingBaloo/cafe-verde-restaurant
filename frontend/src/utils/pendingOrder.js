// src/utils/pendingOrder.js
// Commande en attente de confirmation Stripe.
// Le 3-D Secure peut imposer une redirection pleine page vers la banque : le composant
// qui portait le panier est alors détruit. Cette copie permet de créer la commande au
// retour (voir pages/PaymentReturn.jsx). sessionStorage : effacé à la fermeture d'onglet.
const KEY = 'cafeverde_pending_order';

export const savePendingOrder = (payload) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage indisponible (navigation privée, quota) : on n'empêche pas le
    // paiement pour autant. Au retour, PaymentReturn affichera l'écran « orphan ».
  }
};

export const loadPendingOrder = () => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // illisible ou corrompu : traité comme absent
  }
};

export const clearPendingOrder = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Rien à faire : la copie expirera avec l'onglet.
  }
};
