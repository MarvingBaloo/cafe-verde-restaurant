// src/pages/Dev.jsx — Espace DEV (super-utilisateur)
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Icon from '../components/Icon';
import ConfirmModal from '../components/modals/ConfirmModal';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import {
  devListUsers,
  devCreateUser,
  devUpdateUser,
  devDeleteUser,
  devBackup,
  devRestore,
  devSetPassword,
  devStripePaymentPreview,
  devImportOrderFromStripe,
  devUpdateOrderItems,
  fetchOrders,
  deleteOrder,
  getDeletionImpact,
  searchUsers,
} from '../services/api';
import { Pagination } from '../components/admin/ListControls';
import OrderTicketModal from '../components/modals/OrderTicketModal';
import InvoiceModal from '../components/modals/InvoiceModal';
import QuickClientModal from '../components/modals/QuickClientModal';
import { orderLabel } from '../utils/orderTicket';

const HISTORY_PAGE_SIZE = 100;
const USERS_PAGE_SIZE = 20;

const emptyItem = () => ({ name: '', quantity: 1, price: '', taxRate: '' });

// Le panier n'a jamais transité par Stripe : ces lignes sont une reconstitution de mémoire.
// Le total affiché n'est qu'un repère — le montant encaissé fait foi et n'est jamais modifié.
const ItemsEditor = ({ items, setItems, expected }) => {
  const update = (i, field, value) =>
    setItems(items.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  const total = items.reduce(
    (s, it) => s + (parseFloat(it.price) || 0) * (parseInt(it.quantity, 10) || 1), 0);
  const gap = expected != null ? total - expected : null;

  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={it.name}
            onChange={(e) => update(i, 'name', e.target.value)}
            placeholder="Article (ex. Salade César)"
            className="flex-1 min-w-0 border rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          />
          <input
            type="number" min="1" value={it.quantity}
            onChange={(e) => update(i, 'quantity', e.target.value)}
            title="Quantité"
            className="w-16 border rounded-lg px-2 py-1.5 text-sm text-center"
          />
          <input
            type="number" step="0.01" min="0" value={it.price}
            onChange={(e) => update(i, 'price', e.target.value)}
            placeholder="Prix €" title="Prix unitaire TTC"
            className="w-24 border rounded-lg px-2 py-1.5 text-sm text-right"
          />
          <input
            type="number" step="0.1" min="0" value={it.taxRate}
            onChange={(e) => update(i, 'taxRate', e.target.value)}
            placeholder="TVA %" title="Taux de TVA — vide = taux du mode de consommation"
            className="w-20 border rounded-lg px-2 py-1.5 text-sm text-right"
          />
          <button
            onClick={() => setItems(items.filter((_, idx) => idx !== i))}
            className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
            title="Retirer la ligne"
          >
            <Icon name="close" />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={() => setItems([...items, emptyItem()])}
          className="text-sm text-brand-700 hover:text-brand-800 font-medium inline-flex items-center gap-1"
        >
          <Icon name="add" /> Ajouter une ligne
        </button>
        {items.length > 0 && (
          <p className="text-sm tabular-nums">
            <span className="text-gray-500">Lignes : </span>
            <span className="font-semibold">{total.toFixed(2)} €</span>
            {gap != null && Math.abs(gap) > 0.005 && (
              <span className="ml-2 text-amber-600">
                (écart de {gap > 0 ? '+' : ''}{gap.toFixed(2)} € — le montant encaissé fait foi)
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
};

// Rattachement d'une fiche client — partagé par la réintégration et la reprise a posteriori,
// pour que la garde de divergence et les points annoncés soient identiques des deux côtés.
const ClientPicker = ({
  client, onAttach, onDetach, onRequestCreate,
  customerName, onCustomerName,
  stripeCustomer, cardHolder, points, notice = null,
}) => {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const run = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const res = await searchUsers(q);
      setResults(res.data?.data || res.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Recherche client impossible');
    } finally {
      setSearching(false);
    }
  };

  const norm = (s) => String(s || '').trim().toLowerCase();
  const diverges = client && stripeCustomer
    && norm(stripeCustomer) !== 'anonyme'
    && norm(stripeCustomer) !== norm(client.name);

  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-1">Client</p>

      {client && (
        <div className="flex items-center justify-between gap-3 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
          <div className="text-sm">
            <p className="font-semibold text-brand-800">{client.name}</p>
            <p className="text-xs text-brand-700">
              {client.existing ? (
                <>Rattaché · {client.creditedPoints || 0} pts déjà crédités</>
              ) : (
                <>
                  {client.phone || client.email || '—'} · solde {client.loyaltyPoints || 0} pts
                  {' → '}<span className="font-bold">+{points} pts</span> à l'enregistrement
                </>
              )}
            </p>
          </div>
          <button onClick={onDetach} className="text-xs text-gray-500 hover:text-red-600 font-semibold shrink-0">
            {client.existing ? 'Changer' : 'Détacher'}
          </button>
        </div>
      )}

      {diverges && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800">
          La caisse a encaissé ce paiement pour <span className="font-bold">{stripeCustomer}</span> — ce n'est pas le client rattaché.
        </div>
      )}

      {notice && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-800">
          {notice}
        </div>
      )}

      {!client && (
        <>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="Rechercher un client (nom, téléphone, email)"
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
            <button
              onClick={run}
              disabled={searching || query.trim().length < 2}
              className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm font-semibold text-gray-600 disabled:opacity-40"
            >
              {searching ? '…' : <Icon name="search" />}
            </button>
            <button
              onClick={onRequestCreate}
              className="px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 shrink-0"
            >
              <Icon name="add" /> Nouveau
            </button>
          </div>

          {results.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg divide-y max-h-40 overflow-y-auto">
              {results.map((c) => (
                <button
                  key={c._id || c.id}
                  onClick={() => { onAttach(c); setResults([]); setQuery(''); }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-gray-500"> · {c.phone || c.email || '—'} · {c.loyaltyPoints || 0} pts</span>
                </button>
              ))}
            </div>
          )}

        </>
      )}

      {/* Libellé du ticket : éditable en toutes circonstances — c'est la correction la plus
          courante, et l'interdire dès qu'une fiche est rattachée n'avait aucune raison d'être. */}
      <input
        value={customerName}
        onChange={(e) => onCustomerName(e.target.value)}
        placeholder="Réintégration Stripe"
        className="w-full mt-2 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
      />
      <p className="text-xs text-gray-500 mt-1">
        Nom porté par le ticket.
        {!client && <span className="font-medium text-amber-700"> Sans fiche client rattachée, aucun point n'est crédité.</span>}
        {' '}
        {stripeCustomer
          ? 'Nom repris du paiement.'
          : cardHolder
            ? 'Pré-rempli avec le nom du porteur de la carte — à confirmer, ce n\'est pas forcément le client.'
            : 'Ce paiement ne porte aucun nom (antérieur au 15/08/2026).'}
      </p>
    </div>
  );
};

const STATUS_META = {
  open:      { text: 'Ticket ouvert', color: 'bg-gray-100 text-gray-700' },
  pending:   { text: 'En attente',    color: 'bg-yellow-100 text-yellow-800' },
  preparing: { text: 'En cuisine',    color: 'bg-blue-100 text-blue-800' },
  ready:     { text: 'Prêt',          color: 'bg-green-100 text-green-800' },
  delivered: { text: 'Livré',         color: 'bg-gray-100 text-gray-800' },
  completed: { text: 'Terminée',      color: 'bg-gray-100 text-gray-800' },
  cancelled: { text: 'Annulé',        color: 'bg-red-100 text-red-800' },
  refunded:  { text: 'Remboursé',     color: 'bg-purple-100 text-purple-800' },
};
const statusMeta = (s) => STATUS_META[s] || { text: s || '—', color: 'bg-gray-100 text-gray-700' };

const tsToDate = (v) => {
  if (!v) return null;
  if (typeof v === 'object' && v._seconds != null) return new Date(v._seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const ROLES = ['client', 'kitchen', 'admin', 'superadmin', 'dev'];
const ROLE_LABEL = {
  client: 'Client', kitchen: 'Cuisine', admin: 'Manager',
  superadmin: 'Gérant', dev: 'Développeur',
};
const ROLE_BADGE = {
  client: 'bg-green-100 text-green-700',
  kitchen: 'bg-amber-100 text-amber-700',
  admin: 'bg-blue-100 text-blue-700',
  superadmin: 'bg-purple-100 text-purple-700',
  dev: 'bg-slate-800 text-white',
};

const Dev = () => {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const currentId = currentUser?._id || currentUser?.id;
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'client' });
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [restoreData, setRestoreData] = useState(null);
  const fileRef = useRef(null);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', loyaltyPoints: 0, password: '' });
  const [editSaving, setEditSaving] = useState(false);

  const [usersPage, setUsersPage] = useState(1);
  const [activeTab, setActiveTab] = useState('comptes');
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderDeleteTarget, setOrderDeleteTarget] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Points de fidélité repris par la suppression, annoncés avant de confirmer.
  // null = calcul en cours ; { moves } ; { error: true }.
  const [deleteImpact, setDeleteImpact] = useState(null);
  const [ticketTarget, setTicketTarget] = useState(null);
  const [invoiceTarget, setInvoiceTarget] = useState(null);

  // Réintégration d'un paiement Stripe orphelin
  const [piInput, setPiInput] = useState('');
  const [piLoading, setPiLoading] = useState(false);
  const [piPreview, setPiPreview] = useState(null);
  const [importItems, setImportItems] = useState([]);
  const [importMode, setImportMode] = useState('dineIn');
  const [importCustomer, setImportCustomer] = useState('');
  const [importClient, setImportClient] = useState(null); // fiche rattachée → points crédités
  const [quickTarget, setQuickTarget] = useState(null);   // quel écran attend la fiche créée
  const [mismatch, setMismatch] = useState(null);         // divergence signalée par le backend
  const [importing, setImporting] = useState(false);
  // Retour ultérieur sur une commande déjà réintégrée
  const [itemsTarget, setItemsTarget] = useState(null);
  const [itemsDraft, setItemsDraft] = useState([]);
  const [itemsSaving, setItemsSaving] = useState(false);
  const [itemsClient, setItemsClient] = useState(null);
  const [itemsCustomer, setItemsCustomer] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await devListUsers();
      setUsers(res.data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const loadOrders = async () => {
    setOrdersLoading(true);
    try {
      const res = await fetchOrders();
      const list = res.data?.data || res.data || [];
      const sorted = [...list].sort((a, b) => {
        const da = tsToDate(a.createdAt)?.getTime() || 0;
        const db = tsToDate(b.createdAt)?.getTime() || 0;
        return db - da;
      });
      setOrders(sorted);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur de chargement des commandes');
    } finally {
      setOrdersLoading(false);
    }
  };

  // --- Réintégration Stripe ---
  const searchPayment = async () => {
    const id = piInput.trim();
    if (!id) return;
    setPiLoading(true);
    setPiPreview(null);
    try {
      const res = await devStripePaymentPreview(id);
      const data = res.data.data;
      setPiPreview(data);
      setImportMode(data.metadata?.consumptionMode === 'takeaway' ? 'takeaway' : 'dineIn');
      // Les paiements d'avant le 15/08/2026 n'ont aucune métadonnée : il ne reste que le nom
      // du porteur de la carte, à confirmer. Champ vide plutôt qu'un nom inventé.
      setImportCustomer(data.metadata?.customer || data.cardHolder || '');
      setImportItems([]);
      resetClientPicker();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Paiement introuvable');
    } finally {
      setPiLoading(false);
    }
  };

  const resetClientPicker = () => setImportClient(null);

  const attachClient = (client) => {
    setImportClient(client);
    setImportCustomer(client.name || '');
  };

  // confirmMismatch : second passage, après que le dev a confirmé rattacher un client dont le
  // nom diffère de celui encaissé en caisse. Le backend reste l'autorité sur cette garde.
  const doImport = async (confirmMismatch = false) => {
    if (!piPreview || piPreview.linkedOrder) return;
    setImporting(true);
    try {
      const res = await devImportOrderFromStripe({
        paymentIntentId: piPreview.paymentIntentId,
        items: importItems,
        consumptionMode: importMode,
        customerName: importCustomer.trim(),
        userId: importClient?._id || importClient?.id || null,
        confirmMismatch,
      });
      // Le backend distingue « crédité » de « commande créée mais crédit en échec ».
      const created = res.data.data;
      if (created?.loyalty?.failed) toast.error(res.data.message);
      else toast.success(res.data.message || `Commande ${orderLabel(created)} réintégrée`);
      setPiPreview(null);
      setPiInput('');
      setImportItems([]);
      setImportCustomer('');
      resetClientPicker();
      loadOrders();
    } catch (err) {
      if (err.response?.data?.code === 'name_mismatch') setMismatch(err.response.data.mismatch);
      else toast.error(err.response?.data?.message || 'Réintégration impossible');
    } finally {
      setImporting(false);
    }
  };

  const openItemsEditor = (order) => {
    setItemsTarget(order);
    setItemsDraft((order.products || []).map(p => ({
      name: p.name || '',
      quantity: p.quantity || 1,
      price: p.price ?? '',
      taxRate: p.taxRate ?? '',
    })));
    // La fiche déjà rattachée n'est connue que par son id et le nom du ticket : assez pour la
    // renvoyer telle quelle si rien ne change, et pour savoir combien retirer si elle change.
    setItemsClient(order.user
      ? { _id: order.user, name: order.customerName || 'Client', existing: true, creditedPoints: order.loyaltyCredited || 0 }
      : null);
    setItemsCustomer(order.customerName || '');
  };

  const saveItems = async (confirmMismatch = false) => {
    if (!itemsTarget) return;
    setItemsSaving(true);
    try {
      const res = await devUpdateOrderItems(itemsTarget._id || itemsTarget.id, {
        items: itemsDraft,
        consumptionMode: itemsTarget.consumptionMode || 'dineIn',
        customerName: itemsCustomer.trim(),
        userId: itemsClient?._id || itemsClient?.id || null,
        confirmMismatch,
      });
      if (res.data.data?.loyalty?.failed) toast.error(res.data.message);
      else toast.success(res.data.message || 'Commande mise à jour');
      setItemsTarget(null);
      setItemsClient(null);
      loadOrders();
    } catch (err) {
      if (err.response?.data?.code === 'name_mismatch') {
        setMismatch({ ...err.response.data.mismatch, target: 'items' });
      } else {
        toast.error(err.response?.data?.message || 'Enregistrement impossible');
      }
    } finally {
      setItemsSaving(false);
    }
  };

  // Annonce du transfert de points avant d'enregistrer : le retrait à l'ancien client est la
  // conséquence la moins évidente d'un changement de fiche, elle doit être lue avant le clic.
  const itemsTransferNotice = useMemo(() => {
    if (!itemsTarget?.user) return null;
    const currentId = itemsClient?._id || itemsClient?.id || null;
    if (currentId === itemsTarget.user) return null;
    const credited = itemsTarget.loyaltyCredited || 0;
    const removal = credited > 0
      ? `${credited} pts seront retirés à ${itemsTarget.customerName || 'l\'ancien client'} (plafonné à 0 s'il les a déjà dépensés)`
      : `aucun point n'était tracé pour ${itemsTarget.customerName || 'l\'ancien client'}, rien ne sera retiré`;
    const gain = itemsClient
      ? ` et ${Math.floor(Number(itemsTarget.finalPrice ?? itemsTarget.totalPrice ?? 0))} pts crédités à ${itemsClient.name}`
      : '';
    return `Changement de client : ${removal}${gain}.`;
  }, [itemsTarget, itemsClient]);

  const historyTotalPages = Math.max(1, Math.ceil(orders.length / HISTORY_PAGE_SIZE));
  const historySafePage = Math.min(historyPage, historyTotalPages);
  const historyPageItems = orders.slice((historySafePage - 1) * HISTORY_PAGE_SIZE, historySafePage * HISTORY_PAGE_SIZE);

  useEffect(() => { load(); loadOrders(); }, []);

  useEffect(() => {
    const ids = orderDeleteTarget ? [orderDeleteTarget._id || orderDeleteTarget.id]
      : bulkDeleteOpen ? Array.from(selectedIds) : [];
    if (!ids.length) return;
    let alive = true;
    getDeletionImpact(ids)
      .then(res => { if (alive) setDeleteImpact({ moves: res.data?.data?.moves || [] }); })
      .catch(() => { if (alive) setDeleteImpact({ error: true }); });
    return () => { alive = false; setDeleteImpact(null); };
  }, [orderDeleteTarget, bulkDeleteOpen, selectedIds]);

  // Résumé après suppression : quels soldes ont bougé.
  const loyaltySummary = (moves) => moves.length
    ? ` — points corrigés : ${moves.map(m => `${m.name} ${m.balance} → ${m.newBalance} pts`).join(', ')}`
    : '';

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const usersTotalPages = Math.max(1, Math.ceil(filtered.length / USERS_PAGE_SIZE));
  const usersSafePage = Math.min(usersPage, usersTotalPages);
  const usersPageItems = filtered.slice((usersSafePage - 1) * USERS_PAGE_SIZE, usersSafePage * USERS_PAGE_SIZE);
  useEffect(() => { setUsersPage(1); }, [search]);

  const handleCreate = async () => {
    if (!form.name || !form.email || !form.password) {
      toast.warning('Nom, email et mot de passe requis');
      return;
    }
    setSaving(true);
    try {
      await devCreateUser(form);
      toast.success('Compte créé');
      setCreateOpen(false);
      setForm({ name: '', email: '', password: '', role: 'client' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur création');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (u, role) => {
    try {
      await devUpdateUser(u._id || u.id, { role });
      toast.success('Rôle mis à jour');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur mise à jour');
    }
  };

  const openEdit = (u) => {
    setEditForm({
      name: u.name || '',
      email: u.email || '',
      loyaltyPoints: u.loyaltyPoints ?? 0,
      password: '',
    });
    setEditTarget(u);
  };

  const handleUpdate = async () => {
    if (!editTarget) return;
    if (!editForm.name.trim()) {
      toast.warning('Le nom est requis');
      return;
    }
    if (editForm.password && editForm.password.length < 6) {
      toast.warning('Le mot de passe doit faire au moins 6 caractères');
      return;
    }
    setEditSaving(true);
    try {
      const id = editTarget._id || editTarget.id;
      // Email volontairement non modifié ici (sync Firebase Auth requise — voir CLAUDE.md)
      await devUpdateUser(id, {
        name: editForm.name.trim(),
        loyaltyPoints: Number(editForm.loyaltyPoints) || 0,
      });
      if (editForm.password) {
        await devSetPassword(id, editForm.password);
      }
      toast.success('Compte mis à jour');
      setEditTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur mise à jour');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await devDeleteUser(deleteTarget._id || deleteTarget.id);
      toast.success('Compte supprimé');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur suppression');
      setDeleteTarget(null);
    }
  };

  const handleBackup = async () => {
    try {
      const res = await devBackup();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Backup téléchargé');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur backup');
    }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        setRestoreData(parsed);
      } catch {
        toast.error('Fichier JSON invalide');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!restoreData) return;
    try {
      const res = await devRestore(restoreData);
      const summary = res.data?.data?.summary || {};
      const recap = Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(', ');
      toast.success(`Restauration OK — ${recap}`);
      setRestoreData(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur restauration');
      setRestoreData(null);
    }
  };

  const handleDeleteOrder = async () => {
    if (!orderDeleteTarget) return;
    const id = orderDeleteTarget._id || orderDeleteTarget.id;
    try {
      const res = await deleteOrder(id);
      toast.success(`Commande supprimée${loyaltySummary(res.data?.data?.loyalty || [])}`);
      setOrderDeleteTarget(null);
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      loadOrders();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur suppression');
      setOrderDeleteTarget(null);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const allPageSelected = historyPageItems.length > 0 &&
    historyPageItems.every(o => selectedIds.has(o._id || o.id));

  const toggleSelectPage = () => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (allPageSelected) historyPageItems.forEach(o => n.delete(o._id || o.id));
      else historyPageItems.forEach(o => n.add(o._id || o.id));
      return n;
    });
  };

  const selectedOrders = orders.filter(o => selectedIds.has(o._id || o.id));
  const selectedTotal = selectedOrders.reduce((s, o) => s + (o.finalPrice ?? o.totalPrice ?? 0), 0);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map(id => deleteOrder(id)));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    const moved = results.flatMap(r => (r.status === 'fulfilled' ? r.value.data?.data?.loyalty || [] : []));
    const pointsNote = moved.length ? ` — points corrigés pour ${[...new Set(moved.map(m => m.name))].join(', ')}` : '';
    if (ok > 0) toast.success(`${ok} commande${ok > 1 ? 's' : ''} supprimée${ok > 1 ? 's' : ''}${pointsNote}`);
    if (failed > 0) toast.error(`${failed} suppression${failed > 1 ? 's' : ''} en échec`);
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    setSelectedIds(new Set());
    loadOrders();
  };


  // Effet de la suppression sur la fidélité, lu dans l'aperçu serveur.
  const deletionImpactText = (
    !deleteImpact ? (
      <span className="block mt-3 text-sm text-gray-400">Calcul des points de fidélité…</span>
    ) : deleteImpact.error ? (
      <span className="block mt-3 text-sm text-amber-700">
        Aperçu des points indisponible — ils seront tout de même corrigés à la suppression.
      </span>
    ) : !deleteImpact.moves.length ? (
      <span className="block mt-3 text-sm text-gray-500">Aucun point de fidélité concerné.</span>
    ) : (
      <span className="block mt-3 text-sm">
        <span className="block font-semibold text-gray-700">Points de fidélité corrigés :</span>
        {deleteImpact.moves.map(m => (
          <span key={m.uid} className="block text-gray-600">
            {m.name} : {[
              m.earned > 0 && `${m.earned} pts gagnés retirés`,
              m.redeemed > 0 && `${m.redeemed} pts utilisés rendus`,
            ].filter(Boolean).join(', ')} — solde {m.balance} → {m.newBalance} pts
            {m.shortfall > 0 && (
              <span className="block text-amber-700">{m.shortfall} pts déjà dépensés ne peuvent pas être repris.</span>
            )}
          </span>
        ))}
      </span>
    )
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-3xl text-slate-800"><Icon name="shield" /></span>
        <h1 className="text-3xl gelasio font-bold text-gray-900">Espace DEV</h1>
      </div>

      {/* Barre d'onglets */}
      <div className="border-b border-gray-200 mb-8">
        <nav className="flex space-x-6 overflow-x-auto">
          {[
            { id: 'comptes',    label: 'Comptes',            icon: 'account' },
            { id: 'historique', label: 'Historique récent',  icon: 'history' },
            { id: 'stripe',     label: 'Réintégration Stripe', icon: 'card' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 px-1 whitespace-nowrap font-medium text-sm transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-brand-700 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-brand-600 hover:border-brand-300'
              }`}
            >
              <span className="inline-flex items-center gap-1.5"><Icon name={tab.icon} /> {tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'comptes' && (
      <>
      {/* Recherche + Nouveau */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Icon name="search" /></span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom, email, téléphone)"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 justify-center"
        >
          <Icon name="add" /> Nouveau compte
        </button>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto mb-8">
        {loading ? (
          <p className="p-6 text-gray-500">Chargement…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-gray-500">Aucun compte.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Nom</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Rôle</th>
                <th className="px-4 py-3 font-semibold">Points</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usersPageItems.map((u) => {
                const isSelf = (u._id || u.id) === currentId;
                return (
                <tr key={u._id || u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {u.name || '—'}{isSelf && <span className="ml-2 text-xs text-gray-400">(vous)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email || u.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role || 'client'}
                      onChange={(e) => handleRoleChange(u, e.target.value)}
                      disabled={isSelf}
                      className={`text-xs font-bold px-2 py-1 rounded-full border-0 ${isSelf ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${ROLE_BADGE[u.role] || 'bg-gray-100 text-gray-700'}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r} className="bg-white text-gray-900">{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.loyaltyPoints ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-gray-500 hover:text-brand-600 p-1.5 rounded-lg hover:bg-gray-100"
                        title="Modifier"
                      >
                        <Icon name="edit" />
                      </button>
                      {!isSelf && (
                        <button
                          onClick={() => setDeleteTarget(u)}
                          className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                          title="Supprimer"
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {filtered.length > 0 && (
        <div className="mb-8">
          <Pagination page={usersSafePage} totalPages={usersTotalPages} setPage={setUsersPage} />
        </div>
      )}

      {/* Backup / Restore */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl text-slate-800"><Icon name="database" /></span>
          <h2 className="text-xl font-bold text-gray-900">Sauvegarde &amp; restauration</h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleBackup}
            className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 justify-center"
          >
            <Icon name="download" /> Télécharger le backup
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 justify-center"
          >
            <Icon name="upload" /> Importer un backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            onChange={handleFile}
            className="hidden"
          />
        </div>
      </div>
      </>
      )}

      {activeTab === 'historique' && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-2xl font-bold text-gray-700">Historique Récent</h2>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setBulkDeleteOpen(true)}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
              >
                <Icon name="trash" /> Supprimer la sélection ({selectedIds.size})
              </button>
            )}
          </div>
          {ordersLoading ? (
            <p className="text-gray-500 italic">Chargement…</p>
          ) : (
            <>
              {orders.length === 0 ? (
                <p className="text-gray-500 italic">Aucune commande dans l'historique.</p>
              ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-left border-b border-gray-200">
                  <tr>
                    <th className="py-1 pr-3 w-8">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleSelectPage}
                        className="h-4 w-4 accent-red-600 cursor-pointer"
                        title="Tout cocher sur cette page"
                      />
                    </th>
                    <th className="py-1 pr-3 font-semibold">Date</th>
                    <th className="py-1 pr-3 font-semibold">N°</th>
                    <th className="py-1 pr-3 font-semibold">Client</th>
                    <th className="py-1 pr-3 font-semibold">Statut</th>
                    <th className="py-1 pr-3 font-semibold text-right">Montant</th>
                    <th className="py-1 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                {historyPageItems.map(order => {
                  const id = order._id || order.id;
                  const meta = statusMeta(order.status);
                  const d = tsToDate(order.paidAt) || tsToDate(order.createdAt);
                  const checked = selectedIds.has(id);
                  return (
                    <tr
                      key={id}
                      onClick={() => toggleSelect(id)}
                      className={`border-b last:border-0 transition-colors cursor-pointer select-none ${checked ? 'bg-red-50' : 'hover:bg-brand-50'}`}
                    >
                      <td className="py-1 pr-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 accent-red-600 cursor-pointer"
                        />
                      </td>
                      <td className="py-1 pr-3 text-gray-400 tabular-nums whitespace-nowrap">
                        {d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Guadeloupe' }) : '—'}
                      </td>
                      <td className="py-1 pr-3 font-mono text-gray-700 whitespace-nowrap">{orderLabel(order)}</td>
                      <td className="py-1 pr-3 text-gray-600">{order.customerName || '—'}</td>
                      <td className="py-1 pr-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${meta.color}`}>{meta.text}</span>
                      </td>
                      <td className="py-1 pr-3 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">
                        {Number(order.finalPrice ?? order.totalPrice ?? 0).toFixed(2)} €
                      </td>
                      <td className="py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {order.source === 'stripe_import' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openItemsEditor(order); }}
                              className="text-brand-600 hover:text-brand-800 p-1.5 rounded-lg hover:bg-brand-50"
                              title="Compléter la commande — client et articles (réintégration Stripe)"
                            >
                              <Icon name="edit" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setTicketTarget(order); }}
                            className="text-gray-500 hover:text-brand-600 p-1.5 rounded-lg hover:bg-gray-100"
                            title="Voir le détail du ticket"
                          >
                            <Icon name="receipt" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setInvoiceTarget(order); }}
                            className="text-gray-500 hover:text-brand-600 p-1.5 rounded-lg hover:bg-gray-100"
                            title="Éditer une facture"
                          >
                            <Icon name="invoice" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setOrderDeleteTarget(order); }}
                            className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                            title="Supprimer en base"
                          >
                            <Icon name="close" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
              </div>
              )}
              {orders.length > 0 && (
                <Pagination page={historySafePage} totalPages={historyTotalPages} setPage={setHistoryPage} />
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'stripe' && (
        <div className="max-w-3xl">
          <h2 className="text-2xl font-bold text-gray-700 mb-1">Réintégration Stripe</h2>
          <p className="text-sm text-gray-500 mb-6">
            Rapatrie un paiement encaissé chez Stripe qui n'a pas de commande côté application.
            Le panier n'ayant jamais transité par Stripe, les articles ne peuvent être que
            reconstitués — ils restent complétables plus tard depuis l'historique.
          </p>

          <div className="flex gap-2 mb-6">
            <input
              value={piInput}
              onChange={(e) => setPiInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchPayment()}
              placeholder="pi_3U4901RP97kQkzYD0Vhj4Ktj"
              className="flex-1 border rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            />
            <button
              onClick={searchPayment}
              disabled={piLoading || !piInput.trim()}
              className="bg-brand-600 hover:bg-brand-700 text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Icon name="search" /> {piLoading ? 'Recherche…' : 'Rechercher'}
            </button>
          </div>

          {piPreview && (
            <div className="border border-gray-200 rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-400 text-xs">Encaissé</p>
                  <p className="font-bold text-lg tabular-nums">{piPreview.amount.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">Dont pourboire</p>
                  <p className="font-semibold tabular-nums text-indigo-600">{piPreview.tip.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">Montant commande</p>
                  <p className="font-bold text-lg tabular-nums text-brand-700">{piPreview.net.toFixed(2)} €</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">Date du paiement</p>
                  <p className="font-medium">
                    {new Date(piPreview.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Guadeloupe' })}
                  </p>
                </div>
              </div>

              {(piPreview.cardLast4 || Object.keys(piPreview.metadata || {}).length > 0) && (
                <p className="text-xs text-gray-500">
                  {piPreview.cardLast4 && <span className="mr-3">Carte {piPreview.cardBrand} •••• {piPreview.cardLast4}</span>}
                  {Object.entries(piPreview.metadata || {}).map(([k, v]) => (
                    <span key={k} className="mr-3">{k} : <span className="font-medium text-gray-700">{v}</span></span>
                  ))}
                </p>
              )}

              {piPreview.linkedOrder ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                  <span className="font-bold">Déjà rattaché</span> à la commande{' '}
                  <span className="font-mono">{piPreview.linkedOrder.orderNumber ? `#${piPreview.linkedOrder.orderNumber}` : piPreview.linkedOrder.id}</span>.
                  Réintégrer le compterait deux fois dans le chiffre d'affaires.
                </div>
              ) : piPreview.status === 'requires_capture' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <span className="font-bold">Paiement autorisé mais jamais encaissé.</span> La
                  réintégration le capturera chez Stripe, puis créera la commande.
                </div>
              ) : piPreview.status !== 'succeeded' ? (
                <div className="bg-gray-100 border border-gray-200 rounded-lg p-3 text-sm text-gray-700">
                  Statut Stripe : <span className="font-mono">{piPreview.status}</span> — rien à réintégrer.
                </div>
              ) : null}

              {!piPreview.linkedOrder && (
                <>
                  <ClientPicker
                    client={importClient}
                    onAttach={attachClient}
                    onDetach={resetClientPicker}
                    onRequestCreate={() => setQuickTarget('import')}
                    customerName={importCustomer}
                    onCustomerName={setImportCustomer}
                    stripeCustomer={piPreview.metadata?.customer || null}
                    cardHolder={piPreview.cardHolder}
                    points={Math.floor(piPreview.net)}
                  />

                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-1">Consommation (détermine le taux de TVA)</p>
                    <div className="flex gap-2">
                      {[['dineIn', 'Sur place'], ['takeaway', 'À emporter']].map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setImportMode(value)}
                          className={`flex-1 py-2 border-2 rounded-lg text-sm font-semibold transition ${
                            importMode === value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">
                      Articles (facultatif — complétables plus tard)
                    </p>
                    <ItemsEditor items={importItems} setItems={setImportItems} expected={piPreview.net} />
                  </div>

                  <button
                    onClick={() => doImport()}
                    disabled={importing || piPreview.status === 'canceled'}
                    className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold transition disabled:opacity-40"
                  >
                    {importing
                      ? 'Réintégration…'
                      : `Réintégrer ${piPreview.net.toFixed(2)} €${importClient ? ` · +${Math.floor(piPreview.net)} pts pour ${importClient.name}` : ''}`}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Complément d'articles sur une commande déjà réintégrée */}
      {itemsTarget && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setItemsTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Compléter la commande</h3>
              <p className="text-sm text-gray-500">
                Commande {orderLabel(itemsTarget)} — encaissé{' '}
                <span className="font-semibold">{Number(itemsTarget.finalPrice ?? itemsTarget.totalPrice ?? 0).toFixed(2)} €</span>.
                Le montant ne change pas ; seule la TVA est recalculée.
              </p>
            </div>

            <ClientPicker
              client={itemsClient}
              onAttach={(c) => { setItemsClient(c); setItemsCustomer(c.name || ''); }}
              onDetach={() => setItemsClient(null)}
              onRequestCreate={() => setQuickTarget('items')}
              customerName={itemsCustomer}
              onCustomerName={setItemsCustomer}
              stripeCustomer={itemsTarget.importSource?.stripeCustomer || null}
              cardHolder={itemsTarget.importSource?.cardHolder || null}
              points={Math.floor(Number(itemsTarget.finalPrice ?? itemsTarget.totalPrice ?? 0))}
              notice={itemsTransferNotice}
            />

            <ItemsEditor
              items={itemsDraft}
              setItems={setItemsDraft}
              expected={Number(itemsTarget.finalPrice ?? itemsTarget.totalPrice ?? 0)}
            />
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setItemsTarget(null)}
                className="flex-1 py-2.5 border border-gray-300 rounded-lg font-semibold text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={() => saveItems()}
                disabled={itemsSaving}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold disabled:opacity-40"
              >
                {itemsSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale création */}
      {createOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCreateOpen(false)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <h2 className="gelasio font-bold text-xl text-gray-900 mb-4">Nouveau compte</h2>
            <div className="space-y-3">
              <input type="text" placeholder="Nom" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
              <input type="email" placeholder="Email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
              <input type="password" placeholder="Mot de passe" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
              <select value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none">
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setCreateOpen(false)}
                className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-bold hover:bg-gray-200">Annuler</button>
              <button onClick={handleCreate} disabled={saving}
                className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-full font-bold disabled:opacity-50">
                {saving ? 'Création…' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale édition */}
      {editTarget && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditTarget(null)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <h2 className="gelasio font-bold text-xl text-gray-900 mb-4">Modifier le compte</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Nom</label>
                <input type="text" value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Email <span className="font-normal text-gray-400">(non modifiable ici)</span></label>
                <input type="email" value={editForm.email} disabled
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-400 cursor-not-allowed outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Points de fidélité</label>
                <input type="number" min="0" value={editForm.loyaltyPoints}
                  onChange={(e) => setEditForm({ ...editForm, loyaltyPoints: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  Nouveau mot de passe {!editTarget?.firebaseUid && <span className="font-normal text-gray-400">(indisponible — compte sans login Firebase)</span>}
                </label>
                <input type="password" value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  disabled={!editTarget?.firebaseUid}
                  placeholder={editTarget?.firebaseUid ? 'Laisser vide pour ne pas changer (min. 6 caractères)' : '—'}
                  className={`w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none ${editTarget?.firebaseUid ? 'focus:ring-2 focus:ring-brand-500' : 'bg-gray-50 text-gray-400 cursor-not-allowed'}`} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditTarget(null)}
                className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-bold hover:bg-gray-200">Annuler</button>
              <button onClick={handleUpdate} disabled={editSaving}
                className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-full font-bold disabled:opacity-50">
                {editSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Supprimer ce compte ?"
        message={`Le compte « ${deleteTarget?.name || ''} » sera supprimé définitivement (Firestore + Firebase Auth).`}
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        isOpen={!!orderDeleteTarget}
        title="Supprimer cette commande ?"
        message={<>La commande {orderLabel(orderDeleteTarget)} sera supprimée définitivement de la base.{deletionImpactText}</>}
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={handleDeleteOrder}
        onCancel={() => setOrderDeleteTarget(null)}
      />

      {ticketTarget && (
        <OrderTicketModal order={ticketTarget} onClose={() => setTicketTarget(null)} />
      )}

      {invoiceTarget && (
        <InvoiceModal order={invoiceTarget} onClose={() => setInvoiceTarget(null)} />
      )}

      <ConfirmModal
        isOpen={bulkDeleteOpen}
        title={`Supprimer ${selectedIds.size} commande${selectedIds.size > 1 ? 's' : ''} ?`}
        message={<>{`${selectedIds.size} commande${selectedIds.size > 1 ? 's' : ''} ser${selectedIds.size > 1 ? 'ont' : 'a'} supprimée${selectedIds.size > 1 ? 's' : ''} définitivement de la base. Montant total sélectionné : ${selectedTotal.toFixed(2)} €.`}{deletionImpactText}</>}
        variant="danger"
        confirmLabel={bulkDeleting ? 'Suppression…' : 'Supprimer'}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteOpen(false)}
      />

      <ConfirmModal
        isOpen={!!restoreData}
        title="Restaurer ce backup ?"
        message="Les données du catalogue et des commandes seront réécrites (upsert). Les comptes utilisateurs ne seront jamais supprimés. Continuer ?"
        variant="warning"
        confirmLabel="Restaurer"
        onConfirm={handleRestore}
        onCancel={() => setRestoreData(null)}
      />

      <ConfirmModal
        isOpen={!!mismatch}
        title="Ce n'est pas le client de ce paiement"
        message={mismatch
          ? `La caisse a encaissé ce paiement pour « ${mismatch.stripeCustomer} », or vous rattachez « ${mismatch.selected} ». Les points iront à ${mismatch.selected}. Confirmer ?`
          : ''}
        variant="warning"
        confirmLabel="Rattacher quand même"
        onConfirm={() => {
          const target = mismatch?.target;
          setMismatch(null);
          if (target === 'items') saveItems(true); else doImport(true);
        }}
        onCancel={() => setMismatch(null)}
      />

      <QuickClientModal
        isOpen={!!quickTarget}
        onClose={() => setQuickTarget(null)}
        onCreated={(client) => {
          const target = quickTarget;
          setQuickTarget(null);
          if (!client) return;
          if (target === 'items') { setItemsClient(client); setItemsCustomer(client.name || ''); }
          else attachClient(client);
        }}
      />
    </div>
  );
};

export default Dev;
