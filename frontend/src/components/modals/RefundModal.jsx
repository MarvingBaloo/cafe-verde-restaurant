import { useState, useMemo } from 'react';
import Icon from '../Icon';
import { passageAmount } from '../../utils/cardPayments';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const METHODS = [
  { key: 'cash',   label: 'Espèces',       icon: 'cash' },
  { key: 'card',   label: 'Carte',         icon: 'card' },
  { key: 'ticket', label: 'Tickets resto', icon: 'ticket' },
];

const POINTS_PER_EURO = 10;

// Libellé du moyen d'un règlement encaissé (inclut 'mixed', absent de METHODS).
const methodLabelFr = (m) => (
  m === 'cash' ? 'espèces'
    : m === 'card' ? 'carte'
      : m === 'ticket' ? 'tickets resto'
        : m === 'mixed' ? 'paiement mixte'
          : 'moyen inconnu'
);

// Miroir de `cardPaymentSources` (backend) : montants réglés par carte, avec leur PaymentIntent.
// Sert à annoncer ce qui partira réellement chez Stripe et à cibler une part d'addition séparée.
const cardSources = (order) => {
  // Un règlement peut avoir passé plusieurs cartes au terminal : une source par carte.
  const expand = (entry, legacyAmount, index, label) => {
    const passages = (entry?.cardPayments || []).filter((c) => passageAmount(c) > 0);
    const list = passages.length
      ? passages.map((c) => ({ amount: passageAmount(c), kind: c.kind, paymentIntentId: c.paymentIntentId || null }))
      : (round2(legacyAmount) > 0 ? [{ amount: round2(legacyAmount), kind: 'card', paymentIntentId: entry?.paymentIntentId || null }] : []);
    return list.map((c, k) => ({
      index,
      label: list.length > 1 ? `${label} — ${c.kind === 'meal_card' ? 'titre-resto' : 'carte'} ${k + 1}` : label,
      paymentIntentId: c.paymentIntentId,
      amount: c.amount,
    }));
  };

  // Vente annulée après encaissement : les règlements vivent dans `cancelPayments`.
  if (order.status === 'cancelled' && Array.isArray(order.cancelPayments)) {
    return order.cancelPayments.flatMap((p, i) => expand(
      p,
      p.method === 'mixed' ? (Number(p.cardAmount) || 0) : (p.method === 'card' ? (Number(p.amount) || 0) : 0),
      p.partIndex != null ? Number(p.partIndex) : null,
      p.partIndex != null ? `Part ${p.partIndex}` : `Règlement ${i + 1}`,
    ));
  }

  if (order.isSplit && Array.isArray(order.splitPayments)) {
    return order.splitPayments.flatMap((p, i) => {
      const index = p.index != null ? Number(p.index) : i + 1;
      const redeemed = Math.max(0, Math.floor(Number(p.pointsRedeemed) || 0));
      const legacyAmount = p.method === 'card'
        ? Math.max(0, (Number(p.amount) || 0) - redeemed / POINTS_PER_EURO)
        : p.method === 'mixed' ? Number(p.cardAmount) || 0 : 0;
      return expand(p, legacyAmount, index, `Part ${index}`);
    });
  }
  const paid = round2(order.finalPrice != null ? order.finalPrice : order.totalPrice);
  const details = order.paymentDetails || null;
  if (details?.cardPayments?.length) return expand(details, 0, null, 'Paiement carte');
  const pi = order.paymentIntentId || details?.paymentIntentId || null;
  const amount = order.paymentMethod === 'mixed'
    ? round2(Number(details?.cardAmount) || 0)
    : order.paymentMethod === 'card' ? paid : (order.paymentIntentId ? paid : 0);
  return amount > 0 ? [{ index: null, label: 'Paiement carte', paymentIntentId: pi, amount }] : [];
};

// Montants déjà remboursés chez Stripe, par PaymentIntent.
const stripeRefundedByPI = (order) => {
  const acc = {};
  for (const r of (Array.isArray(order.refunds) ? order.refunds : [])) {
    for (const s of (Array.isArray(r.stripe) ? r.stripe : [])) {
      if (!s.paymentIntentId) continue;
      acc[s.paymentIntentId] = round2((acc[s.paymentIntentId] || 0) + (Number(s.amount) || 0));
    }
  }
  return acc;
};

/**
 * Modale de remboursement (total ou partiel), partagée entre l'Espace Gérant et la Caisse.
 * L'appelant fournit `order` (pour le remboursable + garde-fous) et `lines` normalisées
 * ({ key, label, price }) pour la sélection par article. `onConfirm` reçoit
 * { amount, items, reason, method } et doit renvoyer une promesse.
 */
const RefundModal = ({ order, lines = [], onConfirm, onClose, submitting = false }) => {
  // Vente annulée après encaissement : ce qu'il faut rendre est le montant ENCAISSÉ
  // (`cancelledAmount`), pas le total de la note abandonnée.
  const isCancelledRefund = order.status === 'cancelled'
    && order.cancelType === 'refund_due'
    && round2(order.cancelledAmount || 0) > 0;
  const paidAmount = isCancelledRefund
    ? round2(order.cancelledAmount)
    : round2(order.finalPrice != null ? order.finalPrice : order.totalPrice);
  const alreadyRefunded = round2(order.refundedAmount || 0);
  const maxRefundable = round2(paidAmount - alreadyRefunded);

  // Payeurs identifiés sur les règlements encaissés : à afficher, car sur une addition séparée
  // ils diffèrent parfois du client de la vente — c'est à eux qu'il faut rendre l'argent.
  const cancelPayers = isCancelledRefund
    ? [...new Set((order.cancelPayments || []).map(p => p.userName).filter(Boolean))]
    : [];

  // Remise points globale → partiel par article incompatible (cf. split "par article").
  const hasPointsRedeem = (order.pointsRedeemed || 0) > 0;
  // Une vente annulée n'a pas d'articles « payés » à rendre : le partiel se fait au montant.
  const canPartial = lines.length > 0 && !hasPointsRedeem && !isCancelledRefund;

  const [mode, setMode] = useState('total'); // 'total' | 'partial'
  const [selected, setSelected] = useState({}); // key -> bool
  const [amountInput, setAmountInput] = useState(maxRefundable.toFixed(2));
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const [partIndex, setPartIndex] = useState(null); // part visée (split) ; null = cascade sur les parts

  const selectedLines = useMemo(
    () => lines.filter((l) => selected[l.key]),
    [lines, selected]
  );

  // Sources carte encore remboursables via Stripe.
  const sources = useMemo(() => {
    const refunded = stripeRefundedByPI(order);
    return cardSources(order)
      .filter((s) => s.paymentIntentId)
      .map((s) => ({ ...s, available: round2(s.amount - (refunded[s.paymentIntentId] || 0)) }))
      .filter((s) => s.available > 0.001);
  }, [order]);

  // Une part réglée en plusieurs fois porte plusieurs sources de même `index` : le sélecteur
  // en présente UNE par part (disponible cumulé), le backend rembourse ensuite en cascade
  // sur chacun de ses PaymentIntents.
  const partOptions = useMemo(() => {
    const byIndex = new Map();
    for (const s of sources) {
      if (s.index == null) continue;
      const cur = byIndex.get(s.index);
      if (cur) cur.available = round2(cur.available + s.available);
      else byIndex.set(s.index, { index: s.index, label: `Part ${s.index}`, available: s.available });
    }
    return [...byIndex.values()];
  }, [sources]);

  const isCard = method === 'card';
  const canTargetPart = partOptions.length > 1;
  const targetedSources = partIndex == null ? sources : sources.filter((s) => s.index === partIndex);
  const cardAvailable = round2(targetedSources.reduce((s, x) => s + x.available, 0));

  const toggleLine = (line) => {
    const next = { ...selected, [line.key]: !selected[line.key] };
    setSelected(next);
    const sum = round2(lines.filter((l) => next[l.key]).reduce((s, l) => s + (l.price || 0), 0));
    setAmountInput(Math.min(sum, maxRefundable).toFixed(2));
  };

  const switchMode = (m) => {
    setMode(m);
    setError('');
    if (m === 'total') {
      setSelected({});
      setAmountInput(maxRefundable.toFixed(2));
    } else {
      setSelected({});
      setAmountInput('0.00');
    }
  };

  const amount = round2(parseFloat(amountInput) || 0);

  const handleConfirm = async () => {
    if (amount <= 0) { setError('Montant invalide.'); return; }
    if (amount > maxRefundable + 0.001) { setError(`Maximum remboursable : ${maxRefundable.toFixed(2)} €.`); return; }
    if (isCard && sources.length > 0 && amount > cardAvailable + 0.001) {
      setError(`Remboursable sur carte${partIndex != null ? ` (part ${partIndex})` : ''} : ${cardAvailable.toFixed(2)} €.`);
      return;
    }
    setError('');
    await onConfirm({
      amount,
      items: mode === 'partial' ? selectedLines.map((l) => ({ label: l.label, price: l.price })) : null,
      reason: reason.trim() || null,
      method,
      splitPartIndex: isCard ? partIndex : null,
    });
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={submitting ? undefined : onClose} />

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-2xl text-brand-700"><Icon name="refund" /></span>
          <div>
            <h2 className="font-serif font-bold text-xl text-gray-900">Rembourser</h2>
            <p className="text-sm text-gray-500">
              {order.customerName} · {isCancelledRefund ? 'encaissé' : 'payé'} {paidAmount.toFixed(2)} €
              {alreadyRefunded > 0 && ` · déjà remboursé ${alreadyRefunded.toFixed(2)} €`}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Vente annulée : rappeler ce qui a été encaissé et par quel moyen — c'est ce qui
              indique s'il faut ouvrir le tiroir ou rendre sur la carte. */}
          {isCancelledRefund && (
            <div className="text-sm bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-1">
              <p className="font-semibold text-orange-900">Vente annulée après encaissement</p>
              {(order.cancelPayments || []).length > 0 ? (
                <ul className="text-orange-800 space-y-0.5">
                  {order.cancelPayments.map((p, i) => (
                    <li key={i}>
                      {p.partIndex != null ? `Part ${p.partIndex} — ` : ''}
                      {round2(p.amount).toFixed(2)} € en {methodLabelFr(p.method)}
                      {p.userName ? ` · ${p.userName}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-orange-800">
                  Moyen de paiement non tracé (annulation antérieure à cette fonction) :
                  un remboursement carte doit être fait depuis le Dashboard Stripe.
                </p>
              )}
              {cancelPayers.length > 0 && (
                <p className="text-orange-800">
                  À rendre à <strong>{cancelPayers.join(', ')}</strong>
                </p>
              )}
            </div>
          )}

          {/* Choix total / partiel */}
          {canPartial ? (
            <div className="flex gap-2">
              <button
                onClick={() => switchMode('total')}
                className={`flex-1 py-2 rounded-lg font-semibold border transition ${
                  mode === 'total' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                Total ({maxRefundable.toFixed(2)} €)
              </button>
              <button
                onClick={() => switchMode('partial')}
                className={`flex-1 py-2 rounded-lg font-semibold border transition ${
                  mode === 'partial' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                Par article
              </button>
            </div>
          ) : hasPointsRedeem ? (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
              Commande avec remise en points : seul le remboursement <strong>total</strong> est possible.
            </p>
          ) : null}

          {/* Sélection des articles (mode partiel) */}
          {mode === 'partial' && canPartial && (
            <div className="space-y-2 border border-gray-100 rounded-xl p-3">
              {lines.map((l) => (
                <label key={l.key} className="flex items-center justify-between gap-3 cursor-pointer py-1">
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={!!selected[l.key]} onChange={() => toggleLine(l)}
                      className="w-4 h-4 accent-brand-600" />
                    {l.label}
                  </span>
                  <span className="text-sm font-semibold text-gray-600">{(l.price || 0).toFixed(2)} €</span>
                </label>
              ))}
            </div>
          )}

          {/* Montant */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Montant à rembourser</label>
            <div className="relative">
              <input
                type="number" step="0.01" min="0" max={maxRefundable}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                disabled={mode === 'total'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-lg font-bold focus:ring-2 focus:ring-brand-500 outline-none disabled:bg-gray-50 disabled:text-gray-500" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">€</span>
            </div>
          </div>

          {/* Moyen de remboursement */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Moyen de remboursement</label>
            <div className="flex gap-2">
              {METHODS.map((m) => (
                <button key={m.key} onClick={() => setMethod(m.key)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition inline-flex items-center justify-center gap-1.5 ${
                    method === m.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>
                  <Icon name={m.icon} /> {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Carte : ce qui partira réellement chez Stripe */}
          {isCard && (
            sources.length === 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
                Aucun paiement carte tracé sur cette commande. Le remboursement sera <strong>enregistré</strong> ici,
                mais devra être effectué <strong>manuellement dans le Dashboard Stripe</strong>.
              </p>
            ) : (
              <div className="space-y-2">
                {canTargetPart && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Part à rembourser</label>
                    <select
                      value={partIndex ?? ''}
                      onChange={(e) => setPartIndex(e.target.value === '' ? null : Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none">
                      <option value="">Toutes les parts ({round2(sources.reduce((s, x) => s + x.available, 0)).toFixed(2)} €)</option>
                      {partOptions.map((s) => (
                        <option key={s.index} value={s.index}>{s.label} — {s.available.toFixed(2)} € disponibles</option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="text-sm text-brand-800 bg-brand-50 rounded-lg p-3">
                  Remboursement envoyé à <strong>Stripe</strong> sur la carte du client
                  {partIndex != null && <> — <strong>part {partIndex}</strong></>}.
                  Disponible : <strong>{cardAvailable.toFixed(2)} €</strong>.
                </p>
              </div>
            )
          )}

          {/* Motif (optionnel) */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Motif <span className="font-normal text-gray-400">(optionnel)</span></label>
            <input
              type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ex : article manquant, erreur de caisse…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>

          {error && <p className="text-sm text-cherry font-semibold">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={onClose} disabled={submitting}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-bold hover:bg-gray-200 transition disabled:opacity-50">
            Annuler
          </button>
          <button onClick={handleConfirm} disabled={submitting || amount <= 0}
            className="px-6 py-3 bg-brand-600 text-white rounded-full font-bold hover:bg-brand-700 transition disabled:opacity-50">
            {submitting ? 'Remboursement…' : `Rembourser ${amount.toFixed(2)} €`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RefundModal;
