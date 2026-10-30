import { useEffect } from 'react';
import Icon from '../Icon';
import TerminalCancelButton from './TerminalCancelButton';
import {
  newPassage, passageAmount, passageDone, isTerminalKind, recordPassage, mixedSummary, PASSAGE_LABELS,
} from '../../utils/cardPayments';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Une couleur par moyen : sélecteur et bouton « Encaisser » de la ligne.
const KINDS = [
  { kind: 'card', label: 'Carte bancaire', icon: 'card', active: 'bg-blue-600 text-white', button: 'bg-blue-600 hover:bg-blue-700 text-white' },
  { kind: 'meal_card', label: 'Titre-resto', icon: 'restaurant', active: 'bg-orange-500 text-white', button: 'bg-orange-500 hover:bg-orange-600 text-white' },
  { kind: 'paper', label: 'Ticket papier', icon: 'ticket', active: 'bg-yellow-400 text-gray-900', button: 'bg-yellow-400 hover:bg-yellow-500 text-gray-900' },
  { kind: 'cash', label: 'Espèces', icon: 'cash', active: 'bg-emerald-600 text-white', button: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
];
const kindStyle = (kind) => KINDS.find(k => k.kind === kind) || KINDS[0];

/**
 * Lignes d'un paiement mixte, réglées l'une après l'autre : carte bancaire et carte
 * titre-restaurant passent au terminal (une transaction à la fois), tickets papier et espèces
 * sont enregistrés par la caisse. Une ligne réglée est figée ; tant qu'il reste à payer, la
 * ligne suivante s'ouvre d'elle-même.
 *
 * `onCollect(id)` lance la transaction d'une carte : c'est la caisse qui pilote le terminal.
 * `limit` = montant à régler par l'ensemble des lignes.
 */
const CardPassages = ({
  passages, onChange, limit, onCollect,
  busy = false, terminalStatus = 'idle', terminalHint = '', onCancelTerminal,
}) => {
  const terminalBusy = terminalStatus === 'collecting' || terminalStatus === 'processing';
  const { rest, paid } = mixedSummary(passages, limit);
  const started = paid > 0;
  const allDone = passages.length > 0 && passages.every(passageDone);
  const update = (id, patch) => onChange(passages.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const record = (p) => onChange(passages.map(x => (x.id === p.id ? recordPassage(x, rest) : x)));

  useEffect(() => {
    if (allDone && rest > 0) onChange([...passages, newPassage()]);
  }, [allDone, rest, passages, onChange]);

  return (
    <div className="space-y-2">
      {passages.map((p, k) => {
        const done = passageDone(p);
        const amount = passageAmount(p);
        const terminal = isTerminalKind(p.kind);
        // Une carte ne peut pas dépasser le reste ; espèces et tickets oui (rendu / excédent).
        const over = terminal && amount > rest + 0.001;
        const surplus = !terminal && !done ? round2(amount - rest) : 0;
        return (
          <div key={p.id}
            className={`rounded-lg border-2 p-2 space-y-2 ${done ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'}`}>
            {done ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-gray-400 w-4">{k + 1}</span>
                <span className="text-sm font-semibold text-gray-700">{PASSAGE_LABELS[p.kind]}</span>
                <span className="text-sm font-bold text-gray-800">{amount.toFixed(2)} €</span>
                {p.kind === 'cash' && p.extra > 0 && <span className="text-xs text-gray-600">rendu {p.extra.toFixed(2)} €</span>}
                {p.kind === 'paper' && p.extra > 0 && <span className="text-xs text-gray-600">dont {p.extra.toFixed(2)} € non rendus</span>}
                <span className="ml-auto text-xs font-semibold text-emerald-700 inline-flex items-center gap-1"><Icon name="check" /> Encaissé</span>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-gray-400 w-4">{k + 1}</span>
                  <div className="flex flex-wrap rounded-lg border overflow-hidden text-xs font-bold">
                    {KINDS.map(k2 => (
                      <button key={k2.kind} type="button" onClick={() => update(p.id, { kind: k2.kind })}
                        disabled={terminalBusy}
                        className={`px-2 py-1.5 inline-flex items-center gap-1 transition disabled:opacity-40 ${p.kind === k2.kind ? k2.active : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                        <Icon name={k2.icon} /> {k2.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <input type="number" step="0.01" min="0" value={p.amount}
                      onChange={e => update(p.id, { amount: e.target.value })}
                      disabled={terminalBusy}
                      placeholder={rest.toFixed(2)}
                      className="w-28 border rounded-lg px-2 py-1.5 font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                    <span className="text-sm font-bold text-gray-500">€</span>
                  </span>
                  <button type="button"
                    onClick={() => (terminal ? onCollect(p.id) : record(p))}
                    disabled={busy || terminalBusy || amount <= 0 || over}
                    className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-40 ${kindStyle(p.kind).button}`}>
                    Encaisser{amount > 0 ? ` ${amount.toFixed(2)} €` : ''}
                  </button>
                </div>
                {over && <p className="text-xs font-semibold text-red-600">La carte dépasse le reste à payer ({rest.toFixed(2)} €)</p>}
                {surplus > 0.001 && (
                  <p className="text-xs font-semibold text-gray-700">
                    {p.kind === 'cash' ? `Rendu ${surplus.toFixed(2)} €` : `${surplus.toFixed(2)} € non rendus sur les tickets`}
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}

      {started && (
        <p className={`text-sm font-semibold ${rest > 0 ? 'text-gray-700' : 'text-emerald-700'}`}>
          {rest > 0 ? `Reste ${rest.toFixed(2)} €` : 'Addition réglée'}
        </p>
      )}

      {(terminalBusy || terminalStatus === 'error' || terminalHint) && (
        <div className="text-xs text-center">
          {terminalStatus === 'collecting' && <span className="text-blue-600 font-bold animate-pulse">Montant sur le terminal — en attente de la carte…</span>}
          {terminalStatus === 'processing' && <span className="text-blue-600 font-bold animate-pulse">Traitement…</span>}
          {terminalStatus === 'error' && <span className="text-red-600">Échec — réessayez</span>}
          {terminalHint && <p className="text-amber-600 font-semibold">{terminalHint}</p>}
        </div>
      )}
      <TerminalCancelButton terminalStatus={terminalStatus} onCancel={onCancelTerminal} />
    </div>
  );
};

export default CardPassages;
