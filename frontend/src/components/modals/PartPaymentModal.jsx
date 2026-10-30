import { useState, useMemo } from 'react';
import Icon from '../Icon';
import PartClientPicker from '../caisse/PartClientPicker';
import CardPassages from '../caisse/CardPassages';
import TerminalCancelButton from '../caisse/TerminalCancelButton';
import PaperTicketInput from '../caisse/PaperTicketInput';
import { paperTicketOk } from '../../utils/paperTicket';
import { newPassage, passageAmount, passagesStarted, terminalFields, mixedSummary } from '../../utils/cardPayments';
import { pointsToEuros, maxPointsForEuros } from '../../utils/loyalty';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Encaisse la part d'un convive qui quitte la table avant la fin du repas. Le ticket reste
 * ouvert pour le reste de la table : cette modale n'encaisse JAMAIS le ticket entier.
 *
 * Volontairement autonome, et NON branchée sur la machine à états du split (`parts[]`) : celle-ci
 * suppose que la somme des parts couvre le total et que tout se finalise d'un coup. Les mêler
 * fragiliserait un mécanisme qui fonctionne — ici on ajoute un chemin, on n'en modifie aucun.
 *
 * `onConfirm(payload)` reçoit le corps prêt pour POST /orders/:id/part-payment ; le paiement carte
 * est délégué à la caisse (`runTerminalPayment`), qui seule pilote le terminal.
 */
const PartPaymentModal = ({
  isOpen, onClose, onConfirm,
  items = [],           // articles encore attribuables (panier du ticket)
  remaining = 0,        // reste à payer sur le ticket
  alreadyPaid = 0,      // déjà encaissé sur ce ticket
  runTerminalPayment,   // (amount, context) => { paymentIntentId } | { error }
  onNewClient,          // ouvre QuickClientModal côté caisse
  newClient = null,     // client fraîchement créé, à rattacher
  terminalStatus = 'idle',
  terminalHint = '',
  onCancelTerminal,
  submitting = false,
}) => {
  const [mode, setMode] = useState('items');      // 'items' = ses articles · 'amount' = montant libre
  const [picked, setPicked] = useState([]);       // ids des articles cochés
  const [freeAmount, setFreeAmount] = useState('');
  const [client, setClient] = useState(null);
  const [points, setPoints] = useState(0);
  const [method, setMethod] = useState(null);     // cash | card | ticket | mixed
  const [cashGiven, setCashGiven] = useState('');
  const [passages, setPassages] = useState(() => [newPassage()]); // mixte : lignes réglées l'une après l'autre
  const [ticketKind, setTicketKind] = useState('paper');           // tickets seuls : papier ou carte
  const [ticketGiven, setTicketGiven] = useState('');              // tickets seuls papier : montant remis
  const [cardDone, setCardDone] = useState(false);                 // carte seule / titre-resto carte
  const [cardPI, setCardPI] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Client créé à la volée pendant que la modale est ouverte (QuickClientModal, côté caisse).
  // Ajustement d'état pendant le rendu plutôt que dans un effet : la valeur est dérivée d'une
  // prop, un effet provoquerait un rendu en cascade avec un affichage intermédiaire sans client.
  const [seenClient, setSeenClient] = useState(null);
  if (newClient !== seenClient) {
    setSeenClient(newClient);
    if (newClient?._id) { setClient(newClient); setPoints(0); }
  }

  const pickedItems = useMemo(
    () => items.filter(it => picked.includes(it.id)).map(it => ({ id: it.id, label: it.label, price: round2(it.price) })),
    [items, picked]
  );

  // Montant brut de la part, avant remise points.
  const gross = mode === 'items'
    ? round2(pickedItems.reduce((s, it) => s + it.price, 0))
    : round2(Math.min(parseFloat(freeAmount) || 0, remaining));

  const maxPoints = Math.min(client?.loyaltyPoints || 0, maxPointsForEuros(gross));
  const usedPoints = Math.max(0, Math.min(points, maxPoints));
  const net = round2(Math.max(0, gross - pointsToEuros(usedPoints)));

  const mixed = mixedSummary(passages, net);
  // Une ligne déjà réglée : changer le montant ou la méthode, ou fermer, effacerait un règlement réel.
  const cardTaken = cardDone || passagesStarted(passages);
  const givenNum = parseFloat(cashGiven) || 0;
  const change = round2(Math.max(0, givenNum - net));

  if (!isOpen) return null;

  const resetPayment = () => {
    setMethod(null); setCashGiven(''); setPassages([newPassage()]); setTicketKind('paper'); setTicketGiven('');
    setCardDone(false); setCardPI(null); setError('');
  };
  const reset = () => {
    setMode('items'); setPicked([]); setFreeAmount(''); setClient(null); setPoints(0);
    resetPayment(); setBusy(false);
  };
  const close = () => {
    if (cardTaken) { setError('Une carte a déjà été débitée : validez la part.'); return; }
    reset(); onClose();
  };

  // Toute modification du montant remet la saisie du paiement à zéro — refusée si une carte est passée.
  const guardCard = () => {
    if (cardTaken) { setError('Une carte a déjà été débitée : validez la part.'); return false; }
    return true;
  };

  const toggle = (id) => {
    if (!guardCard()) return;
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    resetPayment();
  };

  const changeMode = (m) => {
    if (!guardCard()) return;
    setMode(m); setPicked([]); setFreeAmount('');
    resetPayment();
  };

  // Paiement carte (carte seule ou titre-resto carte) : le terminal est piloté par la caisse.
  const payCard = async () => {
    if (!(net > 0)) return;
    setError(''); setBusy(true);
    const res = await runTerminalPayment(net, 'part réglée avant la fin du repas');
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setCardPI(res.paymentIntentId);
    setCardDone(true);
  };

  // Mixte : une des cartes, l'une après l'autre.
  const payPassage = async (id) => {
    const passage = passages.find(c => c.id === id);
    const amount = passageAmount(passage);
    if (!(amount > 0)) return;
    setError(''); setBusy(true);
    const res = await runTerminalPayment(amount, 'part réglée avant la fin du repas');
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setPassages(prev => prev.map(c => (c.id === id ? { ...c, paymentIntentId: res.paymentIntentId } : c)));
  };

  const canValidate = () => {
    if (!(gross > 0) || !method) return false;
    if (net === 0) return true;                         // intégralement absorbé par les points
    if (method === 'card') return cardDone;
    if (method === 'ticket') return ticketKind === 'card' ? cardDone : paperTicketOk(ticketGiven, net);
    if (method === 'cash') return givenNum >= net - 0.001;
    if (method === 'mixed') return !mixed.pending && mixed.rest <= 0.001;
    return false;
  };

  const submit = () => {
    if (!canValidate()) return;
    const effectiveMethod = net === 0 ? 'points' : method;
    onConfirm({
      amount: gross,
      method: effectiveMethod,
      ...(mode === 'items' && pickedItems.length ? { items: pickedItems.map(({ label, price }) => ({ label, price })) } : {}),
      ...(usedPoints > 0 ? { pointsRedeemed: usedPoints } : {}),
      ...(client ? { user: client._id, userName: client.name } : {}),
      ...(effectiveMethod === 'cash' ? { cashGiven: givenNum, change } : {}),
      ...(effectiveMethod === 'card' ? { paymentIntentId: cardPI } : {}),
      ...(effectiveMethod === 'ticket' && ticketKind === 'card'
        ? { cardPayments: [{ amount: net, kind: 'meal_card', paymentIntentId: cardPI }], paymentIntentId: cardPI }
        : effectiveMethod === 'ticket' ? { ticketGiven: round2(parseFloat(ticketGiven) || 0) } : {}),
      ...(effectiveMethod === 'mixed' ? {
        ...terminalFields(passages), ticketAmount: mixed.ticketAmount, cashAmount: mixed.cashAmount,
        cashGiven: mixed.cashGiven, change: mixed.change,
      } : {}),
      splitMode: mode === 'items' ? 'item' : 'free',
    });
    reset();
  };

  const terminalBusy = terminalStatus === 'collecting' || terminalStatus === 'processing';
  // Icônes alignées sur les boutons de paiement de la caisse : « Mixte » n'en porte pas, et les
  // tickets restaurant utilisent `restaurant`. Un nom absent du mapping retombe sur « ? » en silence.
  const methodBtn = (m, label, icon) => (
    <button key={m} onClick={() => { if (guardCard()) { resetPayment(); setMethod(m); } }}
      disabled={!(gross > 0)}
      className={`flex-1 py-2.5 border-2 rounded-lg text-sm font-bold transition disabled:opacity-40 ${
        method === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
      }`}>
      <span className="inline-flex items-center justify-center gap-1.5">{icon && <Icon name={icon} />} {label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="text-lg font-extrabold text-gray-800">Encaisser une part</h3>
            <p className="text-xs text-gray-500">Le ticket reste ouvert pour le reste de la table</p>
          </div>
          <button onClick={close} className="text-gray-400 hover:text-gray-600"><Icon name="close" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-gray-600">Reste à payer</span>
            <span className="font-extrabold text-gray-800">{remaining.toFixed(2)} €</span>
          </div>
          {alreadyPaid > 0 && (
            <p className="text-xs text-emerald-700 -mt-2 inline-flex items-center gap-1">
              <Icon name="check" /> Déjà réglé sur ce ticket : {alreadyPaid.toFixed(2)} €
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={() => changeMode('items')}
              className={`flex-1 py-3 border-2 rounded-lg text-sm font-bold transition ${
                mode === 'items' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'
              }`}>Ses articles</button>
            <button onClick={() => changeMode('amount')}
              className={`flex-1 py-3 border-2 rounded-lg text-sm font-bold transition ${
                mode === 'amount' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600'
              }`}>Montant libre</button>
          </div>

          {mode === 'items' ? (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {items.length === 0 && <p className="text-sm text-gray-400">Aucun article sur ce ticket.</p>}
              {items.map(it => {
                const on = picked.includes(it.id);
                return (
                  <button key={it.id} onClick={() => toggle(it.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 border-2 rounded-lg text-left transition ${
                      on ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <span className="text-sm text-gray-800 inline-flex items-center gap-2">
                      <Icon name={on ? 'check' : 'add'} /> {it.label}
                    </span>
                    <span className="text-sm font-bold text-gray-700">{round2(it.price).toFixed(2)} €</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Montant de la part (€)</label>
              <input type="number" step="0.01" min="0" max={remaining}
                value={freeAmount} disabled={cardTaken}
                onChange={e => { setFreeAmount(e.target.value); resetPayment(); }}
                placeholder="0.00"
                className="w-full border rounded-lg px-3 py-2 font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
              <p className="text-xs text-gray-400 mt-1">Plafonné au reste à payer.</p>
            </div>
          )}

          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-gray-700 mb-1">Client (fidélité)</p>
            <div className="-ml-10">
              <PartClientPicker
                client={client} globalClient={null}
                onSelect={(c) => { if (guardCard()) { setClient(c); setPoints(0); resetPayment(); } }}
                onClear={() => { if (guardCard()) { setClient(null); setPoints(0); resetPayment(); } }}
                onNewClient={onNewClient}
                disabled={busy || submitting || cardTaken}
              />
            </div>
            {client && maxPoints > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <input type="number" min="0" max={maxPoints} value={points || ''}
                  disabled={cardTaken}
                  onChange={e => { setPoints(Math.max(0, Math.min(Math.floor(parseFloat(e.target.value) || 0), maxPoints))); resetPayment(); }}
                  placeholder="0"
                  className="w-28 border rounded-lg px-2 py-1.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                <button onClick={() => { if (guardCard()) { setPoints(maxPoints); resetPayment(); } }}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800">
                  Utiliser {maxPoints} pts ({pointsToEuros(maxPoints).toFixed(2)} €)
                </button>
              </div>
            )}
          </div>

          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg px-3 py-2 text-center">
            <p className="text-xs text-gray-600">À encaisser</p>
            <p className="text-3xl font-extrabold text-emerald-700">{net.toFixed(2)} €</p>
            {usedPoints > 0 && (
              <p className="text-xs text-emerald-600">
                {gross.toFixed(2)} € − {usedPoints} pts ({pointsToEuros(usedPoints).toFixed(2)} €)
              </p>
            )}
          </div>

          {net > 0 && (
            <div className="flex gap-2">
              {methodBtn('cash', 'Espèces', 'cash')}
              {methodBtn('card', 'Carte', 'card')}
              {methodBtn('ticket', 'Tickets resto', 'restaurant')}
              {methodBtn('mixed', 'Mixte', null)}
            </div>
          )}

          {method === 'mixed' && net > 0 && (
            <CardPassages
              passages={passages}
              onChange={setPassages}
              limit={net}
              onCollect={payPassage}
              busy={busy || submitting}
              terminalStatus={terminalStatus}
              terminalHint={terminalHint}
              onCancelTerminal={onCancelTerminal}
            />
          )}

          {/* Tickets resto : papier (rien au terminal) ou carte titre-restaurant (terminal) */}
          {method === 'ticket' && net > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {[['paper', 'Tickets papier'], ['card', 'Carte titre-resto']].map(([k, label]) => (
                <button key={k} onClick={() => setTicketKind(k)} disabled={cardDone || terminalBusy}
                  className={`py-2 border-2 rounded-lg text-sm font-bold transition disabled:opacity-40 ${
                    ticketKind === k ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>{label}</button>
              ))}
            </div>
          )}
          {method === 'ticket' && ticketKind === 'paper' && net > 0 && (
            <PaperTicketInput value={ticketGiven} onChange={setTicketGiven} due={net} />
          )}

          {(method === 'card' || (method === 'ticket' && ticketKind === 'card')) && net > 0 && (
            cardDone ? (
              <p className="text-sm text-emerald-700 font-semibold inline-flex items-center gap-1">
                <Icon name="check" /> {method === 'ticket' ? 'Titre-resto encaissé' : 'Carte encaissée'} ({net.toFixed(2)} €)
              </p>
            ) : (
              <div className="space-y-2">
                <button onClick={payCard} disabled={busy || terminalBusy}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition disabled:opacity-40">
                  {terminalBusy ? 'Terminal en cours…' : `Encaisser ${net.toFixed(2)} € ${method === 'ticket' ? 'par carte titre-resto' : 'par carte'}`}
                </button>
                <TerminalCancelButton terminalStatus={terminalStatus} onCancel={onCancelTerminal} />
              </div>
            )
          )}

          {method === 'cash' && net > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Espèces reçues (€)</label>
              <input type="number" step="0.01" min="0" value={cashGiven}
                onChange={e => setCashGiven(e.target.value)} placeholder="0.00"
                className="w-full border rounded-lg px-3 py-2 font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
              {givenNum > 0 && (
                <p className="text-sm mt-1 font-semibold text-gray-700">À rendre : {change.toFixed(2)} €</p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t flex gap-2">
          <button onClick={close} className="flex-1 py-3 border-2 border-gray-200 rounded-lg font-bold text-gray-600 hover:bg-gray-50">
            Annuler
          </button>
          <button onClick={submit} disabled={!canValidate() || busy || submitting}
            className="flex-1 py-3 bg-brand-600 text-white rounded-lg font-bold hover:bg-brand-700 transition disabled:opacity-40">
            Valider la part
          </button>
        </div>
      </div>
    </div>
  );
};

export default PartPaymentModal;
