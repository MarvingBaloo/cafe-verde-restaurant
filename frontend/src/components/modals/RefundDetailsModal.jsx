import Icon from '../Icon';
import { tsToDate } from '../../utils/orderTicket';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const eur = (n) => `${round2(n).toFixed(2)} €`;

const methodLabelFr = (m) => (
  m === 'cash' ? 'Espèces'
    : m === 'card' ? 'Carte'
      : m === 'ticket' ? 'Tickets resto'
        : m === 'mixed' ? 'Paiement mixte'
          : 'Moyen inconnu'
);

// Les dates de commande sont forcées en heure Guadeloupe : consultées d'ailleurs, elles
// suivraient sinon le fuseau du navigateur et afficheraient une heure fausse.
const fmtDate = (value) => {
  const d = tsToDate(value);
  if (!d) return '—';
  return d.toLocaleString('fr-FR', {
    timeZone: 'America/Guadeloupe',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/**
 * Détail des remboursements d'une commande : ce qui a été encaissé, ce qui a été rendu,
 * par quel moyen, quand et par qui. `userNames` (optionnel) résout les ids d'opérateur.
 */
const RefundDetailsModal = ({ order, userNames = {}, onClose }) => {
  const refunds = Array.isArray(order.refunds) ? order.refunds : [];
  const refunded = round2(order.refundedAmount || 0);
  const isCancelled = order.status === 'cancelled';
  // Référence : ce qui avait été encaissé (vente annulée) ou payé (commande réglée).
  const reference = isCancelled
    ? round2(order.cancelledAmount || 0)
    : round2(order.finalPrice != null ? order.finalPrice : order.totalPrice);
  const due = round2(reference - refunded);

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6 pb-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-2xl text-purple-700"><Icon name="refund" /></span>
          <div>
            <h2 className="font-serif font-bold text-xl text-gray-900">Détails du remboursement</h2>
            <p className="text-sm text-gray-500">{order.customerName}</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">{isCancelled ? 'Encaissé avant annulation' : 'Payé'}</span>
              <span className="font-semibold">{eur(reference)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Remboursé</span>
              <span className="font-semibold text-purple-700">{eur(refunded)}</span>
            </div>
            {due > 0.001 && (
              <div className="flex justify-between">
                <span className="text-orange-700 font-semibold">Reste à rembourser</span>
                <span className="font-bold text-orange-700">{eur(due)}</span>
              </div>
            )}
          </div>

          {/* Ce qui était entré en caisse (vente annulée) : indique si l'argent est sorti du
              tiroir ou est reparti sur une carte. */}
          {isCancelled && (order.cancelPayments || []).length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">Encaissements annulés</p>
              <ul className="text-sm space-y-1">
                {order.cancelPayments.map((p, i) => (
                  <li key={i} className="flex justify-between gap-2 border-b border-gray-100 pb-1 last:border-0">
                    <span className="text-gray-700">
                      {p.partIndex != null ? `Part ${p.partIndex} · ` : ''}{methodLabelFr(p.method)}
                      {p.userName ? ` · ${p.userName}` : ''}
                    </span>
                    <span className="font-semibold whitespace-nowrap">{eur(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">
              {refunds.length > 1 ? `${refunds.length} remboursements` : 'Remboursement'}
            </p>
            {refunds.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun remboursement enregistré.</p>
            ) : (
              <ul className="space-y-3">
                {refunds.map((r, i) => (
                  <li key={i} className="text-sm border border-gray-200 rounded-lg p-3 space-y-1">
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-bold text-gray-900">{eur(r.amount)}</span>
                      <span className="text-xs font-semibold text-gray-600">{methodLabelFr(r.method)}</span>
                    </div>
                    <p className="text-xs text-gray-500">{fmtDate(r.at)}</p>
                    {r.by && userNames[r.by] && (
                      <p className="text-xs text-gray-500">Par {userNames[r.by]}</p>
                    )}
                    {r.splitPartIndex != null && (
                      <p className="text-xs text-gray-500">Part {r.splitPartIndex}</p>
                    )}
                    {r.reason && <p className="text-xs text-gray-600 italic">« {r.reason} »</p>}
                    {/* Trace Stripe : sans elle, le remboursement n'a été qu'enregistré côté app. */}
                    {Array.isArray(r.stripe) && r.stripe.length > 0 ? (
                      <div className="text-xs text-blue-700 space-y-0.5 pt-1">
                        {r.stripe.map((s, k) => (
                          <p key={k}>
                            <Icon name="card" /> {eur(s.amount)} rendus sur la carte ·{' '}
                            <a href={`https://dashboard.stripe.com/payments/${s.paymentIntentId}`}
                              target="_blank" rel="noopener noreferrer" className="underline font-mono">
                              {s.paymentIntentId}
                            </a>
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 pt-1">Enregistré côté application (pas d'appel Stripe).</p>
                    )}
                    {(r.pointsCredited > 0 || r.pointsRemoved > 0) && (
                      <p className="text-xs text-amber-700">
                        {r.pointsCredited > 0 && `+${r.pointsCredited} pts recrédités`}
                        {r.pointsCredited > 0 && r.pointsRemoved > 0 && ' · '}
                        {r.pointsRemoved > 0 && `−${r.pointsRemoved} pts retirés`}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button onClick={onClose}
            className="w-full py-2 border-2 border-gray-200 rounded-lg font-semibold text-gray-600 hover:bg-gray-50 transition">
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

export default RefundDetailsModal;
