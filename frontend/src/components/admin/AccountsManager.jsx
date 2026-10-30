// src/components/admin/AccountsManager.jsx — Espace Gérant · onglet Comptes & points
import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../Icon';
import { Pagination } from './ListControls';
import { useToast } from '../../context/ToastContext';
import { getUsers, updateUserByAdmin } from '../../services/api';
import { pointsToEuros } from '../../utils/loyalty';
import { socket } from '../../socket';

const PAGE_SIZE = 20;

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

const AccountsManager = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [editTarget, setEditTarget] = useState(null);
  const [name, setName] = useState('');
  const [adjustMode, setAdjustMode] = useState('credit'); // 'credit' | 'debit'
  const [adjustAmount, setAdjustAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getUsers();
      setUsers(res.data.data || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const reload = () => load();
    socket.on('user_updated', reload);
    socket.on('user_deleted', reload);
    return () => {
      socket.off('user_updated', reload);
      socket.off('user_deleted', reload);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) =>
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search]);

  const openEdit = (u) => {
    setName(u.name || '');
    setAdjustMode('credit');
    setAdjustAmount('');
    setEditTarget(u);
  };

  const currentPoints = editTarget?.loyaltyPoints ?? 0;
  const delta = (parseInt(adjustAmount, 10) || 0) * (adjustMode === 'debit' ? -1 : 1);
  const newBalance = Math.max(0, currentPoints + delta);

  const handleSave = async () => {
    if (!editTarget) return;
    if (!name.trim() || name.trim().length < 2) {
      toast.warning('Le nom doit contenir au moins 2 caractères');
      return;
    }
    setSaving(true);
    try {
      const id = editTarget._id || editTarget.id;
      const payload = { name: name.trim() };
      if (delta !== 0) payload.loyaltyPoints = newBalance;
      await updateUserByAdmin(id, payload);
      toast.success('Compte mis à jour');
      setEditTarget(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur mise à jour');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Recherche */}
      <div className="mb-6">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Icon name="search" /></span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher (nom, email, téléphone)"
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto mb-6">
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
                <th className="px-4 py-3 font-semibold text-right">Points</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageItems.map((u) => (
                <tr key={u._id || u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email || u.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${ROLE_BADGE[u.role] || 'bg-gray-100 text-gray-700'}`}>
                      {ROLE_LABEL[u.role] || u.role || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 tabular-nums whitespace-nowrap">
                    {u.loyaltyPoints ?? 0}
                    <span className="text-gray-400 text-xs ml-1">({pointsToEuros(u.loyaltyPoints).toFixed(2)} €)</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(u)}
                      className="text-gray-500 hover:text-brand-600 p-1.5 rounded-lg hover:bg-gray-100"
                      title="Modifier"
                    >
                      <Icon name="edit" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {filtered.length > 0 && (
        <Pagination page={safePage} totalPages={totalPages} setPage={setPage} />
      )}

      {/* Modale édition */}
      {editTarget && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditTarget(null)} />
          <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-serif font-bold text-xl text-gray-900 mb-4">Modifier le compte</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Nom</label>
                <input type="text" value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Contact <span className="font-normal text-gray-400">(non modifiable)</span></label>
                <input type="text" value={editTarget.email || editTarget.phone || '—'} disabled
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-gray-50 text-gray-400 cursor-not-allowed outline-none" />
              </div>

              {/* Points */}
              <div className="rounded-xl border border-gray-200 p-4 bg-gray-50/50">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-gray-500">Points de fidélité</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">
                    {currentPoints} pts <span className="text-gray-400 font-normal">({pointsToEuros(currentPoints).toFixed(2)} €)</span>
                  </span>
                </div>
                <div className="flex gap-2 mb-3">
                  <button type="button"
                    onClick={() => setAdjustMode('credit')}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${adjustMode === 'credit' ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                    Créditer
                  </button>
                  <button type="button"
                    onClick={() => setAdjustMode('debit')}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${adjustMode === 'debit' ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                    Débiter
                  </button>
                </div>
                <input type="number" min="0" value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  placeholder="Nombre de points"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
                {delta !== 0 && (
                  <p className="mt-2 text-sm text-gray-600">
                    Nouveau solde : <span className="font-bold text-gray-900">{newBalance} pts</span>
                    <span className="text-gray-400"> ({pointsToEuros(newBalance).toFixed(2)} €)</span>
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEditTarget(null)}
                className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-bold hover:bg-gray-200">Annuler</button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-full font-bold disabled:opacity-50">
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountsManager;
