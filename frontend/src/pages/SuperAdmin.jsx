// src/pages/SuperAdmin.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../context/ToastContext';
import { socket } from '../socket';
import {
  fetchProducts,
  updateProduct,
  fetchMenus,
  updateMenu,
  fetchDishes,
  updateDish,
  fetchFormulas,
  updateFormula,
  fetchAdminStats,
  fetchTaxConfig,
  updateTaxConfig,
  fetchProductCategories,
  updateProductCategory
} from '../services/api';
import { resolveProductRate } from '../utils/tax';
import RealtimeAnalytics from '../components/RealtimeAnalytics';
import LiveActivityFeed from '../components/LiveActivityFeed';
import AccountingDashboard from '../components/AccountingDashboard';
import AccountsManager from '../components/admin/AccountsManager';
import OpeningHoursManager from '../components/admin/OpeningHoursManager';
import OnlineSoundToggle from '../components/OnlineSoundToggle';
import useOnlineOrderAlert from '../hooks/useOnlineOrderAlert';

const SuperAdmin = () => {
  const { toast } = useToast();

  // États pour la navigation entre les onglets
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' ou 'pricing'
  
  // États pour la Business Intelligence
  const [stats, setStats] = useState(null);
  
  // États pour la Gestion de l'Offre (Prix)
  const [products, setProducts] = useState([]);
  const [menus, setMenus] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [formulas, setFormulas] = useState([]);
  const [editingPrice, setEditingPrice] = useState({});
  const [taxEdit, setTaxEdit] = useState({}); // override TVA par produit (clé = product._id)
  const [taxForm, setTaxForm] = useState({ dineIn: '', takeaway: '', defaultMode: 'dineIn', serviceRate: '' });
  const [productCategories, setProductCategories] = useState([]);
  const [catTaxEdit, setCatTaxEdit] = useState({}); // édition du taux TVA par catégorie (clé = _id)

  const [loading, setLoading] = useState(true);

  // Alerte sonore des commandes en ligne : sonne ici aussi, et porte l'interrupteur global.
  const onlineAlert = useOnlineOrderAlert();

  // Chargement initial des données
  const loadStrategicData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsData, productsData, menusData, dishesData, formulasData, taxData, catData] = await Promise.all([
        fetchAdminStats(),
        fetchProducts(),
        fetchMenus(),
        fetchDishes(),
        fetchFormulas(),
        fetchTaxConfig(),
        fetchProductCategories()
      ]);

      setStats(statsData.data?.data || statsData.data || null);
      setProducts(productsData.data?.data || []);
      setMenus(menusData.data?.data || []);
      setDishes(Array.isArray(dishesData.data) ? dishesData.data : dishesData.data?.data || []);
      setFormulas(formulasData.data?.data || formulasData.data?.formulas || []);
      setProductCategories(Array.isArray(catData.data) ? catData.data : catData.data?.data || []);

      const tax = taxData.data || {};
      setTaxForm({
        dineIn:      tax.rates?.dineIn ?? '',
        takeaway:    tax.rates?.takeaway ?? '',
        defaultMode: tax.defaultMode || 'dineIn',
        serviceRate: tax.serviceRate ?? '',
      });

    } catch (error) {
      console.error("Erreur chargement SuperAdmin", error);
      toast.error("Impossible de charger le Cockpit Gérant.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Rejoindre superadmin-room dès le montage pour recevoir les activités
  // même quand l'onglet "live" n'est pas encore ouvert
  useEffect(() => {
    socket.emit('join_superadmin');
    const onReconnect = () => socket.emit('join_superadmin');
    socket.on('connect', onReconnect);
    return () => socket.off('connect', onReconnect);
  }, []);

  useEffect(() => {
    loadStrategicData();
  }, [loadStrategicData]);

  useEffect(() => {
    const events = [
      'product_created', 'product_updated', 'product_deleted',
      'menu_created', 'menu_updated', 'menu_deleted',
      'formula_created', 'formula_updated', 'formula_deleted',
      'dish_created', 'dish_updated', 'dish_deleted',
    ];
    events.forEach(e => socket.on(e, loadStrategicData));
    return () => events.forEach(e => socket.off(e, loadStrategicData));
  }, [loadStrategicData]);


  // --- LOGIQUE PRIX (Réservé au Super Admin) ---

  const handlePriceChange = (id, value) => {
    setEditingPrice(prev => ({ ...prev, [id]: value }));
  };

  const saveProductPrice = async (product) => {
    const newPrice = editingPrice[product._id];
    if (!newPrice) return;

    try {
      await updateProduct(product._id, { price: parseFloat(newPrice) });
      toast.success(`Prix de ${product.name} mis à jour !`);
      loadStrategicData(); // Recharger pour confirmer
      setEditingPrice(prev => ({ ...prev, [product._id]: '' }));
    } catch (error) {
      console.error(error);
      toast.error("Erreur sauvegarde produit.");
    }
  };

  // Valeur d'un input TVA par mode : édition en cours, sinon valeur persistée (champ du mode, fallback legacy taxRate).
  const modeTaxVal = (editState, obj, mode) => {
    const edited = editState[obj._id];
    if (edited && edited[mode] !== undefined) return edited[mode];
    const field = mode === 'takeaway' ? 'taxRateTakeaway' : 'taxRateDineIn';
    const v = obj[field];
    if (v !== undefined && v !== null) return v;
    return obj.taxRate ?? '';
  };
  const setModeTax = (setState, obj, mode, value) =>
    setState(prev => ({ ...prev, [obj._id]: { ...prev[obj._id], [mode]: value } }));

  // Override TVA d'un produit, par mode : valeur vide → retour au taux par défaut (null).
  const saveProductTax = async (product) => {
    const payload = {};
    for (const [mode, field] of [['dineIn', 'taxRateDineIn'], ['takeaway', 'taxRateTakeaway']]) {
      const raw = modeTaxVal(taxEdit, product, mode);
      const v = (raw === '' || raw === null) ? null : parseFloat(raw);
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) {
        toast.error('Taux de TVA invalide (0 à 100).');
        return;
      }
      payload[field] = v;
    }
    try {
      await updateProduct(product._id, payload);
      toast.success(`TVA de ${product.name} mise à jour.`);
      loadStrategicData();
      setTaxEdit(prev => { const next = { ...prev }; delete next[product._id]; return next; });
    } catch (error) {
      console.error(error);
      toast.error('Erreur sauvegarde TVA produit.');
    }
  };

  const saveTaxConfig = async () => {
    const dineIn = parseFloat(taxForm.dineIn);
    const takeaway = parseFloat(taxForm.takeaway);
    if ([dineIn, takeaway].some(v => !Number.isFinite(v) || v < 0 || v > 100)) {
      toast.error('Les taux doivent être compris entre 0 et 100.');
      return;
    }
    const serviceRate = taxForm.serviceRate === '' ? 0 : parseFloat(taxForm.serviceRate);
    if (!Number.isFinite(serviceRate) || serviceRate < 0 || serviceRate > 100) {
      toast.error('Le taux de service doit être compris entre 0 et 100.');
      return;
    }
    try {
      await updateTaxConfig({ rates: { dineIn, takeaway }, defaultMode: taxForm.defaultMode, serviceRate });
      toast.success('Configuration TVA enregistrée.');
      loadStrategicData();
    } catch (error) {
      console.error(error);
      toast.error('Erreur sauvegarde configuration TVA.');
    }
  };

  const saveCategoryTax = async (cat) => {
    const payload = {};
    for (const [mode, field] of [['dineIn', 'taxRateDineIn'], ['takeaway', 'taxRateTakeaway']]) {
      const raw = modeTaxVal(catTaxEdit, cat, mode);
      const v = (raw === '' || raw === null) ? null : parseFloat(raw);
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) {
        toast.error('Taux de TVA invalide (0 à 100, ou vide pour hériter).');
        return;
      }
      payload[field] = v;
    }
    try {
      await updateProductCategory(cat._id, payload);
      toast.success(`TVA de « ${cat.name} » mise à jour.`);
      loadStrategicData();
      setCatTaxEdit(prev => { const next = { ...prev }; delete next[cat._id]; return next; });
    } catch (error) {
      console.error(error);
      toast.error('Erreur sauvegarde TVA catégorie.');
    }
  };

  // Une colonne de l'éditeur TVA par catégorie pour un mode (sur place / à emporter).
  const renderCatTaxColumn = (mode) => (
    <div className="space-y-1">
      {flattenCategories().map(({ cat, depth }) => {
        const field = mode === 'takeaway' ? 'taxRateTakeaway' : 'taxRateDineIn';
        const inherited = cat[field] == null && cat.taxRate == null;
        return (
          <div key={cat._id} className="flex items-center gap-3 py-1.5" style={{ marginLeft: depth * 16 }}>
            <span className={`flex-grow text-sm ${cat.isAvailable === false ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
              {cat.name}
              {inherited && <span className="ml-2 text-xs text-gray-400">(hérité)</span>}
            </span>
            <input
              type="number" step="0.1" min="0" max="100" placeholder="Hérité"
              className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none shrink-0"
              value={modeTaxVal(catTaxEdit, cat, mode)}
              onChange={(e) => setModeTax(setCatTaxEdit, cat, mode, e.target.value)}
            />
            <span className="text-xs text-gray-400">%</span>
            <button
              onClick={() => saveCategoryTax(cat)}
              className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 font-bold text-sm transition-transform active:scale-95"
            >
              OK
            </button>
          </div>
        );
      })}
    </div>
  );

  const saveMenuPrice = async (menu) => {
    const newPrice = editingPrice[menu._id];
    if (!newPrice) return;
    try {
      await updateMenu(menu._id, { price_addition: parseFloat(newPrice) });
      toast.success(`Prix du menu ${menu.name} mis à jour !`);
      loadStrategicData();
      setEditingPrice(prev => ({ ...prev, [menu._id]: '' }));
    } catch (error) {
      console.error(error);
      toast.error("Erreur sauvegarde menu.");
    }
  };

  const saveDishPrice = async (dish) => {
    const newPrice = editingPrice[dish._id];
    if (!newPrice) return;
    try {
      await updateDish(dish._id, { price: parseFloat(newPrice) });
      toast.success(`Prix de ${dish.name} mis à jour !`);
      loadStrategicData();
      setEditingPrice(prev => ({ ...prev, [dish._id]: '' }));
    } catch (error) {
      console.error(error);
      toast.error("Erreur sauvegarde plat.");
    }
  };

  const saveFormulaBasePrice = async (formula) => {
    const newPrice = editingPrice[`${formula._id}_base`];
    if (!newPrice) return;
    try {
      await updateFormula(formula._id, { base_price: parseFloat(newPrice) });
      toast.success(`Prix de base de ${formula.name} mis à jour !`);
      loadStrategicData();
      setEditingPrice(prev => ({ ...prev, [`${formula._id}_base`]: '' }));
    } catch (error) {
      console.error(error);
      toast.error("Erreur sauvegarde formule.");
    }
  };

  const saveFormulaExtraCost = async (formula) => {
    const newCost = editingPrice[`${formula._id}_extra`];
    if (!newCost) return;
    try {
      await updateFormula(formula._id, { extra_cost_per_component: parseFloat(newCost) });
      toast.success(`Coût supplément de ${formula.name} mis à jour !`);
      loadStrategicData();
      setEditingPrice(prev => ({ ...prev, [`${formula._id}_extra`]: '' }));
    } catch (error) {
      console.error(error);
      toast.error("Erreur sauvegarde formule.");
    }
  };

  // --- COMPOSANT GRAPHIQUE SVG (Interne) ---
  const SimpleBarChart = ({ data }) => {
    if (!data || data.length === 0) return <div className="h-40 flex items-center justify-center text-gray-400">Pas de données</div>;
    
    const maxVal = Math.max(...data.map(d => d.dailyRevenue));
    const height = 150;
    const barWidth = 40;
    const gap = 20;

    return (
        <div className="overflow-x-auto">
            <svg height={height + 30} width={data.length * (barWidth + gap)} className="mt-4">
                {data.map((d, i) => {
                    const barHeight = (d.dailyRevenue / maxVal) * height;
                    return (
                        <g key={d._id} transform={`translate(${i * (barWidth + gap)}, 0)`}>
                            <rect 
                                y={height - barHeight} 
                                width={barWidth} 
                                height={barHeight} 
                                fill="#7c3aed" 
                                rx="4"
                                className="hover:fill-purple-500 transition-all"
                            />
                            <text x={barWidth / 2} y={height - barHeight - 5} textAnchor="middle" fontSize="10" fill="#374151" fontWeight="bold">
                                {d.dailyRevenue}€
                            </text>
                            <text x={barWidth / 2} y={height + 15} textAnchor="middle" fontSize="10" fill="#6b7280">
                                {new Date(d._id).toLocaleDateString('fr-FR', { weekday: 'short' })}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
  };

  if (loading) return <div className="p-10 text-center text-xl font-bold text-gray-500 animate-pulse">Chargement du Cockpit Gérant...</div>;

  const categoriesById = Object.fromEntries(productCategories.map(c => [c._id || c.id, c]));

  // Arbre des catégories aplati avec profondeur (pour l'affichage indenté de la TVA par catégorie).
  const flattenCategories = (parentId = null, depth = 0) =>
    productCategories
      .filter(c => (c.parentId || null) === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name || '').localeCompare(String(b.name || '')))
      .flatMap(c => [{ cat: c, depth }, ...flattenCategories(c._id || c.id, depth + 1)]);

  return (
    <div className="container mx-auto p-3 sm:p-6 bg-gray-50 min-h-screen">

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-gray-900">
                Espace <span className="text-purple-600">Super Admin</span>
            </h1>
            <p className="text-gray-500 mt-1 text-sm sm:text-base">Pilotage financier et stratégique</p>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <OnlineSoundToggle alert={onlineAlert} />
            <button onClick={loadStrategicData} className="text-sm bg-white border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-100 shadow-sm font-medium flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="hidden sm:inline">Actualiser les données</span>
              <span className="sm:hidden">Actualiser</span>
            </button>
          </div>
      </div>

      {/* Navigation par onglets */}
      <div className="mb-6 bg-white rounded-2xl shadow-md p-2 border border-gray-100">
        <div className="grid grid-cols-2 sm:flex gap-2">
          <button
            onClick={() => setActiveTab('live')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'live'
                ? 'bg-red-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>Activité Live</span>
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'analytics'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="hidden sm:inline">Analytics Temps Réel</span>
            <span className="sm:hidden">Analytics</span>
          </button>
          <button
            onClick={() => setActiveTab('business')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'business'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span className="hidden sm:inline">Business Intelligence</span>
            <span className="sm:hidden">Business</span>
          </button>
          <button
            onClick={() => setActiveTab('pricing')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'pricing'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="hidden sm:inline">Gestion des Prix</span>
            <span className="sm:hidden">Prix</span>
          </button>
          <button
            onClick={() => setActiveTab('accounting')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'accounting'
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden sm:inline">Comptabilité</span>
            <span className="sm:hidden">Compta</span>
          </button>
          <button
            onClick={() => setActiveTab('tax')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'tax'
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
            <span>TVA</span>
          </button>
          <button
            onClick={() => setActiveTab('hours')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'hours'
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Horaires</span>
          </button>
          <button
            onClick={() => setActiveTab('comptes')}
            className={`flex-1 py-2 sm:py-3 px-2 sm:px-6 rounded-xl font-bold transition-all flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm ${
              activeTab === 'comptes'
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-3-6.65" />
            </svg>
            <span className="hidden sm:inline">Comptes &amp; points</span>
            <span className="sm:hidden">Comptes</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          ONGLET LIVE: ACTIVITÉ EN DIRECT
         ========================================================================= */}
      {activeTab === 'live' && (
        <LiveActivityFeed />
      )}

      {/* =========================================================================
          ONGLET 1: ANALYTICS TEMPS RÉEL
         ========================================================================= */}
      {activeTab === 'analytics' && (
        <RealtimeAnalytics />
      )}

      {/* =========================================================================
          ONGLET 2: BUSINESS INTELLIGENCE (KPIs & ANALYTICS)
         ========================================================================= */}
      {activeTab === 'business' && stats && (
        <div className="mb-12 animate-[fadeIn_0.5s_ease-out]">
            {/* KPIs Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-gradient-to-br from-purple-600 to-indigo-700 p-6 rounded-2xl shadow-lg text-white">
                    <p className="text-purple-200 text-sm font-bold uppercase tracking-wider">Chiffre d'Affaires</p>
                    <p className="text-4xl font-extrabold mt-2">{stats.kpi.revenue.toFixed(2)} €</p>
                    <span className="text-xs bg-white/20 px-2 py-1 rounded-full mt-3 inline-block">Global</span>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
                    <p className="text-gray-500 text-sm font-bold uppercase tracking-wider">Total Commandes</p>
                    <p className="text-4xl font-extrabold text-gray-900 mt-2">{stats.kpi.orders}</p>
                    <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full mt-3 inline-block">Validées</span>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
                    <p className="text-gray-500 text-sm font-bold uppercase tracking-wider">Panier Moyen</p>
                    <p className="text-4xl font-extrabold text-gray-900 mt-2">{stats.kpi.avgBasket.toFixed(2)} €</p>
                    <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full mt-3 inline-block">Performance</span>
                </div>
            </div>

            {/* Graphique & Tops */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Graphique Ventes */}
                <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-md border border-gray-100">
                    <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        Évolution du CA (7 jours)
                    </h2>
                    <SimpleBarChart data={stats.chart} />
                </div>

                {/* Top/Flop Ingrédients */}
                <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 flex flex-col gap-6">
                    <div>
                        <h2 className="text-lg font-bold text-green-700 mb-3 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                            Top 5 Ingrédients
                        </h2>
                        <ul className="space-y-3">
                            {stats.topIngredients.map((ing, i) => (
                                <li key={ing._id} className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                                    <span className="font-medium flex items-center gap-2">
                                        <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">{i+1}</span>
                                        {ing._id}
                                    </span>
                                    <span className="font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{ing.count}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-red-700 mb-3 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                            </svg>
                            Flop 5 Ingrédients
                        </h2>
                         <ul className="space-y-3">
                            {stats.flopIngredients.map((ing) => (
                                <li key={ing._id} className="flex justify-between items-center text-sm border-b border-gray-50 pb-2">
                                    <span className="font-medium text-gray-500">{ing._id}</span>
                                    <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded">{ing.count} vente(s)</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* =========================================================================
          ONGLET 3: GESTION STRATÉGIQUE (PRIX & OFFRE)
         ========================================================================= */}
      {activeTab === 'pricing' && (
      <div className="bg-white p-4 sm:p-8 rounded-3xl shadow-lg border border-gray-100">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Configuration des Prix
        </h2>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">

            {/* Formules salades */}
            <div>
                <h3 className="text-xl font-bold mb-4 text-emerald-700 border-b pb-2">Formules Salades</h3>
                <div className="space-y-4">
                {formulas.map(formula => (
                    <div key={formula._id} className="bg-gray-50 p-4 rounded-xl hover:bg-gray-100 transition-colors">
                        <p className="font-bold text-gray-800 mb-3">{formula.name}</p>
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm text-gray-500 flex-1">
                                    Prix de base : <span className="font-mono font-bold text-gray-800">{(formula.base_price || 0).toFixed(2)}€</span>
                                </span>
                                <div className="flex gap-2">
                                    <input type="number" step="0.10" placeholder="Nouveau"
                                        className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                        value={editingPrice[`${formula._id}_base`] || ''}
                                        onChange={(e) => handlePriceChange(`${formula._id}_base`, e.target.value)}
                                    />
                                    <button onClick={() => saveFormulaBasePrice(formula)}
                                        className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 font-bold text-sm transition-transform active:scale-95">
                                        OK
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm text-gray-500 flex-1">
                                    Coût supplément : <span className="font-mono font-bold text-gray-800">{(formula.extra_cost_per_component || 0).toFixed(2)}€</span>
                                </span>
                                <div className="flex gap-2">
                                    <input type="number" step="0.10" placeholder="Nouveau"
                                        className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                        value={editingPrice[`${formula._id}_extra`] || ''}
                                        onChange={(e) => handlePriceChange(`${formula._id}_extra`, e.target.value)}
                                    />
                                    <button onClick={() => saveFormulaExtraCost(formula)}
                                        className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 font-bold text-sm transition-transform active:scale-95">
                                        OK
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
                </div>
            </div>

            {/* Suppléments Menus */}
            <div>
                <h3 className="text-xl font-bold mb-4 text-purple-700 border-b pb-2">Suppléments Menus</h3>
                <div className="space-y-4">
                {menus.map(menu => (
                    <div key={menu._id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-gray-50 p-4 rounded-xl hover:bg-gray-100 transition-colors">
                        <div>
                            <p className="font-bold text-lg">{menu.name}</p>
                            <p className="text-sm text-gray-500">Actuel : <span className="font-mono font-bold text-gray-800">+{(menu.price_addition || 0).toFixed(2)}€</span></p>
                        </div>
                        <div className="flex gap-2">
                            <input type="number" step="0.10" placeholder="Nouveau"
                                className="w-24 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
                                value={editingPrice[menu._id] || ''}
                                onChange={(e) => handlePriceChange(menu._id, e.target.value)}
                            />
                            <button onClick={() => saveMenuPrice(menu)}
                                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 font-bold transition-transform active:scale-95">
                                OK
                            </button>
                        </div>
                    </div>
                ))}
                </div>
            </div>

            {/* Plats Chauds */}
            <div>
                <h3 className="text-xl font-bold mb-4 text-red-600 border-b pb-2">Plats Chauds</h3>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {dishes.map(dish => (
                    <div key={dish._id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-gray-50 p-4 rounded-xl hover:bg-gray-100 transition-colors">
                        <div>
                            <p className="font-bold text-gray-800">{dish.name}</p>
                            <p className="text-sm text-gray-500">Actuel : <span className="font-mono font-bold text-gray-800">{(dish.price || 0).toFixed(2)}€</span></p>
                        </div>
                        <div className="flex gap-2">
                            <input type="number" step="0.10" placeholder="Nouveau"
                                className="w-24 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none"
                                value={editingPrice[dish._id] || ''}
                                onChange={(e) => handlePriceChange(dish._id, e.target.value)}
                            />
                            <button onClick={() => saveDishPrice(dish)}
                                className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 font-bold transition-transform active:scale-95">
                                OK
                            </button>
                        </div>
                    </div>
                ))}
                </div>
            </div>

            {/* Carte des Produits */}
            <div>
                <h3 className="text-xl font-bold mb-4 text-orange-600 border-b pb-2">Boissons & Desserts</h3>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {products.map(product => (
                    <div key={product._id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-gray-50 p-4 rounded-xl hover:bg-gray-100 transition-colors">
                        <div>
                            <p className="font-bold text-gray-800">{product.name}</p>
                            <p className="text-sm text-gray-500">Actuel : <span className="font-mono font-bold text-gray-800">{(product.price || 0).toFixed(2)}€</span></p>
                            <p className="text-xs text-gray-400">
                                TVA sur place : <span className="font-mono">{(() => {
                                  const r = resolveProductRate(product, categoriesById, 'dineIn');
                                  return r != null ? `${r} %` : 'taux par défaut';
                                })()}</span>
                                {' · '}à emporter : <span className="font-mono">{(() => {
                                  const r = resolveProductRate(product, categoriesById, 'takeaway');
                                  return r != null ? `${r} %` : 'taux par défaut';
                                })()}</span>
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2 items-center">
                                <span className="text-xs text-gray-400 w-9">Prix</span>
                                <input type="number" step="0.10" placeholder="Nouveau"
                                    className="w-24 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-orange-500 outline-none"
                                    value={editingPrice[product._id] || ''}
                                    onChange={(e) => handlePriceChange(product._id, e.target.value)}
                                />
                                <button onClick={() => saveProductPrice(product)}
                                    className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 font-bold transition-transform active:scale-95">
                                    OK
                                </button>
                            </div>
                            <div className="flex gap-2 items-center">
                                <span className="text-xs text-gray-400 w-16">Sur place</span>
                                <input type="number" step="0.1" min="0" max="100" placeholder="Défaut"
                                    className="w-20 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                                    value={modeTaxVal(taxEdit, product, 'dineIn')}
                                    onChange={(e) => setModeTax(setTaxEdit, product, 'dineIn', e.target.value)}
                                />
                                <span className="text-xs text-gray-400 w-16 text-right">À emporter</span>
                                <input type="number" step="0.1" min="0" max="100" placeholder="Défaut"
                                    className="w-20 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                                    value={modeTaxVal(taxEdit, product, 'takeaway')}
                                    onChange={(e) => setModeTax(setTaxEdit, product, 'takeaway', e.target.value)}
                                />
                                <button onClick={() => saveProductTax(product)}
                                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 font-bold transition-transform active:scale-95">
                                    OK
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                </div>
            </div>

        </div>
      </div>
      )}

      {activeTab === 'accounting' && (
        <AccountingDashboard />
      )}

      {/* =========================================================================
          ONGLET TVA : CONFIGURATION DES TAUX
         ========================================================================= */}
      {activeTab === 'tax' && (
        <div className="bg-white p-4 sm:p-8 rounded-3xl shadow-lg border border-gray-100 max-w-5xl">
          <h2 className="text-2xl font-bold mb-2">Configuration de la TVA</h2>
          <p className="text-sm text-gray-500 mb-8">
            Les prix du catalogue sont TTC (TVA incluse). Ces taux servent à décomposer la TVA sur les commandes.
            Un produit peut forcer son propre taux (onglet « Gestion des Prix » → Boissons &amp; Desserts).
          </p>

          <div className="space-y-6 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Taux sur place (%)</label>
                <input
                  type="number" step="0.1" min="0" max="100"
                  value={taxForm.dineIn}
                  onChange={(e) => setTaxForm(prev => ({ ...prev, dineIn: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Taux à emporter (%)</label>
                <input
                  type="number" step="0.1" min="0" max="100"
                  value={taxForm.takeaway}
                  onChange={(e) => setTaxForm(prev => ({ ...prev, takeaway: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Mode par défaut (commandes en ligne)</label>
              <select
                value={taxForm.defaultMode}
                onChange={(e) => setTaxForm(prev => ({ ...prev, defaultMode: e.target.value }))}
                className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="dineIn">Sur place</option>
                <option value="takeaway">À emporter</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Les commandes passées en ligne (sans choix explicite) utilisent ce mode pour le calcul de TVA.
              </p>
            </div>

            {/* Champ « Service compris (%) » désactivé : le ticket affiche « Service compris » sans pourcentage.
                Le taux reste stocké (serviceRate). Pour réafficher la saisie du taux, décommenter ce bloc.
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Service compris (%)</label>
              <input
                type="number" step="0.1" min="0" max="100"
                value={taxForm.serviceRate}
                onChange={(e) => setTaxForm(prev => ({ ...prev, serviceRate: e.target.value }))}
                className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
              <p className="text-xs text-gray-400 mt-1">
                Mention « Service compris (X %) » affichée sur le ticket. Vide ou 0 = masquée. N'augmente pas le prix.
              </p>
            </div>
            */}

            <button
              onClick={saveTaxConfig}
              className="bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition-transform active:scale-95"
            >
              Enregistrer
            </button>
          </div>

          {/* TVA par catégorie (héritage dans l'arbre) — deux taux distincts : sur place / à emporter */}
          <div className="mt-8 border-t pt-6">
            <h3 className="text-lg font-bold mb-1">TVA par catégorie</h3>
            <p className="text-sm text-gray-500 mb-4">
              Un taux défini sur une catégorie s'applique à ses produits <strong>et à ses sous-catégories</strong> (héritage).
              Champ vide = hérité du parent, sinon taux par défaut du mode. Le bouton « OK » enregistre les deux taux de la catégorie.
            </p>
            {productCategories.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune catégorie (à créer dans l'espace Manager).</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2">
                <div>
                  <h4 className="text-sm font-bold text-emerald-700 uppercase tracking-wide mb-2">TVA sur place</h4>
                  {renderCatTaxColumn('dineIn')}
                </div>
                <div className="lg:border-l lg:pl-8">
                  <h4 className="text-sm font-bold text-emerald-700 uppercase tracking-wide mb-2">TVA à emporter</h4>
                  {renderCatTaxColumn('takeaway')}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          ONGLET COMPTES & POINTS : GESTION DES UTILISATEURS ET DE LA FIDÉLITÉ
         ========================================================================= */}
      {activeTab === 'hours' && (
        <OpeningHoursManager />
      )}

      {activeTab === 'comptes' && (
        <AccountsManager />
      )}

    </div>
  );
};

export default SuperAdmin;