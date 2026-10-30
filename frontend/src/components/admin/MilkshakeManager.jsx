// src/components/admin/MilkshakeManager.jsx
// Onglet "Milkshake" de l'Espace Gérant. Autonome : fetch + socket + états.
// Un milkshake porte ses propres catégories + ingrédients imbriqués (modèle "plat chaud") :
// tout se crée dans la modale du milkshake, pas de catalogue commun.

import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  fetchMilkshakes, createMilkshake, updateMilkshake, deleteMilkshake, toggleMilkshakeAvailability,
  uploadMilkshakeImage, fetchProductCategories,
} from '../../services/api';
import { getImageUrl } from '../../utils/imageUtils';
import { useToast } from '../../context/ToastContext';
import ConfirmModal from '../modals/ConfirmModal';
import Icon from '../Icon';
import { socket } from '../../socket';
import { useListControls } from '../../hooks/useListControls';
import { ListToolbar, Pagination, ViewToggle } from './ListControls';

// Catégories proposées en un clic à la création (gain de temps, modifiables ensuite).
const SUGGESTED_CATEGORIES = ['Glaces', 'Lait', 'Topping'];

const extract = (res) =>
  Array.isArray(res.data) ? res.data
  : Array.isArray(res.data?.data) ? res.data.data
  : Array.isArray(res.data?.message) ? res.data.message : [];

const upsert = (list, item) => {
  const id = item._id || item.id;
  return list.some(x => (x._id || x.id) === id)
    ? list.map(x => (x._id || x.id) === id ? { ...x, ...item } : x)
    : [...list, item];
};
const removeById = (list, e) => {
  const id = e._id || e.id;
  return list.filter(x => (x._id || x.id) !== id);
};

const emptyIngredient = () => ({ name: '', enabled: true, isSupplement: false, supplementPrice: 0 });
const emptyCategory = (name = '') => ({ name, enabled: true, ingredients: [] });

// Petit interrupteur on/off réutilisé (même style que l'onglet Plats chauds).
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

// Ligne d'ingrédient réordonnable (drag & drop dans une catégorie)
const SortableIngredient = ({ id, ing, ci, ii, onUpdate, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined };
  return (
    <div ref={setNodeRef} style={style} className={`flex flex-wrap items-center gap-2 bg-white ${ing.enabled ? '' : 'opacity-60'}`}>
      <button type="button" className="cursor-grab active:cursor-grabbing touch-none text-stone-400 hover:text-stone-600" aria-label="Réordonner l'ingrédient" {...attributes} {...listeners}><Icon name="drag" /></button>
      <input value={ing.name} onChange={(e) => onUpdate(ci, ii, { name: e.target.value })}
        placeholder="Nom de l'ingrédient"
        className="flex-1 min-w-[8rem] border rounded-lg px-3 py-1.5 text-sm" />
      <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer whitespace-nowrap">
        <input type="checkbox" checked={ing.isSupplement} onChange={(e) => onUpdate(ci, ii, { isSupplement: e.target.checked })} className="w-4 h-4" />
        Supplément
      </label>
      {ing.isSupplement && (
        <input type="number" step="0.10" min="0" value={ing.supplementPrice}
          onChange={(e) => onUpdate(ci, ii, { supplementPrice: e.target.value })}
          placeholder="€" className="w-20 border rounded-lg px-2 py-1.5 text-sm" />
      )}
      <Toggle on={ing.enabled} onClick={() => onUpdate(ci, ii, { enabled: !ing.enabled })} title={ing.enabled ? 'Désactiver' : 'Activer'} />
      <button type="button" onClick={() => onRemove(ci, ii)} className="text-cherry hover:text-cherry/70"><Icon name="trash" /></button>
    </div>
  );
};

// Bloc catégorie réordonnable, contenant ses ingrédients eux-mêmes réordonnables
const SortableCategory = ({ id, cat, ci, sensors, onCategoryUpdate, onCategoryRemove, onIngredientAdd, onIngredientUpdate, onIngredientRemove, onIngredientDragEnd }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined };
  return (
    <div ref={setNodeRef} style={style} className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* En-tête catégorie */}
      <div className="flex items-center gap-2 bg-gray-50 border-b border-gray-200 px-3 py-2">
        <button type="button" className="cursor-grab active:cursor-grabbing touch-none text-stone-400 hover:text-stone-600" aria-label="Réordonner la catégorie" {...attributes} {...listeners}><Icon name="drag" /></button>
        <input value={cat.name} onChange={(e) => onCategoryUpdate(ci, { name: e.target.value })}
          placeholder="Nom de la catégorie (ex: Billes)"
          className="flex-1 min-w-0 bg-transparent text-sm font-bold text-stone-700 focus:outline-none focus:bg-white rounded px-2 py-1" />
        <Toggle on={cat.enabled} onClick={() => onCategoryUpdate(ci, { enabled: !cat.enabled })} title={cat.enabled ? 'Désactiver' : 'Activer'} />
        <button type="button" onClick={() => onCategoryRemove(ci)} className="text-cherry hover:text-cherry/70" title="Supprimer la catégorie"><Icon name="trash" /></button>
      </div>

      {/* Ingrédients */}
      <div className="p-3 space-y-2">
        {cat.ingredients.length === 0 && <p className="text-xs text-stone-400 italic">Aucun ingrédient.</p>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => onIngredientDragEnd(ci, e)}>
          <SortableContext items={cat.ingredients.map((_, ii) => `ing-${ci}-${ii}`)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {cat.ingredients.map((ing, ii) => (
                <SortableIngredient key={`ing-${ci}-${ii}`} id={`ing-${ci}-${ii}`} ing={ing} ci={ci} ii={ii} onUpdate={onIngredientUpdate} onRemove={onIngredientRemove} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <button type="button" onClick={() => onIngredientAdd(ci)} className="text-brand-700 hover:text-brand-900 text-sm inline-flex items-center gap-1 mt-1">
          <Icon name="add" /> Ajouter un ingrédient
        </button>
      </div>
    </div>
  );
};

const MilkshakeManager = () => {
  const { toast } = useToast();

  const [milkshakes, setMilkshakes] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('table');
  const controls = useListControls(milkshakes, { pageSize: 24 });

  // Confirmation générique
  const [confirm, setConfirm] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });
  const closeConfirm = () => setConfirm(c => ({ ...c, open: false, onConfirm: null }));
  const askConfirm = (title, message, onConfirm, variant = 'danger') =>
    setConfirm({ open: true, title, message, onConfirm, variant });

  // --- Chargement initial ---
  useEffect(() => {
    (async () => {
      try {
        const [shakes, cats] = await Promise.all([fetchMilkshakes(), fetchProductCategories()]);
        setMilkshakes(extract(shakes));
        setProductCategories(extract(cats));
      } catch (err) {
        console.error(err);
        toast.error('Impossible de charger les milkshakes.');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  // --- Temps réel ---
  useEffect(() => {
    const onTea = (t) => setMilkshakes(prev => upsert(prev, t));
    const onTeaDel = (e) => setMilkshakes(prev => removeById(prev, e));
    socket.on('milkshake_created', onTea);
    socket.on('milkshake_updated', onTea);
    socket.on('milkshake_deleted', onTeaDel);
    return () => {
      socket.off('milkshake_created', onTea);
      socket.off('milkshake_updated', onTea);
      socket.off('milkshake_deleted', onTeaDel);
    };
  }, []);

  // =========================================================================
  // MODALE MILKSHAKE (formulaire imbriqué)
  // =========================================================================
  const emptyTea = { name: '', description: '', price: 0, image: '', categories: [], categoryId: '', isAvailable: true };

  // Catégories de classement (arbre productCategories) aplaties avec profondeur, pour le sélecteur TVA.
  const flatCategories = (() => {
    const out = [];
    const walk = (parentId, depth) => {
      productCategories
        .filter(c => (c.parentId || null) === parentId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .forEach(c => { out.push({ id: c._id || c.id, name: c.name, depth }); walk(c._id || c.id, depth + 1); });
    };
    walk(null, 0);
    return out;
  })();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyTea);
  const [uploading, setUploading] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyTea);
    setModalOpen(true);
  };
  const openEdit = (tea) => {
    setEditing(tea);
    setForm({
      name: tea.name, description: tea.description || '', price: tea.price || 0, image: tea.image || '',
      categories: (tea.categories || []).map(c => ({
        name: c.name, enabled: c.enabled !== false,
        ingredients: (c.ingredients || []).map(i => ({
          name: i.name, enabled: i.enabled !== false, isSupplement: !!i.isSupplement, supplementPrice: i.supplementPrice || 0,
        })),
      })),
      categoryId: tea.categoryId || '',
      isAvailable: tea.isAvailable !== false,
    });
    setModalOpen(true);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await uploadMilkshakeImage(fd);
      const url = res.data?.imageUrl || res.data?.data?.imageUrl;
      setForm(f => ({ ...f, image: url }));
    } catch {
      toast.error("Erreur lors de l'upload de l'image.");
    } finally {
      setUploading(false);
    }
  };

  // --- Helpers d'édition des catégories/ingrédients imbriqués ---
  const updateCategory = (ci, patch) =>
    setForm(f => ({ ...f, categories: f.categories.map((c, i) => i === ci ? { ...c, ...patch } : c) }));
  const updateIngredient = (ci, ii, patch) =>
    setForm(f => ({
      ...f,
      categories: f.categories.map((c, i) =>
        i === ci ? { ...c, ingredients: c.ingredients.map((ing, j) => j === ii ? { ...ing, ...patch } : ing) } : c
      ),
    }));
  const addCategory = (name = '') =>
    setForm(f => ({ ...f, categories: [...f.categories, emptyCategory(name)] }));
  const removeCategory = (ci) =>
    setForm(f => ({ ...f, categories: f.categories.filter((_, i) => i !== ci) }));
  const addIngredient = (ci) =>
    setForm(f => ({
      ...f,
      categories: f.categories.map((c, i) => i === ci ? { ...c, ingredients: [...c.ingredients, emptyIngredient()] } : c),
    }));
  const removeIngredient = (ci, ii) =>
    setForm(f => ({
      ...f,
      categories: f.categories.map((c, i) => i === ci ? { ...c, ingredients: c.ingredients.filter((_, j) => j !== ii) } : c),
    }));

  // --- Drag & drop : ordre des catégories et des ingrédients ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleCategoryDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(String(active.id).replace('cat-', ''));
    const to = Number(String(over.id).replace('cat-', ''));
    setForm(f => ({ ...f, categories: arrayMove(f.categories, from, to) }));
  };
  const handleIngredientDragEnd = (ci, event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(String(active.id).split('-')[2]);
    const to = Number(String(over.id).split('-')[2]);
    setForm(f => ({
      ...f,
      categories: f.categories.map((c, i) => i === ci ? { ...c, ingredients: arrayMove(c.ingredients, from, to) } : c),
    }));
  };

  const handleSave = async () => {
    if (form.name.trim().length < 2) return toast.warning('Nom trop court.');
    // Nettoyage : on ignore catégories/ingrédients sans nom.
    const categories = form.categories
      .filter(c => c.name.trim())
      .map(c => ({
        name: c.name.trim(),
        enabled: c.enabled,
        ingredients: c.ingredients
          .filter(i => i.name.trim())
          .map(i => ({
            name: i.name.trim(),
            enabled: i.enabled,
            isSupplement: i.isSupplement,
            supplementPrice: i.isSupplement ? Number(i.supplementPrice) || 0 : 0,
          })),
      }));
    const payload = {
      name: form.name.trim(),
      description: form.description,
      price: Number(form.price) || 0,
      image: form.image,
      categories,
      categoryId: form.categoryId || null,
      isAvailable: form.isAvailable,
    };
    try {
      const res = editing
        ? await updateMilkshake(editing._id, payload)
        : await createMilkshake(payload);
      setMilkshakes(prev => upsert(prev, res.data));
      setModalOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'enregistrement.');
    }
  };

  const handleToggleAvailability = async (tea) => {
    try {
      const res = await toggleMilkshakeAvailability(tea._id);
      setMilkshakes(prev => upsert(prev, res.data));
    } catch {
      toast.error('Erreur lors de la mise à jour.');
    }
  };

  const handleDelete = (tea) => {
    askConfirm('Supprimer le milkshake', `Supprimer « ${tea.name} » ?`, async () => {
      closeConfirm();
      try {
        await deleteMilkshake(tea._id);
        setMilkshakes(prev => removeById(prev, tea));
      } catch {
        toast.error('Erreur lors de la suppression.');
      }
    });
  };

  // =========================================================================
  // RENDU
  // =========================================================================
  if (loading) return <div className="p-10 text-center text-stone-500">Chargement des milkshakes…</div>;

  const countIngredients = (tea) => (tea.categories || []).reduce((s, c) => s + (c.ingredients || []).length, 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-wood">Milkshakes</h2>
        <button onClick={openCreate} className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2">
          <Icon name="add" className="w-5 h-5 inline" /> Nouveau milkshake
        </button>
      </div>

      <ListToolbar
        query={controls.query} setQuery={controls.setQuery}
        sortOrder={controls.sortOrder} setSortOrder={controls.setSortOrder}
        total={controls.total} placeholder="Rechercher un milkshake…"
        rightSlot={<ViewToggle view={view} setView={setView} />} />

      {view === 'table' ? (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photo</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nom</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prix</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Catégories</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ingrédients</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dispo</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {controls.pageItems.map(tea => (
                <tr key={tea._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {tea.image ? (
                      <img src={getImageUrl(tea.image)} alt={tea.name} className="w-12 h-12 rounded object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center text-gray-400"><Icon name="milkshake" /></div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-wood">{tea.name}</td>
                  <td className="px-4 py-3 text-sm text-wood">{(tea.price || 0).toFixed(2)} €</td>
                  <td className="px-4 py-3 text-xs text-stone-600">{(tea.categories || []).length} catégorie(s)</td>
                  <td className="px-4 py-3 text-xs text-stone-600">{countIngredients(tea)} ingrédient(s)</td>
                  <td className="px-4 py-3">
                    <Toggle on={tea.isAvailable !== false} onClick={() => handleToggleAvailability(tea)} title={tea.isAvailable !== false ? 'Désactiver' : 'Activer'} />
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <button onClick={() => openEdit(tea)} className="text-brand-700 hover:text-brand-900 mr-3"><Icon name="edit" className="w-4 h-4 inline mr-1" />Modifier</button>
                    <button onClick={() => handleDelete(tea)} className="text-cherry hover:text-cherry/70"><Icon name="trash" className="w-4 h-4 inline" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {milkshakes.length === 0 && (
            <div className="text-center py-12 text-stone-500">
              Aucun milkshake. Cliquez sur « Nouveau milkshake » pour commencer.
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {controls.pageItems.map(tea => (
            <div key={tea._id} className={`flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden ${tea.isAvailable !== false ? '' : 'opacity-60'}`}>
              <div className="h-40 bg-gray-50">
                {tea.image ? (
                  <img src={getImageUrl(tea.image)} alt={tea.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl"><Icon name="milkshake" /></div>
                )}
              </div>
              <div className="p-4 flex flex-col flex-grow">
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-wood">{tea.name}</h4>
                  <span className="font-mono font-bold text-wood">{(tea.price || 0).toFixed(2)} €</span>
                </div>
                <p className="text-xs text-stone-500 mb-3">
                  {(tea.categories || []).length} catégorie(s) • {countIngredients(tea)} ingrédient(s)
                </p>
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-100">
                  <Toggle on={tea.isAvailable !== false} onClick={() => handleToggleAvailability(tea)} title={tea.isAvailable !== false ? 'Désactiver' : 'Activer'} />
                  <div className="text-sm">
                    <button onClick={() => openEdit(tea)} className="text-brand-700 hover:text-brand-900 mr-3"><Icon name="edit" /></button>
                    <button onClick={() => handleDelete(tea)} className="text-cherry hover:text-cherry/70"><Icon name="trash" /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={controls.page} totalPages={controls.totalPages} setPage={controls.setPage} />

      {/* ===================== MODALE MILKSHAKE ===================== */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white p-6 border-b border-gray-200 flex justify-between items-center z-10">
              <h3 className="text-2xl font-bold text-gray-800">{editing ? 'Modifier le milkshake' : 'Nouveau milkshake'}</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-3xl leading-none">×</button>
            </div>

            <div className="p-6 space-y-5">
              {/* Infos générales */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Nom *</label>
                  <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Milkshake Vanille"
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Prix de base (€) *</label>
                  <input type="number" step="0.10" min="0" value={form.price}
                    onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Description</label>
                <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2} className="w-full border rounded-lg px-4 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Catégorie de classement (TVA)</label>
                <select value={form.categoryId} onChange={(e) => setForm(f => ({ ...f, categoryId: e.target.value }))}
                  className="w-full border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent">
                  <option value="">Non classé (taux par défaut du mode)</option>
                  {flatCategories.map(c => (
                    <option key={c.id} value={c.id}>{`${'  '.repeat(c.depth)}${c.name}`}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Détermine le taux de TVA (sur place / à emporter) appliqué à ce milkshake.</p>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Image</label>
                {form.image && <img src={getImageUrl(form.image)} alt="Aperçu" className="w-28 h-28 object-cover rounded-lg border mb-3" />}
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-semibold transition text-sm">
                    {uploading ? 'Upload…' : 'Choisir une image'}
                    <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} className="hidden" />
                  </label>
                  <input type="text" placeholder="ou URL d'image" value={form.image}
                    onChange={(e) => setForm(f => ({ ...f, image: e.target.value }))}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {/* Catégories & ingrédients imbriqués */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold text-gray-700">Catégories & ingrédients</label>
                  {form.categories.length === 0 && (
                    <button type="button" onClick={() => SUGGESTED_CATEGORIES.forEach(addCategory)}
                      className="text-brand-700 hover:text-brand-900 text-sm inline-flex items-center gap-1">
                      <Icon name="add" /> Ajouter Glaces/Lait/Topping
                    </button>
                  )}
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
                  <SortableContext items={form.categories.map((_, ci) => `cat-${ci}`)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3">
                      {form.categories.map((cat, ci) => (
                        <SortableCategory
                          key={`cat-${ci}`}
                          id={`cat-${ci}`}
                          cat={cat}
                          ci={ci}
                          sensors={sensors}
                          onCategoryUpdate={updateCategory}
                          onCategoryRemove={removeCategory}
                          onIngredientAdd={addIngredient}
                          onIngredientUpdate={updateIngredient}
                          onIngredientRemove={removeIngredient}
                          onIngredientDragEnd={handleIngredientDragEnd}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <button type="button" onClick={() => addCategory()} className="mt-3 inline-flex items-center gap-2 px-3 py-2 border border-dashed border-brand-300 text-brand-700 rounded-lg text-sm font-semibold hover:bg-brand-50">
                  <Icon name="add" /> Ajouter une catégorie
                </button>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm(f => ({ ...f, isAvailable: e.target.checked }))} className="w-4 h-4" />
                <span className="text-sm font-medium text-gray-700">Disponible à la vente</span>
              </label>
            </div>

            <div className="px-6 pb-6 flex justify-end gap-3">
              <button onClick={() => setModalOpen(false)} className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg font-bold hover:bg-gray-200">Annuler</button>
              <button onClick={handleSave} className="px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

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

export default MilkshakeManager;
