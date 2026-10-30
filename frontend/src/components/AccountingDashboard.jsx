// frontend/src/components/AccountingDashboard.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchAccountingData, fetchOrderById, fetchTips } from '../services/api';
import { socket } from '../socket';
import { Pagination } from './admin/ListControls';
import Icon from './Icon';
import OrderTicketModal from './modals/OrderTicketModal';
import { orderLabel } from '../utils/orderTicket';

const DETAIL_PAGE_SIZE = 25;

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n) => Number(n ?? 0).toFixed(2);

// Libellés français affichés dans le tableau (réutilisés pour le tri).
const TYPE_LABELS    = { salade: 'Salade', dish: 'Plat chaud', menu: 'Menu', product: 'Produits', mixed: 'Mixte' };
const PAYMENT_LABELS = {
  cash: 'Espèces', card: 'Carte (terminal)', ticket: 'Tickets resto', mixed: 'Mixte',
  split: 'Addition séparée', points: 'Points fidélité', online: 'En ligne',
};

const typeLabel = (o) => TYPE_LABELS[o.type] || o.type || '';

// Mode d'une commande dans le tableau : 1 commande = 1 mode (« Addition séparée », « Mixte »),
// la ventilation en montants se fait dans la répartition du haut. Seule une commande réglée
// par carte sur le site n'a pas de paymentMethod → c'est le seul cas qui retombe sur « En ligne ».
const paymentKey   = (o) => (PAYMENT_LABELS[o.paymentMethod] ? o.paymentMethod : 'online');
const paymentLabel = (o) => PAYMENT_LABELS[paymentKey(o)];

// Jour d'une commande au format YYYY-MM-DD, fuseau Guadeloupe (= valeur d'un <input type="date">).
const gpDay = (dateLike) => new Date(dateLike).toLocaleDateString('en-CA', { timeZone: 'America/Guadeloupe' });

// Valeur spéciale du filtre statut : toute commande remboursée (totale ou partielle).
const REFUNDED_FILTER = '__refunded__';

// Lien direct vers la transaction dans le dashboard Stripe (pointage compta).
const STRIPE_PAYMENT_URL = 'https://dashboard.stripe.com/payments/';

const PERIODS = [
  { key: 'day',   label: "Aujourd'hui" },
  { key: 'week',  label: 'Cette semaine' },
  { key: 'month', label: 'Ce mois' },
  { key: 'year',  label: 'Cette année' },
  { key: 'custom', label: 'Personnalisé' },
];

function getPeriodDates(key) {
  const now   = new Date();
  const pad   = (n) => String(n).padStart(2, '0');
  const ymd   = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = ymd(now);

  if (key === 'day') return { from: today, to: today };

  if (key === 'week') {
    const day  = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const mon  = new Date(now); mon.setDate(now.getDate() - day);
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: ymd(mon), to: ymd(sun) };
  }

  if (key === 'month') {
    const from = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
    const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
    return { from, to: ymd(last) };
  }

  if (key === 'year') {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  }

  return { from: today, to: today };
}

// ─── Export CSV ──────────────────────────────────────────────────────────────

function exportCSV(orders, period, tipOf) {
  const header = ['ID', 'Client', 'Date', 'Type', 'Mode paiement', 'ID paiement Stripe', 'Total brut (€)', 'Remise comm. (€)', 'Points (€)', 'Total net (€)', 'Pourboire (€)', 'Remboursé (€)', 'Statut'];
  const rows   = orders.map(o => [
    orderLabel(o),
    o.customerName,
    new Date(o.createdAt).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone: 'America/Guadeloupe' }),
    typeLabel(o),
    paymentLabel(o),
    (o.paymentIntentIds || []).join(' '), // ID complet : c'est la clé de pointage avec Stripe
    fmt(o.totalPrice),
    fmt(o.manualDiscount),
    fmt(o.discountAmount),
    fmt(o.finalPrice),
    fmt(tipOf(o)),
    fmt(o.refundedAmount),
    o.status,
  ]);

  const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const bom  = '﻿'; // UTF-8 BOM pour Excel
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cafe-verde-CA_${period.from}_au_${period.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Composant principal ─────────────────────────────────────────────────────

const AccountingDashboard = () => {
  const [activePeriod, setActivePeriod] = useState('month');
  const [customFrom,   setCustomFrom]   = useState('');
  const [customTo,     setCustomTo]     = useState('');
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [detailPage,   setDetailPage]   = useState(1);
  const [fName,        setFName]        = useState('');
  const [fDate,        setFDate]        = useState('');
  const [fType,        setFType]        = useState('');
  const [fPayment,     setFPayment]     = useState('');
  const [fStatus,      setFStatus]      = useState('');
  const [ticketTarget,   setTicketTarget]   = useState(null); // commande complète pour la modale ticket
  const [ticketLoadingId, setTicketLoadingId] = useState(null); // id en cours de chargement
  const [tips,         setTips]         = useState(null);  // pourboires Stripe de la période
  const [tipsError,    setTipsError]    = useState(false);

  // Le tableau ne connaît qu'une projection allégée : on recharge la commande complète à la demande.
  const openTicket = async (id) => {
    setTicketLoadingId(id);
    try {
      const res = await fetchOrderById(id);
      setTicketTarget(res.data.data);
    } catch {
      setError('Impossible de charger le détail de la commande.');
    } finally {
      setTicketLoadingId(null);
    }
  };

  // Le pourboire n'existe que chez Stripe : on le rattache à la commande via son
  // (ou ses, si addition séparée) PaymentIntent. 0 si paiement non-carte ou clé de test.
  const tipOf = useCallback((o) => (
    (o.paymentIntentIds || []).reduce((sum, id) => sum + (tips?.byIntent?.[id] || 0), 0)
  ), [tips]);

  const resetFilters = () => {
    setFName(''); setFDate(''); setFType(''); setFPayment(''); setFStatus('');
  };
  const hasFilters = !!(fName || fDate || fType || fPayment || fStatus);

  // Les pourboires viennent de Stripe (le terminal les collecte lui-même, ils
  // n'existent nulle part en base). Chargés à part : une panne Stripe ne doit
  // jamais empêcher l'affichage du CA.
  const loadTips = useCallback(async (from, to) => {
    setTips(null);
    setTipsError(false);
    try {
      const res = await fetchTips(from, to);
      setTips(res.data);
    } catch {
      setTipsError(true);
    }
  }, []);

  const load = useCallback(async (period, cFrom, cTo) => {
    const { from, to } = period === 'custom'
      ? { from: cFrom, to: cTo }
      : getPeriodDates(period);
    setLoading(true);
    setError('');
    loadTips(from, to);
    try {
      const res = await fetchAccountingData(from, to);
      setData({ ...res.data, _period: { from, to } });
    } catch {
      setError('Impossible de charger les données comptables.');
    } finally {
      setLoading(false);
    }
  }, [loadTips]);

  useEffect(() => {
    load('month', '', '');
  }, [load]);

  // Rafraîchissement temps réel : toute création/modif/suppression de commande
  // (dont la suppression depuis l'espace Dev → 'order_deleted') recharge la période affichée.
  useEffect(() => {
    const reload = () => load(activePeriod, customFrom, customTo);
    const events = ['order_deleted', 'new_order', 'order_updated', 'order:cancelled'];
    events.forEach(e => socket.on(e, reload));
    return () => events.forEach(e => socket.off(e, reload));
  }, [load, activePeriod, customFrom, customTo]);

  const handlePeriod = (key) => {
    setActivePeriod(key);
    if (key !== 'custom') load(key, '', '');
  };

  const handleCustomApply = () => {
    if (!customFrom || !customTo) return;
    load('custom', customFrom, customTo);
  };

  // Réinitialise la page du détail quand le jeu de données change (période, refresh).
  useEffect(() => { setDetailPage(1); }, [data]);

  const d = data;

  // Statuts présents sur la période (pour peupler le menu déroulant de filtre).
  const statusOptions = useMemo(
    () => [...new Set((d?.orders ?? []).map(o => o.status).filter(s => s && s !== 'refunded'))].sort(),
    [d]
  );

  const detailOrders = useMemo(() => {
    let list = d?.orders ?? [];
    if (fName.trim()) {
      const q = fName.trim().toLowerCase();
      list = list.filter(o => (o.customerName || '').toLowerCase().includes(q));
    }
    if (fDate)    list = list.filter(o => gpDay(o.createdAt) === fDate);
    if (fType)    list = list.filter(o => o.type === fType);
    if (fPayment) list = list.filter(o => paymentKey(o) === fPayment);
    if (fStatus) {
      list = fStatus === REFUNDED_FILTER
        ? list.filter(o => (o.refundedAmount ?? 0) > 0 || o.status === 'refunded')
        : list.filter(o => o.status === fStatus);
    }
    return list;
  }, [d, fName, fDate, fType, fPayment, fStatus]);

  // Retour page 1 dès qu'un filtre change.
  useEffect(() => { setDetailPage(1); }, [fName, fDate, fType, fPayment, fStatus]);

  // Décomposition de l'écart CA brut → CA net, sur TOUTE la période (pas les filtres).
  const recon = useMemo(() => {
    const list = d?.orders ?? [];
    return list.reduce((acc, o) => {
      acc.commercial += o.manualDiscount ?? 0;  // remise commerciale (€)
      acc.points     += o.discountAmount ?? 0;  // valeur des points utilisés (€)
      acc.refunded   += o.refundedAmount ?? 0;  // remboursements (€)
      return acc;
    }, { commercial: 0, points: 0, refunded: 0 });
  }, [d]);
  // Contrôle de cohérence de la répartition : doit égaler le CA net.
  const paymentTotal = useMemo(
    () => Object.values(d?.byPayment ?? {}).reduce((s, b) => s + (b?.revenue ?? 0), 0),
    [d]
  );

  const detailTotalPages = Math.max(1, Math.ceil(detailOrders.length / DETAIL_PAGE_SIZE));
  const detailSafePage   = Math.min(detailPage, detailTotalPages);
  const detailPageItems  = detailOrders.slice((detailSafePage - 1) * DETAIL_PAGE_SIZE, detailSafePage * DETAIL_PAGE_SIZE);

  return (
    <div className="space-y-6 accounting-print-area">

      {/* Styles d'impression : n'imprimer que ce dashboard, sans les boutons.
          Désactivés quand la modale ticket est ouverte, sinon leur `visibility:hidden`
          masquerait le PrintArea du ticket (hors .accounting-print-area) → page blanche. */}
      {!ticketTarget && (
        <style>{`
          @media print {
            body * { visibility: hidden !important; }
            .accounting-print-area, .accounting-print-area * { visibility: visible !important; }
            .accounting-print-area {
              position: absolute; left: 0; top: 0; width: 100%;
              padding: 0; margin: 0;
            }
            .no-print { display: none !important; }
            .accounting-print-area .shadow-sm,
            .accounting-print-area .shadow { box-shadow: none !important; }
          }
        `}</style>
      )}

      {/* ── Filtres période ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Comptabilité & Export CA</h2>

        <div className="flex flex-wrap gap-2 mb-4 no-print">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => handlePeriod(p.key)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                activePeriod === p.key
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        {activePeriod === 'custom' && (
          <div className="flex flex-wrap items-end gap-3 mt-2 no-print">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Du</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Au</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <button onClick={handleCustomApply} disabled={!customFrom || !customTo}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold text-sm hover:bg-emerald-700 disabled:opacity-40">
              Appliquer
            </button>
          </div>
        )}

        {d && (
          <p className="text-xs text-gray-400 mt-3">
            Période : {new Date(d._period.from).toLocaleDateString('fr-FR', { timeZone: 'America/Guadeloupe' })} →{' '}
            {new Date(d._period.to).toLocaleDateString('fr-FR', { timeZone: 'America/Guadeloupe' })}
          </p>
        )}
      </div>

      {loading && (
        <div className="text-center py-12 text-gray-500">Chargement...</div>
      )}
      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-bold">{error}</div>
      )}

      {!loading && d && (
        <>
          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'CA brut',       value: `${fmt(d.grossRevenue)} €`,  color: 'bg-blue-50 text-blue-700',    border: 'border-blue-200' },
              { label: 'CA net',        value: `${fmt(d.netRevenue)} €`,    color: 'bg-emerald-50 text-emerald-700', border: 'border-emerald-200' },
              { label: 'Remises',       value: `−${fmt(d.totalDiscounts)} €`, color: 'bg-amber-50 text-amber-700', border: 'border-amber-200' },
              { label: 'Ticket moyen', value: `${fmt(d.avgTicket)} €`,     color: 'bg-purple-50 text-purple-700', border: 'border-purple-200' },
              { label: 'Nb commandes', value: d.totalOrders,               color: 'bg-gray-50 text-gray-700',     border: 'border-gray-200' },
              {
                label: 'Pourboires',
                value: tipsError ? '—' : tips ? `${fmt(tips.total)} €` : '…',
                hint:  tipsError ? 'Stripe indisponible'
                     : tips     ? `${tips.tipCount} paiement${tips.tipCount > 1 ? 's' : ''} · carte · hors CA`
                     : 'Chargement…',
                color: 'bg-indigo-50 text-indigo-700', border: 'border-indigo-200',
              },
            ].map(k => (
              <div key={k.label} className={`rounded-xl border p-4 ${k.color} ${k.border}`}>
                <p className="text-xs font-semibold uppercase tracking-wider opacity-70 mb-1">{k.label}</p>
                <p className="text-2xl font-extrabold">{k.value}</p>
                {k.hint && <p className="text-[11px] font-medium opacity-70 mt-1">{k.hint}</p>}
              </div>
            ))}
          </div>

          {/* ── À rembourser : encaissé sur des ventes annulées, pas encore rendu ──
              Hors CA (les commandes sont annulées) mais physiquement en caisse : sans ce bloc,
              l'écart entre le tiroir et la comptabilité resterait invisible. */}
          {(d.pendingRefunds?.length ?? 0) > 0 && (
            <div className="bg-white rounded-2xl border-2 border-orange-300 shadow-sm p-5">
              <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <h3 className="font-bold text-orange-900 inline-flex items-center gap-1.5">
                  <Icon name="refund" /> À rembourser
                </h3>
                <span className="font-extrabold text-orange-700">{fmt(d.pendingRefundsTotal)} €</span>
              </div>
              <p className="text-xs text-orange-800 mb-3">
                Ventes annulées après encaissement dont l'argent n'a pas encore été rendu.
                Hors chiffre d'affaires — mais toujours en caisse.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-500 border-b">
                      <th className="py-1.5 pr-3">Date</th>
                      <th className="py-1.5 pr-3">Client</th>
                      <th className="py-1.5 pr-3">Encaissé</th>
                      <th className="py-1.5 pr-3">Rendu</th>
                      <th className="py-1.5">Reste dû</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pendingRefunds.map(o => (
                      <tr key={o._id} className="border-b last:border-0">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500">{gpDay(o.createdAt)}</td>
                        <td className="py-1.5 pr-3">
                          {o.customerName}
                          {o.payers?.length > 0 && (
                            <span className="text-xs text-gray-500"> · à {o.payers.join(', ')}</span>
                          )}
                          {o.methods?.length > 0 && (
                            <span className="text-xs text-gray-400"> ({o.methods.join(' + ')})</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(o.cancelledAmount)} €</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap text-purple-700">{fmt(o.refundedAmount)} €</td>
                        <td className="py-1.5 whitespace-nowrap font-bold text-orange-700">{fmt(o.due)} €</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Le remboursement se fait depuis l'Espace Gérant, sur la commande annulée.
              </p>
            </div>
          )}

          {/* ── Réconciliation CA brut → CA net ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-gray-800 mb-4">Du CA brut au CA net</h3>
            <div className="space-y-1.5 text-sm font-mono max-w-md">
              <div className="flex justify-between">
                <span className="text-gray-600">CA brut</span>
                <span className="font-semibold text-gray-900">{fmt(d.grossRevenue)} €</span>
              </div>
              <div className="flex justify-between text-amber-600">
                <span>− Remises commerciales</span>
                <span>{fmt(recon.commercial)} €</span>
              </div>
              <div className="flex justify-between text-amber-600">
                <span>− Points utilisés</span>
                <span>{fmt(recon.points)} €</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>− Remboursements</span>
                <span>{fmt(recon.refunded)} €</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-1.5">
                <span className="font-bold text-gray-800">= CA net (TTC)</span>
                <span className="font-extrabold text-emerald-700">
                  {fmt(d.grossRevenue - recon.commercial - recon.points - recon.refunded)} €
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span className="pl-3">dont HT</span>
                <span>{fmt(d.tax?.totalHT)} €</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span className="pl-3">dont TVA</span>
                <span>{fmt(d.tax?.totalTVA)} €</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Calculé sur toute la période (les filtres du tableau n'affectent pas ce bloc).
              Le « = CA net » doit égaler le KPI « CA net » ({fmt(d.netRevenue)} €), à 1–2 centimes d'arrondi près.
            </p>
          </div>

          {/* ── Répartitions ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Mode de paiement — montants réellement encaissés (un split est ventilé
                entre ses parts, donc une commande peut apparaître dans plusieurs lignes). */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-800 mb-4">Mode de paiement</h3>
              {[
                { key: 'cash',   label: 'Espèces',           icon: 'cash',   color: 'bg-emerald-100 text-emerald-800' },
                { key: 'card',   label: 'Carte bancaire (terminal)', icon: 'card', color: 'bg-blue-100 text-blue-800' },
                // Titre-restaurant passé au terminal : versé par Stripe, à rapprocher avec les cartes.
                { key: 'mealCard', label: 'Titre-resto carte (terminal)', icon: 'restaurant', color: 'bg-orange-100 text-orange-800' },
                { key: 'ticket', label: 'Tickets resto papier', icon: 'ticket', color: 'bg-amber-100 text-amber-800' },
                { key: 'online', label: 'En ligne (Stripe)', icon: 'globe',  color: 'bg-purple-100 text-purple-800' },
              ].map(({ key, label, icon, color }) => (
                <div key={key} className={`flex justify-between items-center px-3 py-2 rounded-lg mb-2 ${color}`}>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-sm"><Icon name={icon} /> {label}</span>
                  <span className="font-mono font-bold text-sm">
                    {d.byPayment[key]?.count ?? 0} cmd — {fmt(d.byPayment[key]?.revenue)} €
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center px-3 pt-2 mt-3 border-t border-gray-200">
                <span className="font-bold text-sm text-gray-700">Total encaissé</span>
                <span className="font-mono font-extrabold text-sm text-gray-900">{fmt(paymentTotal)} €</span>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Les additions séparées et les paiements mixtes sont ventilés par part : le total
                doit égaler le CA net ({fmt(d.netRevenue)} €).
              </p>
            </div>

            {/* Type de commande */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-800 mb-4">Type de commande</h3>
              {[
                { key: 'salade',  label: 'Salade',     icon: 'salad',      color: 'bg-green-100 text-green-800' },
                { key: 'dish',    label: 'Plat chaud', icon: 'dish',       color: 'bg-orange-100 text-orange-800' },
                { key: 'mixed',   label: 'Mixte',      icon: 'restaurant', color: 'bg-gray-100 text-gray-800' },
                { key: 'menu',    label: 'Menu',       icon: 'restaurant', color: 'bg-purple-100 text-purple-800' },
                { key: 'product', label: 'Produits',   icon: 'products',   color: 'bg-blue-100 text-blue-800' },
              ].map(({ key, label, icon, color }) => (
                <div key={key} className={`flex justify-between items-center px-3 py-2 rounded-lg mb-2 ${color}`}>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-sm"><Icon name={icon} /> {label}</span>
                  <span className="font-mono font-bold text-sm">
                    {d.byType[key]?.count ?? 0} cmd — {fmt(d.byType[key]?.revenue)} €
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── TVA collectée ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-gray-800 mb-4">TVA collectée</h3>
            {(d.tax?.byRate?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-400">
                Aucune TVA sur cette période (commandes antérieures à la mise en place de la TVA, ou taux à 0 %).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Taux</th>
                      <th className="px-3 py-2 text-right font-semibold">Base HT</th>
                      <th className="px-3 py-2 text-right font-semibold">TVA</th>
                      <th className="px-3 py-2 text-right font-semibold">TTC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 font-mono">
                    {d.tax.byRate.map(t => (
                      <tr key={t.rate}>
                        <td className="px-3 py-2 font-semibold text-gray-700">{t.rate} %</td>
                        <td className="px-3 py-2 text-right text-gray-700">{fmt(t.baseHT)} €</td>
                        <td className="px-3 py-2 text-right text-emerald-700 font-semibold">{fmt(t.tva)} €</td>
                        <td className="px-3 py-2 text-right text-gray-900">{fmt(t.ttc)} €</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-mono font-bold">
                      <td className="px-3 py-2 text-gray-800">Total</td>
                      <td className="px-3 py-2 text-right text-gray-800">{fmt(d.tax.totalHT)} €</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{fmt(d.tax.totalTVA)} €</td>
                      <td className="px-3 py-2 text-right text-gray-900">{fmt(d.tax.totalHT + d.tax.totalTVA)} €</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-3">
              TVA incluse dans les prix (TTC), calculée sur le montant net encaissé et ajustée des remboursements.
              Le « Total TTC » couvre uniquement les commandes créées depuis la mise en place de la TVA ;
              il converge vers le CA net ({fmt(d.netRevenue)} €) à mesure que ces anciennes commandes sortent de la période.
            </p>
          </div>

          {/* ── Boutons export ── */}
          <div className="flex gap-3 flex-wrap no-print">
            <button
              onClick={() => exportCSV(d.orders, d._period, tipOf)}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow">
              <Icon name="RiDownloadLine" /> Exporter CSV
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-900 transition-colors shadow">
              <Icon name="print" /> Imprimer / PDF
            </button>
          </div>

          {/* ── Tableau détaillé ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-gray-800">
                  Détail des commandes ({hasFilters ? `${detailOrders.length} / ${d.totalOrders}` : d.totalOrders})
                </h3>
                {hasFilters && (
                  <button
                    onClick={resetFilters}
                    className="no-print inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors">
                    <Icon name="close" /> Réinitialiser
                  </button>
                )}
              </div>

              {/* Barre de filtres (combinables) */}
              <div className="no-print mt-4 flex flex-wrap gap-3">
                <input
                  type="text"
                  value={fName}
                  onChange={e => setFName(e.target.value)}
                  placeholder="Client…"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                <input
                  type="date"
                  value={fDate}
                  onChange={e => setFDate(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                <select
                  value={fType}
                  onChange={e => setFType(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">Tous les types</option>
                  {Object.entries(TYPE_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
                <select
                  value={fPayment}
                  onChange={e => setFPayment(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">Tous les paiements</option>
                  {Object.entries(PAYMENT_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
                <select
                  value={fStatus}
                  onChange={e => setFStatus(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">Tous les statuts</option>
                  <option value={REFUNDED_FILTER}>refunded</option>
                  {statusOptions.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="overflow-auto max-h-[60vh]">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider sticky top-0 z-10">
                  <tr>
                    {['#', 'Client', 'Date', 'Type', 'Paiement', 'Stripe', 'Brut', 'Remise comm.', 'Points', 'Net', 'Pourboire', 'Remboursé', 'Statut'].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
                    ))}
                    <th className="px-4 py-3 text-center font-semibold no-print">Ticket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {detailPageItems.map(o => (
                    <tr key={o._id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-400 text-xs">{orderLabel(o)}</td>
                      <td className="px-4 py-2 font-medium text-gray-800">{o.customerName}</td>
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit', timeZone: 'America/Guadeloupe' })}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          o.type === 'salade'  ? 'bg-green-100 text-green-700' :
                          o.type === 'dish'    ? 'bg-orange-100 text-orange-700' :
                          o.type === 'menu'    ? 'bg-purple-100 text-purple-700' :
                          o.type === 'product' ? 'bg-blue-100 text-blue-700' :
                                                 'bg-gray-100 text-gray-600'
                        }`}>
                          {typeLabel(o)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          o.paymentMethod === 'cash'   ? 'bg-emerald-100 text-emerald-700' :
                          o.paymentMethod === 'card'   ? 'bg-blue-100 text-blue-700' :
                                                         'bg-purple-100 text-purple-700'
                        }`}>
                          {paymentLabel(o)}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                        {(o.paymentIntentIds || []).length === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <>
                            <a
                              href={STRIPE_PAYMENT_URL + o.paymentIntentIds[0]}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={o.paymentIntentIds.join('\n')}
                              className="text-blue-600 hover:underline">
                              {o.paymentIntentIds[0].slice(0, 12)}…
                            </a>
                            {o.paymentIntentIds.length > 1 && (
                              <span className="text-gray-400 ml-1">+{o.paymentIntentIds.length - 1}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-700 whitespace-nowrap">{fmt(o.totalPrice)} €</td>
                      <td className="px-4 py-2 font-mono text-amber-600 whitespace-nowrap">
                        {(o.manualDiscount ?? 0) > 0 ? `−${fmt(o.manualDiscount)} €` : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-amber-600 whitespace-nowrap">
                        {(o.discountAmount ?? 0) > 0 ? `−${fmt(o.discountAmount)} €` : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono font-bold text-gray-900 whitespace-nowrap">{fmt(o.finalPrice)} €</td>
                      <td className="px-4 py-2 font-mono text-indigo-600 whitespace-nowrap">
                        {tipOf(o) > 0 ? `${fmt(tipOf(o))} €` : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2 font-mono text-red-600 whitespace-nowrap">
                        {(o.refundedAmount ?? 0) > 0 ? `−${fmt(o.refundedAmount)} €` : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            o.status === 'refunded'  ? 'bg-red-100 text-red-700' :
                            o.status === 'delivered' ? 'bg-green-100 text-green-700' :
                            o.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                                       'bg-gray-100 text-gray-600'
                          }`}>
                            {o.status}
                          </span>
                          {o.status !== 'refunded' && (o.refundedAmount ?? 0) > 0 && (
                            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">
                              Remb. partiel
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center no-print">
                        <button
                          onClick={() => openTicket(o._id)}
                          disabled={ticketLoadingId === o._id}
                          title="Voir le ticket"
                          className="text-gray-400 hover:text-emerald-600 transition-colors disabled:opacity-40">
                          <Icon name="receipt" className={ticketLoadingId === o._id ? 'animate-pulse' : ''} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {d.orders.length === 0 && (
                    <tr>
                      <td colSpan={14} className="px-4 py-10 text-center text-gray-400">
                        Aucune commande sur cette période
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {detailOrders.length > DETAIL_PAGE_SIZE && (
              <div className="px-5 py-3 border-t border-gray-100 no-print">
                <Pagination page={detailSafePage} totalPages={detailTotalPages} setPage={setDetailPage} />
              </div>
            )}
          </div>
        </>
      )}

      {ticketTarget && (
        <OrderTicketModal order={ticketTarget} onClose={() => setTicketTarget(null)} />
      )}
    </div>
  );
};

export default AccountingDashboard;
