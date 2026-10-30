// src/components/admin/ProductCategoryManager.jsx
// Onglet "Catégories" de l'Espace Gérant : gestion de l'arbre de catégories de produits
// (collection productCategories). Autonome : fetch + socket + états.
// Les catégories s'ancrent dans les 4 catégories fixes (drink/coffee/dessert/side) et
// peuvent être imbriquées en profondeur illimitée. Un produit pointe vers un nœud via categoryId.

import React, { useState, useEffect } from 'react';
import {
  fetchProductCategories, createProductCategory, updateProductCategory, deleteProductCategory,
} from '../../services/api';
import { useToast } from '../../context/ToastContext';
import ConfirmModal from '../modals/ConfirmModal';
import Icon from '../Icon';
import { socket } from '../../socket';

// Les 4 sections fixes dans lesquelles s'ancrent les catégories.
const ROOTS = [
  { key: 'drink',   label: 'Boissons' },
  { key: 'coffee',  label: 'Cafés' },
  { key: 'dessert', label: 'Desserts' },
  { key: 'side',    label: 'Salés' },
];

const extract = (res) =>
  Array.isArray(res.data) ? res.data
  : Array.isArray(res.data?.data) ? res.data.data
  : Array.isArray(res.data?.message) ? res.data.message : [];

const sortNodes = (arr) => [...arr].sort((a, b) =>
  ((a.order ?? 0) - (b.order ?? 0)) || String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })
);

const Toggle = ({ on, onClick, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${on ? 'bg-green-500' : 'bg-gray-300'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
);

const ProductCategoryManager = () => {
  const { toast } = useToast();

  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);

  // Création d'une racine (par section fixe).
  const [newRootName, setNewRootName] = useState('');
  const [newRootCategory, setNewRootCategory] = useState('drink');

  // Ajout d'une sous-catégorie inline (sous un nœud donné).
  const [addingParentId, setAddingParentId] = useState(null);
  const [addingName, setAddingName] = useState('');

  // Renommage inline.
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });
  const closeConfirm = () => setConfirm(c => ({ ...c, open: false, onConfirm: null }));

  const reload = async () => {
    try {
      const res = await fetchProductCategories();
      setCats(extract(res));
    } catch (err) {
      console.error('Erreur chargement catégories:', err);
      toast.error('Erreur lors du chargement des catégories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    const onChange = () => reload();
    socket.on('product_category_created', onChange);
    socket.on('product_category_updated', onChange);
    socket.on('product_category_deleted', onChange);
    return () => {
      socket.off('product_category_created', onChange);
      socket.off('product_category_updated', onChange);
      socket.off('product_category_deleted', onChange);
    };
  }, []);

  const childrenOf = (parentId) => sortNodes(cats.filter(c => (c.parentId || null) === (parentId || null)));
  const rootsOf = (rootCategory) => sortNodes(cats.filter(c => !c.parentId && c.rootCategory === rootCategory));

  // --- Actions ---

  const handleCreateRoot = async () => {
    const name = newRootName.trim();
    if (name.length < 2) { toast.warning('Le nom doit contenir au moins 2 caractères'); return; }
    try {
      const order = rootsOf(newRootCategory).length;
      await createProductCategory({ name, parentId: null, rootCategory: newRootCategory, order });
      setNewRootName('');
      toast.success('Catégorie créée');
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création');
    }
  };

  const handleAddChild = async (parent) => {
    const name = addingName.trim();
    if (name.length < 2) { toast.warning('Le nom doit contenir au moins 2 caractères'); return; }
    try {
      const order = childrenOf(parent.id).length;
      // rootCategory est forcé par le backend depuis le parent.
      await createProductCategory({ name, parentId: parent.id, order });
      setAddingParentId(null);
      setAddingName('');
      toast.success('Sous-catégorie créée');
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création');
    }
  };

  const handleRename = async (node) => {
    const name = editingName.trim();
    if (name.length < 2) { toast.warning('Le nom doit contenir au moins 2 caractères'); return; }
    try {
      await updateProductCategory(node.id, { name });
      setEditingId(null);
      setEditingName('');
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du renommage');
    }
  };

  const handleToggle = async (node) => {
    try {
      await updateProductCategory(node.id, { isAvailable: node.isAvailable === false });
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur');
    }
  };

  // Réordonne une fratrie : normalise les `order` en 0..n-1 après échange.
  const handleMove = async (node, dir) => {
    const siblings = childrenOf(node.parentId || null).filter(s => (node.parentId ? true : s.rootCategory === node.rootCategory));
    const idx = siblings.findIndex(s => s.id === node.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    try {
      await Promise.all(reordered.map((s, i) => (s.order === i ? null : updateProductCategory(s.id, { order: i }))));
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors du tri');
    }
  };

  const askDelete = (node) => setConfirm({
    open: true,
    title: 'Supprimer la catégorie',
    message: `Supprimer « ${node.name} » ? (impossible si elle contient des sous-catégories ou des articles)`,
    variant: 'danger',
    onConfirm: async () => {
      try {
        await deleteProductCategory(node.id);
        toast.success('Catégorie supprimée');
        reload();
      } catch (err) {
        toast.error(err.response?.data?.message || 'Suppression impossible');
      } finally {
        closeConfirm();
      }
    },
  });

  // --- Rendu récursif d'un nœud ---
  const renderNode = (node, depth, rootKey) => {
    const kids = childrenOf(node.id);
    const isEditing = editingId === node.id;
    const isAdding = addingParentId === node.id;
    const siblings = node.parentId
      ? childrenOf(node.parentId)
      : rootsOf(rootKey);
    const pos = siblings.findIndex(s => s.id === node.id);

    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200"
          style={{ marginLeft: depth * 20 }}
        >
          {isEditing ? (
            <>
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(node); if (e.key === 'Escape') setEditingId(null); }}
                className="flex-grow border rounded px-2 py-1 text-sm"
              />
              <button onClick={() => handleRename(node)} className="text-green-600 p-1" title="Valider"><Icon name="check" /></button>
              <button onClick={() => setEditingId(null)} className="text-gray-400 p-1" title="Annuler"><Icon name="close" /></button>
            </>
          ) : (
            <>
              <span className={`flex-grow font-medium ${node.isAvailable === false ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                {node.name}
              </span>

              <button onClick={() => handleMove(node, 'up')} disabled={pos <= 0}
                className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Monter"><Icon name="arrow-up" /></button>
              <button onClick={() => handleMove(node, 'down')} disabled={pos >= siblings.length - 1}
                className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Descendre"><Icon name="arrow-down" /></button>

              <Toggle on={node.isAvailable !== false} onClick={() => handleToggle(node)}
                title={node.isAvailable === false ? 'Masqué' : 'Visible'} />

              <button onClick={() => { setAddingParentId(node.id); setAddingName(''); }}
                className="p-1 text-brand-600 hover:text-brand-800" title="Ajouter une sous-catégorie"><Icon name="add" /></button>
              <button onClick={() => { setEditingId(node.id); setEditingName(node.name); }}
                className="p-1 text-blue-600 hover:text-blue-800" title="Renommer"><Icon name="edit" /></button>
              <button onClick={() => askDelete(node)}
                className="p-1 text-red-500 hover:text-red-700" title="Supprimer"><Icon name="trash" /></button>
            </>
          )}
        </div>

        {isAdding && (
          <div className="flex items-center gap-2 py-2 px-3" style={{ marginLeft: (depth + 1) * 20 }}>
            <input
              autoFocus
              value={addingName}
              onChange={(e) => setAddingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddChild(node); if (e.key === 'Escape') setAddingParentId(null); }}
              placeholder="Nom de la sous-catégorie"
              className="flex-grow border rounded px-2 py-1 text-sm"
            />
            <button onClick={() => handleAddChild(node)} className="text-green-600 p-1" title="Créer"><Icon name="check" /></button>
            <button onClick={() => setAddingParentId(null)} className="text-gray-400 p-1" title="Annuler"><Icon name="close" /></button>
          </div>
        )}

        {kids.map(child => renderNode(child, depth + 1, rootKey))}
      </div>
    );
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Chargement des catégories...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Création d'une catégorie racine */}
      <div className="bg-white p-5 rounded-lg shadow-md">
        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Icon name="add" /> Nouvelle catégorie
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={newRootName}
            onChange={(e) => setNewRootName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateRoot(); }}
            placeholder="Nom (ex. Eau)"
            className="flex-grow border rounded-lg px-4 py-2"
          />
          <select
            value={newRootCategory}
            onChange={(e) => setNewRootCategory(e.target.value)}
            className="border rounded-lg px-4 py-2"
          >
            {ROOTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <button
            onClick={handleCreateRoot}
            className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-5 py-2 rounded-lg flex items-center gap-2 justify-center"
          >
            <Icon name="add" /> Créer
          </button>
        </div>
      </div>

      {/* Arbre par section fixe */}
      {ROOTS.map(root => {
        const roots = rootsOf(root.key);
        return (
          <div key={root.key} className="bg-white p-5 rounded-lg shadow-md">
            <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
              <Icon name="category" /> {root.label}
            </h3>
            {roots.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucune catégorie pour cette section.</p>
            ) : (
              <div>{roots.map(node => renderNode(node, 0, root.key))}</div>
            )}
          </div>
        );
      })}

      <ConfirmModal
        isOpen={confirm.open}
        title={confirm.title}
        message={confirm.message}
        variant={confirm.variant}
        onConfirm={confirm.onConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
};

export default ProductCategoryManager;
