import { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * TPE simulé — caisse locale uniquement (lecteur simulé du compte Stripe de TEST). Le serveur
 * dit s'il est actif ; avec une clé live, il ne l'est jamais et l'encadré ne s'affiche pas.
 * Ne rien faire = le client n'a pas encore présenté sa carte (pour tester « Annuler »).
 */
const TerminalSimulator = ({ terminalStatus, amount }) => {
  const [enabled, setEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/payment/terminal/simulator').then(({ data }) => setEnabled(!!data?.enabled)).catch(() => {});
  }, []);

  if (!enabled) return null;
  const waiting = terminalStatus === 'collecting';

  const present = async (outcome) => {
    setSending(true);
    setError('');
    try {
      await api.post('/payment/terminal/simulate', { outcome });
    } catch (err) {
      setError(err.response?.data?.message || 'Simulation impossible');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[60] w-64 bg-gray-900 text-white rounded-xl shadow-2xl p-3 text-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-300">TPE simulé (test)</p>
      {waiting ? (
        <>
          <p className="mt-1 text-2xl font-extrabold">{(amount || 0).toFixed(2)} €</p>
          <p className="text-xs text-gray-300">En attente de la carte — ne rien faire pour tester « Annuler »</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={() => present('pay')} disabled={sending}
              className="py-2 rounded-lg bg-emerald-500 font-bold hover:bg-emerald-600 disabled:opacity-40">Le client paie</button>
            <button onClick={() => present('decline')} disabled={sending}
              className="py-2 rounded-lg bg-red-500 font-bold hover:bg-red-600 disabled:opacity-40">Carte refusée</button>
          </div>
        </>
      ) : (
        <p className="mt-1 text-gray-300">Aucun montant en attente</p>
      )}
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
};

export default TerminalSimulator;
