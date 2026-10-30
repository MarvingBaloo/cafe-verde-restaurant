import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { fetchOrders } from '../services/api';
import { tsToDate } from '../utils/orderTicket';

const STORAGE_KEY = 'cafeverde.onlineOrderSound';
const ACK_KEY = 'cafeverde.onlineOrderAcked';
const SOUND_EVENT = 'cafeverde:onlineOrderSound';   // synchronise le mute entre pages du même onglet
const REPEAT_MS = 10000;

// Statuts pour lesquels une commande en ligne reste une tâche en cours.
const ACTIVE_STATUSES = ['pending', 'preparing', 'ready'];

const idOf = (o) => o?._id || o?.id || null;
// Service et encaissement sont deux cycles indépendants (même règle que les tickets ouverts) :
// une commande servie mais non réglée reste dans la liste, sinon elle devient inencaissable.
const isOnlineActive = (o) =>
  o?.source === 'online' &&
  (ACTIVE_STATUSES.includes(o?.status) || (o?.status === 'delivered' && !o?.paid));
const atMs = (o) => tsToDate(o?.createdAt)?.getTime() ?? 0;
const byArrival = (a, b) => atMs(a.order) - atMs(b.order);

const readEnabled = () => localStorage.getItem(STORAGE_KEY) !== 'off';

// Acquittements persistés : une commande qu'on a fait taire ne doit pas resonner au rechargement.
const readAcked = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(ACK_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
};
const addAcked = (ids) => {
  const merged = new Set([...readAcked(), ...ids]);
  localStorage.setItem(ACK_KEY, JSON.stringify([...merged]));
};

// Interrupteur global : écrit le réglage et prévient les autres consommateurs du hook
// (même onglet via l'event custom, autres onglets via l'event 'storage' natif).
export const setOnlineSoundEnabled = (value) => {
  localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: value }));
};

// Salve d'alarme générée en WAV (aucun asset à embarquer) : 3 bips deux-tons en onde carrée,
// amplitude proche du maximum pour percer le bruit du service.
const buildAlarmWav = () => {
  const rate = 44100;
  const beep = 0.18, gap = 0.1, count = 3;
  const frames = Math.floor(rate * count * (beep + gap));
  const pcm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const pos = t % (beep + gap);
    if (pos > beep) continue;
    const freq = pos < beep / 2 ? 1000 : 1400;
    const square = Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1;
    const fade = Math.min(1, pos / 0.005, (beep - pos) / 0.005);   // évite les clics en début/fin
    pcm[i] = square * fade * 32767 * 0.9;
  }
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
};

/**
 * Alerte sonore + suivi des commandes en ligne.
 * Une commande 'pending' sonne (salve répétée toutes les REPEAT_MS) jusqu'à acquittement —
 * manuel via la cloche de la ligne, ou automatique quand la cuisine la prend en charge.
 */
export default function useOnlineOrderAlert() {
  const [enabled, setEnabled] = useState(readEnabled);
  const [needsUnlock, setNeedsUnlock] = useState(false);   // passe à true seulement si le navigateur refuse
  const [entries, setEntries] = useState([]);              // [{ order, ringing }] trié par ordre d'arrivée
  const [loading, setLoading] = useState(true);
  const [diagnostic, setDiagnostic] = useState('');        // retour lisible du bouton « Tester le son »
  const audioRef = useRef(null);
  const prevRinging = useRef(0);
  const wasArmed = useRef(false);

  const getAudio = () => {
    if (!audioRef.current) {
      const el = new Audio(buildAlarmWav());
      el.volume = 1;
      audioRef.current = el;
    }
    return audioRef.current;
  };

  useEffect(() => () => { if (audioRef.current) URL.revokeObjectURL(audioRef.current.src); }, []);

  const playBurst = useCallback((onResult) => {
    const el = getAudio();
    try { el.pause(); el.currentTime = 0; } catch { /* pas encore chargé */ }
    const done = onResult || (() => {});
    el.play()
      .then(() => { setNeedsUnlock(false); done(null); })
      .catch(err => {
        // NotAllowedError = politique d'autoplay : il faut un geste utilisateur sur la page.
        if (err?.name === 'NotAllowedError') setNeedsUnlock(true);
        done(err);
      });
  }, []);

  // Test manuel : un vrai clic est derrière, donc l'échec éventuel est un problème d'environnement.
  const testSound = useCallback(() => {
    setDiagnostic('Lecture en cours…');
    playBurst(err => {
      if (!err) setDiagnostic('Son émis. Si tu n\'entends rien : volume du poste, ou onglet mis en sourdine par le navigateur.');
      else if (err.name === 'NotAllowedError') setDiagnostic('Le navigateur bloque le son : clique une fois dans la page puis réessaie.');
      else setDiagnostic(`Lecture impossible (${err.name || 'erreur'}).`);
    });
  }, [playBurst]);

  // Réglage global : suit les changements faits ailleurs dans l'app ou dans un autre onglet.
  useEffect(() => {
    const onCustom = (e) => setEnabled(!!e.detail);
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setEnabled(readEnabled()); };
    window.addEventListener(SOUND_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SOUND_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Liste initiale. Une commande 'pending' non acquittée sonne même si elle est arrivée avant
  // l'ouverture de la page (caisse rechargée, poste redémarré…) ; 'preparing'/'ready' sont déjà traitées.
  useEffect(() => {
    let cancelled = false;
    fetchOrders()
      .then(res => {
        const d = res.data;
        const all = Array.isArray(d) ? d
          : Array.isArray(d?.data) ? d.data
          : Array.isArray(d?.message) ? d.message : [];
        if (cancelled) return;
        const active = all.filter(isOnlineActive);
        const activeIds = new Set(active.map(idOf));
        localStorage.setItem(ACK_KEY, JSON.stringify(readAcked().filter(id => activeIds.has(id))));
        const acked = new Set(readAcked());
        // Fusion : une commande arrivée par socket pendant le chargement garde son état « sonne ».
        setEntries(prev => {
          const known = new Set(prev.map(e => idOf(e.order)));
          const loaded = active
            .filter(o => !known.has(idOf(o)))
            .map(order => ({ order, ringing: order.status === 'pending' && !acked.has(idOf(order)) }));
          return [...prev, ...loaded].sort(byArrival);
        });
      })
      .catch(err => console.error('Commandes en ligne — chargement échoué:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const remove = (id) => { if (id) setEntries(prev => prev.filter(e => idOf(e.order) !== id)); };

    const upsert = (order, ring) => setEntries(prev => {
      const id = idOf(order);
      if (!id) return prev;
      const idx = prev.findIndex(e => idOf(e.order) === id);
      if (idx === -1) return [...prev, { order, ringing: ring }].sort(byArrival);
      // Sortie de 'pending' = la commande est prise en charge : elle acquitte l'alerte.
      prev = [...prev];
      prev[idx] = { order, ringing: prev[idx].ringing && order.status === 'pending' };
      return prev;
    });

    const onNewOrder = (o) => { if (isOnlineActive(o)) upsert(o, o.status === 'pending'); };
    const onOrderUpdated = (o) => {
      if (o?.source !== 'online') return;
      if (isOnlineActive(o)) upsert(o, false); else remove(idOf(o));
    };
    const onOrderCancelled = ({ orderId }) => remove(orderId);
    const onOrderDeleted = ({ id }) => remove(id);

    socket.on('new_order', onNewOrder);
    socket.on('order_updated', onOrderUpdated);
    socket.on('order:cancelled', onOrderCancelled);
    socket.on('order_deleted', onOrderDeleted);
    return () => {
      socket.off('new_order', onNewOrder);
      socket.off('order_updated', onOrderUpdated);
      socket.off('order:cancelled', onOrderCancelled);
      socket.off('order_deleted', onOrderDeleted);
    };
  }, []);

  const ringingCount = entries.filter(e => e.ringing).length;

  useEffect(() => {
    const armed = enabled && ringingCount > 0;
    const grew = ringingCount > prevRinging.current;
    // justArmed couvre la réactivation du son alors qu'une commande attend déjà : sans lui,
    // le premier bip attendrait le rappel suivant.
    const justArmed = armed && !wasArmed.current;
    prevRinging.current = ringingCount;
    wasArmed.current = armed;
    if (!armed) return;
    if (grew || justArmed) playBurst();
    const timer = setInterval(playBurst, REPEAT_MS);
    return () => clearInterval(timer);
  }, [ringingCount, enabled, playBurst]);

  // Acquittement d'une commande précise (cloche de la ligne) — ne touche pas à son statut.
  const silence = useCallback((id) => {
    addAcked([id]);
    setEntries(prev => prev.map(e => (idOf(e.order) === id ? { ...e, ringing: false } : e)));
  }, []);

  const silenceAll = useCallback(() => {
    setEntries(prev => {
      addAcked(prev.filter(e => e.ringing).map(e => idOf(e.order)));
      return prev.map(e => (e.ringing ? { ...e, ringing: false } : e));
    });
  }, []);

  const toggle = useCallback(() => setOnlineSoundEnabled(!readEnabled()), []);

  return {
    orders: entries,          // [{ order, ringing }] par ordre d'arrivée
    loading,
    ringingCount,
    silence,
    silenceAll,
    enabled,
    toggle,
    needsUnlock,
    unlock: testSound,        // le bandeau « son bloqué » relance une lecture depuis un clic
    testSound,
    diagnostic,
  };
}
