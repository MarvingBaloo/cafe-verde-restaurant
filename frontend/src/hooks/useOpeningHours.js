// frontend/src/hooks/useOpeningHours.js
// État d'ouverture de la commande en ligne, pour tout écran qui doit s'y adapter.
//
// Le serveur reste l'autorité : il refuse une commande hors créneau quoi que dise
// l'écran. Ce hook recalcule localement, à partir de la MÊME règle (utils/hours.js,
// généré depuis le backend), pour que la page bascule à l'heure dite sans que le
// client ait à la recharger — un panier composé à 20h29 ne doit pas rester validable
// à 20h31.
import { useCallback, useEffect, useState } from 'react';
import { fetchOpeningHours } from '../services/api';
import { getOnlineOrderingStatus, getSchedulingOffer, getTodayPickupOffer, closedMessage } from '../utils/hours';

const TICK_MS = 30 * 1000;

export const useOpeningHours = () => {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const [todayPickup, setTodayPickup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const recompute = useCallback((cfg) => {
    if (!cfg) return;
    const now = new Date();
    setStatus(getOnlineOrderingStatus(cfg, now));
    setScheduling(getSchedulingOffer(cfg, now));
    // Les créneaux du jour avancent avec l'heure : recalculés au même rythme que le
    // statut, sinon l'écran continuerait de proposer un retrait déjà dépassé.
    setTodayPickup(getTodayPickupOffer(cfg, now));
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetchOpeningHours();
      const cfg = res.data?.config || null;
      setConfig(cfg);
      // Premier rendu : on affiche ce que le serveur a calculé (son horloge fait foi),
      // les recalculs suivants sont locaux.
      setStatus(res.data?.status || null);
      setScheduling(res.data?.scheduling || null);
      setTodayPickup(res.data?.todayPickup || null);
      setUnavailable(false);
    } catch {
      // Réglages injoignables : on n'invente pas une fermeture. Le serveur refusera
      // de lui-même si c'est fermé — mieux vaut laisser passer le client jusqu'au
      // message du serveur que fermer la boutique sur une panne de lecture.
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!config) return undefined;
    const id = setInterval(() => recompute(config), TICK_MS);
    return () => clearInterval(id);
  }, [config, recompute]);

  // Tant que rien n'est chargé, on ne bloque pas : `closed` n'est vrai que sur une
  // réponse explicite du serveur.
  const closed = !!status && status.open === false;

  return {
    config,
    status,
    scheduling,          // journée acceptée pour une commande à l'avance (ou null)
    todayPickup,         // créneaux de retrait du jour (ou null hors fenêtre de commande)
    loading,
    unavailable,
    closed,
    message: status ? closedMessage(status) : null,
    reload,
  };
};

export default useOpeningHours;
