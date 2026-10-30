// src/pages/Admin.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clickable } from '../utils/a11y';
import ConfirmModal from '../components/modals/ConfirmModal';
import RefundModal from '../components/modals/RefundModal';
import RefundDetailsModal from '../components/modals/RefundDetailsModal';
import SendReceiptModal from '../components/modals/SendReceiptModal';
import { useToast } from '../context/ToastContext';
import {
  fetchOrders,
  updateOrderStatus,
  refundOrder,
  fetchProducts,
  updateProduct,
  createProduct,
  uploadProductImage,
  fetchMenus,
  updateMenu,
  createMenu,
  deleteMenu,
  fetchIngredients,
  updateIngredient,
  createIngredient,
  uploadIngredientImage,
  deleteIngredient,
  fetchFormulas,
  updateFormula,
  createFormula,
  deleteFormula,
  uploadFormulaImage,
  fetchDishes,
  createDish,
  updateDish,
  deleteDish,
  uploadDishImage,
  uploadMenuImage,
  getUserById,
  fetchProductCategories
} from '../services/api';
import { getImageUrl } from '../utils/imageUtils';
import ProductCard from '../components/ProductCard';
import { useListControls } from '../hooks/useListControls';
import { ListToolbar, Pagination, ViewToggle } from '../components/admin/ListControls';
import Icon from '../components/Icon';
import OrderTicketModal from '../components/modals/OrderTicketModal';
import InvoiceModal from '../components/modals/InvoiceModal';
import { orderToLines, tsToDate, orderLabel } from '../utils/orderTicket';
import { RESTAURANT_TIMEZONE } from '../utils/hours';
import BubbleTeaManager from '../components/admin/BubbleTeaManager';
import MilkshakeManager from '../components/admin/MilkshakeManager';
import ProductCategoryManager from '../components/admin/ProductCategoryManager';
import { socket } from '../socket';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Catégories de produits (onglet Produits)
const PRODUCT_CATEGORIES = [
  { key: 'drink',   label: 'Boissons', icon: 'drink' },
  { key: 'coffee',  label: 'Cafés',    icon: 'coffee' },
  { key: 'dessert', label: 'Desserts', icon: 'dessert' },
  { key: 'side',    label: 'Salés',    icon: 'salty' },
];

// Ligne d'accompagnement réordonnable par drag & drop (modale plat chaud)
const SortableSide = ({ id, side, idx, onChange, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 items-center bg-white">
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing touch-none text-stone-400 hover:text-stone-600 px-1"
        aria-label="Réordonner"
        {...attributes}
        {...listeners}
      >
        <Icon name="drag" className="w-4 h-4 inline" />
      </button>
      <input
        type="text"
        value={side.name}
        onChange={(e) => onChange(idx, 'name', e.target.value)}
        placeholder="Nom (ex: Riz blanc)"
        className="flex-1 px-3 py-2 border rounded-lg text-sm"
      />
      <input
        type="number"
        step="0.5"
        min="0"
        value={side.priceAddition}
        onChange={(e) => onChange(idx, 'priceAddition', e.target.value)}
        placeholder="+€"
        className="w-24 px-3 py-2 border rounded-lg text-sm"
      />
      <button type="button" onClick={() => onRemove(idx)} className="text-cherry hover:text-cherry/70"><Icon name="close" className="w-4 h-4 inline" /></button>
    </div>
  );
};

const Admin = () => {
  const { toast } = useToast();

  // Modal de confirmation (remplace window.confirm)
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'danger' });
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false, onConfirm: null }));

  // Navigation par onglets
  const [activeTab, setActiveTab] = useState('commandes');

  // États pour les données
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [menus, setMenus] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [formulas, setFormulas] = useState([]);
  const [loading, setLoading] = useState(true);

  // États pour les modifications de prix (inputs temporaires)

  // États pour la gestion des ingrédients (Création/Édition)
  const [showIngredientModal, setShowIngredientModal] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState(null); // null = création, sinon édition
  const [ingredientForm, setIngredientForm] = useState({
    name: '',
    category: 'base_salade',
    image: '',
    is_premium: false,
    extra_price: 0,
    nutritional_info: { calories: 0, proteins: 0, carbs: 0, fat: 0 },
    tags: []
  });
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);

  // États pour la gestion des produits (Création/Édition)
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productForm, setProductForm] = useState({
    name: '',
    category: 'drink',
    categoryId: null,
    image: '',
    price: 0,
    menu_surcharge: 0,
    nutritional_info: { calories: 0, proteins: 0, carbs: 0, fat: 0 },
    extras: []
  });
  // Arbre de catégories produits (pour le sélecteur dans le formulaire produit).
  const [productCategories, setProductCategories] = useState([]);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const [productImagePreview, setProductImagePreview] = useState(null);
  const [uploadingMenuImage, setUploadingMenuImage] = useState(false);
  const [menuImagePreview, setMenuImagePreview] = useState(null);

  // États pour la gestion des menus (Création/Édition)
  const [showMenuModal, setShowMenuModal] = useState(false);
  const [editingMenu, setEditingMenu] = useState(null);
  const [menuForm, setMenuForm] = useState({
    image: '',
    name: '',
    price_addition: 0,
    mode: '', // 'drink' | 'dessert' | 'or' | 'and'
    allowedProductIds: []
  });

  // États pour la gestion des formules (Création/Édition)
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [editingFormula, setEditingFormula] = useState(null);
  const [formulaForm, setFormulaForm] = useState({
    name: '',
    type: 'salad',
    base_price: 0,
    image: '',
    limits: {
      base: 0,
      protein: 0,
      topping: 0,
      sauce: 0
    },
    extra_cost_per_component: 0,
    isAvailable: true
  });

  const [uploadingFormulaImage, setUploadingFormulaImage] = useState(false);
  const [formulaImagePreview, setFormulaImagePreview] = useState(null);

  // États pour la gestion des plats chauds (Création/Édition)
  const [dishes, setDishes] = useState([]);

  // Recherche + tri + pagination (déclarés après tous les états sources)
  // Filtre par catégorie (cumulable) — onglet Produits uniquement. Vide = tout afficher.
  const [productCatFilter, setProductCatFilter] = useState([]);
  const toggleProductCatFilter = (key) =>
    setProductCatFilter(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const filteredProducts = useMemo(
    () => productCatFilter.length === 0 ? products : products.filter(p => productCatFilter.includes(p.category)),
    [products, productCatFilter]
  );

  const ingredientControls = useListControls(ingredients,      { pageSize: 24 });
  const productControls    = useListControls(filteredProducts, { pageSize: 24 });
  const menuControls       = useListControls(menus,            { pageSize: 24 });
  const formulaControls    = useListControls(formulas,         { pageSize: 24 });
  const dishControls       = useListControls(dishes,           { pageSize: 24 });

  // Chargement + temps réel de l'arbre de catégories produits (pour le sélecteur produit).
  useEffect(() => {
    const reload = async () => {
      try {
        const res = await fetchProductCategories();
        const data = Array.isArray(res.data) ? res.data
          : (Array.isArray(res.data?.data) ? res.data.data : []);
        setProductCategories(data);
      } catch (err) {
        console.error('Erreur chargement catégories produits:', err);
      }
    };
    reload();
    socket.on('product_category_created', reload);
    socket.on('product_category_updated', reload);
    socket.on('product_category_deleted', reload);
    return () => {
      socket.off('product_category_created', reload);
      socket.off('product_category_updated', reload);
      socket.off('product_category_deleted', reload);
    };
  }, []);

  // Options du sélecteur produit : arbre aplati en chemin indenté, filtré sur la catégorie fixe.
  const productCategoryOptions = useMemo(() => {
    const byParent = {};
    productCategories.forEach(c => {
      const k = c.parentId || 'root';
      (byParent[k] = byParent[k] || []).push(c);
    });
    const sortNodes = (arr) => [...arr].sort((a, b) =>
      ((a.order ?? 0) - (b.order ?? 0)) || String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })
    );
    const out = [];
    const walk = (parentId, depth) => {
      sortNodes(byParent[parentId] || []).forEach(node => {
        out.push({ id: node.id, label: `${'— '.repeat(depth)}${node.name}` });
        walk(node.id, depth + 1);
      });
    };
    sortNodes((byParent['root'] || []).filter(n => n.rootCategory === productForm.category))
      .forEach(root => { out.push({ id: root.id, label: root.name }); walk(root.id, 1); });
    return out;
  }, [productCategories, productForm.category]);

  // Pagination de l'historique des commandes (ordre chronologique conservé)
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState('');
  const HISTORY_PAGE_SIZE = 10;

  // Date affichée dans l'historique : JJ/MM/AAAA HH:MM (fuseau GP), source paidAt sinon createdAt.
  const formatHistoryDate = (order) => {
    const d = tsToDate(order.paidAt) || tsToDate(order.createdAt);
    return d
      ? d.toLocaleString('fr-FR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'America/Guadeloupe',
        }).replace(',', '')
      : '';
  };

  // Mode d'affichage indépendant par onglet : 'grid' (cartes) | 'table' (lignes)
  const [ingredientView, setIngredientView] = useState('grid');
  const [menuView,       setMenuView]       = useState('grid');
  const [formulaView,    setFormulaView]    = useState('grid');
  const [productView,    setProductView]    = useState('grid');
  const [dishView,       setDishView]       = useState('table');
  const [isDishModalOpen, setIsDishModalOpen] = useState(false);
  const [editingDish, setEditingDish] = useState(null);
  const [dishForm, setDishForm] = useState({
    name: '', description: '', price: 0, image: '',
    category: 'hot_dish', sides: [], maxSides: 0, dietaryTags: [], isAvailable: true
  });
  const [dishTagsInput, setDishTagsInput] = useState('');
  const [uploadingDishImage, setUploadingDishImage] = useState(false);

  // Chargement initial des données
  useEffect(() => {
    loadAllData();
  }, []);

  // Temps réel des commandes : sans ça une commande en ligne déclencherait l'alerte sonore
  // sans apparaître dans la liste avant un rechargement manuel de la page.
  useEffect(() => {
    const idOf = (o) => o?._id || o?.id;
    const upsert = (o) => setOrders(prev => {
      const list = Array.isArray(prev) ? prev : [];
      const idx = list.findIndex(x => idOf(x) === idOf(o));
      if (idx === -1) return [o, ...list];   // liste triée par createdAt décroissant côté backend
      const next = [...list];
      next[idx] = o;
      return next;
    });
    const remove = (id) => setOrders(prev => (Array.isArray(prev) ? prev : []).filter(x => idOf(x) !== id));

    const onOrderCancelled = ({ orderId, order }) => (order ? upsert(order) : remove(orderId));
    const onOrderDeleted = ({ id }) => remove(id);

    socket.on('new_order', upsert);
    socket.on('order_updated', upsert);
    socket.on('order:cancelled', onOrderCancelled);
    socket.on('order_deleted', onOrderDeleted);
    return () => {
      socket.off('new_order', upsert);
      socket.off('order_updated', upsert);
      socket.off('order:cancelled', onOrderCancelled);
      socket.off('order_deleted', onOrderDeleted);
    };
  }, []);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [ordersData, productsData, menusData, ingredientsData, formulasData, dishesData] = await Promise.all([
        fetchOrders(),
        fetchProducts(),
        fetchMenus(),
        fetchIngredients(),
        fetchFormulas(),
        fetchDishes()
      ]);

      // Fonction utilitaire locale pour extraire les données peu importe le format du backend
      const extractData = (response) => {
        // Cas 1 : Tableau direct (ex: Ingrédients)
        if (Array.isArray(response.data)) return response.data;
        // Cas 2 : Wrapper "Buggé" où les données sont dans 'message' (ex: Commandes, Menus)
        if (response.data && Array.isArray(response.data.message)) return response.data.message;
        // Cas 3 : Wrapper Standard
        if (response.data && Array.isArray(response.data.data)) return response.data.data;
        // Fallback
        return [];
      };

      setOrders(extractData(ordersData));
      setProducts(extractData(productsData));
      setMenus(extractData(menusData));
      setIngredients(extractData(ingredientsData));
      setFormulas(extractData(formulasData));
      setDishes(extractData(dishesData));

    } catch (error) {
      console.error("Erreur de chargement", error);
      toast.error("Impossible de charger les données administrateur.");
    } finally {
      setLoading(false);
    }
  };

  // --- LOGIQUE COMMANDES ---

  const handleCancelOrder = (orderId) => {
    setConfirmState({
      open: true,
      title: 'Annuler la commande',
      message: 'Êtes-vous sûr de vouloir annuler cette commande ?',
      variant: 'warning',
      onConfirm: async () => {
        closeConfirm();
        try {
          await updateOrderStatus(orderId, 'cancelled');
          loadAllData();
        } catch (error) {
          console.error(error);
          toast.error("Erreur lors de l'annulation.");
        }
      }
    });
  };

  // Une annulation se lit par ce qu'il reste à faire, pas par l'endroit d'où elle vient.
  // Pour `refund_due`, l'avancement se lit sur refundedAmount vs cancelledAmount (le statut
  // reste 'cancelled' : le passer à 'refunded' effacerait le fait qu'elle a été annulée).
  const cancelLabel = (cancelType, amount, refunded = 0) => {
    if (cancelType === 'refund_due') {
      const due = round2(amount - refunded);
      if (amount > 0 && due <= 0.001) {
        return { text: 'Remboursée', color: 'bg-purple-100 text-purple-800', refundDone: true };
      }
      if (refunded > 0) {
        return { text: `Reste ${due.toFixed(2)}€ à rembourser`, color: 'bg-orange-100 text-orange-800' };
      }
      return {
        text: amount > 0 ? `${amount.toFixed(2)}€ à rembourser` : 'Client à rembourser',
        color: 'bg-orange-100 text-orange-800',
      };
    }
    return {
      no_payment: { text: 'Annulé', color: 'bg-red-100 text-red-800' },
      interrupted: { text: 'Interrompue', color: 'bg-gray-200 text-gray-700' },
    }[cancelType];
  };

  const getStatusLabel = (status, cancelType = null, cancelledAmount = 0, refundedAmount = 0) => {
    if (status === 'cancelled' && cancelLabel(cancelType, cancelledAmount, refundedAmount)) {
      return cancelLabel(cancelType, cancelledAmount, refundedAmount);
    }
    const labels = {
      scheduled: { text: 'Réservée', color: 'bg-violet-100 text-violet-800' },
      pending: { text: 'En attente', color: 'bg-yellow-100 text-yellow-800' },
      preparing: { text: 'En cuisine', color: 'bg-blue-100 text-blue-800' },
      ready: { text: 'Prêt', color: 'bg-green-100 text-green-800' },
      delivered: { text: 'Livré', color: 'bg-gray-100 text-gray-800' },
      cancelled: { text: 'Annulé', color: 'bg-red-100 text-red-800' },
      refunded: { text: 'Remboursé', color: 'bg-purple-100 text-purple-800' },
    };
    return labels[status] || { text: status, color: 'bg-gray-100' };
  };

  // --- LOGIQUE REMBOURSEMENT ---

  const [refundTarget, setRefundTarget] = useState(null);
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  // Détail du ticket : commande affichée dans la modale + id de la ligne dont le menu kebab est ouvert.
  const [ticketTarget, setTicketTarget] = useState(null);
  const [invoiceTarget, setInvoiceTarget] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  // Envoi du ticket par email : commande ciblée + email pré-rempli (résolu depuis le compte client si lié).
  const [emailTarget, setEmailTarget] = useState(null);
  const [emailDefaultTo, setEmailDefaultTo] = useState('');

  // Vente annulée APRÈS encaissement : l'argent est entré en caisse même si la commande n'a
  // jamais été réglée (`paid: false`) → il reste à rendre tant que cancelledAmount n'est pas couvert.
  const cancelRefundDue = (o) => {
    if (o.status !== 'cancelled' || o.cancelType !== 'refund_due') return 0;
    return round2((o.cancelledAmount || 0) - (o.refundedAmount || 0));
  };

  // Une commande est remboursable si elle est réglée et pas déjà annulée/remboursée intégralement,
  // ou s'il reste à rendre l'encaissement d'une vente annulée.
  const canRefund = (o) =>
    (o.paid && o.status !== 'cancelled' && o.status !== 'refunded') || cancelRefundDue(o) > 0.001;

  // Badge "partiellement remboursé" (le statut reste opérationnel sur un partiel).
  // Sur une annulation, l'information est déjà portée par le badge de statut → pas de doublon.
  const refundBadge = (o) => {
    const r = o.refundedAmount || 0;
    if (r <= 0 || o.status === 'refunded' || o.cancelType === 'refund_due') return null;
    return `Remboursé ${r.toFixed(2)} €`;
  };

  // Détail des remboursements : accessible dès qu'il y a quelque chose à montrer.
  const [refundDetailsTarget, setRefundDetailsTarget] = useState(null);
  const [refundByNames, setRefundByNames] = useState({}); // id opérateur -> nom

  const openRefundDetails = async (order) => {
    setRefundDetailsTarget(order);
    // Résout les noms des opérateurs (refunds[].by ne porte qu'un id).
    const ids = [...new Set((order.refunds || []).map(r => r.by).filter(id => id && !refundByNames[id]))];
    if (!ids.length) return;
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const res = await getUserById(id);
        const u = res.data?.data || res.data;
        return [id, u?.name || null];
      } catch { return [id, null]; }
    }));
    setRefundByNames(prev => ({ ...prev, ...Object.fromEntries(entries.filter(([, n]) => n)) }));
  };

  // Normalise les articles d'une commande en lignes { key, label, price } pour la sélection par article.
  // Ouvre la modale d'envoi email. Pré-remplit l'email depuis le compte client si la commande y est rattachée.
  // L'email est résolu AVANT le montage de la modale (qui fige defaultTo à l'initialisation).
  const openEmailReceipt = async (order) => {
    setMenuOpenId(null);
    let prefill = order.email || '';
    if (order.user) {
      try {
        const res = await getUserById(order.user);
        prefill = res.data?.data?.email || res.data?.email || prefill;
      } catch {
        // Best-effort : si le compte est introuvable, le champ reste éditable (vide).
      }
    }
    setEmailDefaultTo(prefill);
    setEmailTarget(order);
  };

  // Menu kebab partagé (commandes en cours + historique) → détail du ticket / envoi par email.
  const OrderKebab = ({ order }) => (
    <div className="relative">
      <button
        onClick={() => setMenuOpenId(menuOpenId === order._id ? null : order._id)}
        className="p-2 rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition"
        aria-label="Options de la commande"
      >
        <Icon name="more" />
      </button>
      {menuOpenId === order._id && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
          <div className="absolute right-0 mt-1 z-20 w-48 bg-white border border-gray-100 rounded-lg shadow-lg py-1">
            <button
              onClick={() => { setTicketTarget(order); setMenuOpenId(null); }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2"
            >
              <Icon name="receipt" /> Détail du ticket
            </button>
            <button
              onClick={() => { setInvoiceTarget(order); setMenuOpenId(null); }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2"
            >
              <Icon name="invoice" /> Facture
            </button>
            <button
              onClick={() => openEmailReceipt(order)}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2"
            >
              <Icon name="mail" /> Envoyer par email
            </button>
          </div>
        </>
      )}
    </div>
  );

  const handleRefund = async (payload) => {
    if (!refundTarget) return;
    setRefundSubmitting(true);
    try {
      const res = await refundOrder(refundTarget._id, payload);
      toast.success(res?.data?.message || 'Remboursement enregistré.');
      setRefundTarget(null);
      loadAllData();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.message || 'Erreur lors du remboursement.');
    } finally {
      setRefundSubmitting(false);
    }
  };

  // Filtrage des commandes (les commandes remboursées intégralement rejoignent l'historique).
  const safeOrders = Array.isArray(orders) ? orders : [];
  // 'scheduled' = payée d'avance pour un service à venir. Elle DOIT être visible ici :
  // sans ça, une commande encaissée pour demain n'apparaît nulle part, et personne ne
  // peut la rembourser si le restaurant ferme finalement.
  const activeOrders = safeOrders.filter(o => ['scheduled', 'pending', 'preparing', 'ready'].includes(o.status));
  const allHistoryOrders = safeOrders.filter(o => ['delivered', 'cancelled', 'refunded'].includes(o.status));
  const historyQuery = historySearch.trim().toLowerCase();
  const historyOrders = historyQuery
    ? allHistoryOrders.filter(o => {
        const num = orderLabel(o);
        const haystack = `${num} ${o.customerName || ''} ${formatHistoryDate(o)}`.toLowerCase();
        return haystack.includes(historyQuery);
      })
    : allHistoryOrders;
  const historyTotalPages = Math.max(1, Math.ceil(historyOrders.length / HISTORY_PAGE_SIZE));
  const historySafePage = Math.min(historyPage, historyTotalPages);
  const historyPageItems = historyOrders.slice((historySafePage - 1) * HISTORY_PAGE_SIZE, historySafePage * HISTORY_PAGE_SIZE);

  // --- LOGIQUE STOCKS (INGRÉDIENTS) ---
  
  const toggleIngredientAvailability = async (ingredient) => {
    try {
        // On inverse le statut actuel
        const newStatus = !ingredient.isAvailable;
        
        // Appel API (qui déclenchera le socket côté serveur)
        await updateIngredient(ingredient._id, { isAvailable: newStatus });

        // Mise à jour locale (Optimistic UI) pour que ce soit instantané à l'écran admin
        setIngredients(prevIngredients => 
            prevIngredients.map(ing => 
                ing._id === ingredient._id ? { ...ing, isAvailable: newStatus } : ing
            )
        );

    } catch (error) {
        console.error("Erreur mise à jour stock", error);
        toast.error("Impossible de mettre à jour le stock.");
    }
  };

  const toggleDishAvailability = async (dish) => {
    try {
      const newStatus = !dish.isAvailable;
      await updateDish(dish._id, { isAvailable: newStatus });
      setDishes(prev => prev.map(d => d._id === dish._id ? { ...d, isAvailable: newStatus } : d));
    } catch (error) {
      console.error("Erreur mise à jour dispo plat", error);
      toast.error("Impossible de mettre à jour la disponibilité.");
    }
  };

  // --- LOGIQUE PLATS CHAUDS ---

  const openCreateDishModal = () => {
    setEditingDish(null);
    setDishForm({ name: '', description: '', price: 0, image: '', category: 'hot_dish', sides: [], maxSides: 0, dietaryTags: [], isAvailable: true });
    setDishTagsInput('');
    setIsDishModalOpen(true);
  };

  const openEditDishModal = (dish) => {
    setEditingDish(dish);
    setDishForm({ ...dish });
    setDishTagsInput((dish.dietaryTags || []).join(', '));
    setIsDishModalOpen(true);
  };

  const handleDishImageUpload = async (file) => {
    try {
      setUploadingDishImage(true);
      const formData = new FormData();
      formData.append('image', file);
      const response = await uploadDishImage(formData);
      // dishRoutes retourne une structure plate : response.data.imageUrl directement
      const imageUrl = response.data.imageUrl;
      setDishForm(prev => ({ ...prev, image: imageUrl }));
    } catch (error) {
      console.error('Erreur upload image plat:', error);
      toast.error("Erreur lors de l'upload de l'image");
    } finally {
      setUploadingDishImage(false);
    }
  };

  const handleAddSide = () => {
    setDishForm(prev => ({ ...prev, sides: [...prev.sides, { name: '', priceAddition: 0 }] }));
  };

  const handleRemoveSide = (index) => {
    setDishForm(prev => ({ ...prev, sides: prev.sides.filter((_, i) => i !== index) }));
  };

  const handleSideChange = (index, field, value) => {
    setDishForm(prev => ({
      ...prev,
      sides: prev.sides.map((s, i) => i === index
        ? { ...s, [field]: field === 'priceAddition' ? parseFloat(value) || 0 : value }
        : s
      )
    }));
  };

  const sideSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleSideDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = Number(String(active.id).replace('side-', ''));
    const newIndex = Number(String(over.id).replace('side-', ''));
    setDishForm(prev => ({ ...prev, sides: arrayMove(prev.sides, oldIndex, newIndex) }));
  };

  const handleSaveDish = async () => {
    if (!dishForm.name.trim()) { toast.warning('Le nom est requis'); return; }
    if (!dishForm.price || dishForm.price <= 0) { toast.warning('Le prix doit être supérieur à 0'); return; }
    try {
      const payload = {
        ...dishForm,
        dietaryTags: dishTagsInput.split(',').map(t => t.trim()).filter(Boolean)
      };
      if (editingDish) {
        await updateDish(editingDish._id, payload);
      } else {
        await createDish(payload);
      }
      setIsDishModalOpen(false);
      const res = await fetchDishes();
      setDishes(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error('Erreur sauvegarde plat:', error);
      toast.error('Erreur : ' + (error.response?.data?.message || error.message));
    }
  };

  const handleDeleteDish = (id) => {
    setConfirmState({
      open: true,
      title: 'Supprimer le plat',
      message: 'Êtes-vous sûr de vouloir supprimer ce plat ? Cette action est irréversible.',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteDish(id);
          setDishes(prev => prev.filter(d => d._id !== id));
        } catch (error) {
          toast.error('Erreur suppression : ' + error.message);
        }
      }
    });
  };

  // --- LOGIQUE GESTION INGRÉDIENTS (CRÉATION/ÉDITION) ---

  const openCreateIngredientModal = () => {
    setEditingIngredient(null);
    setIngredientForm({
      name: '',
      category: 'base_salade',
      image: '',
      is_premium: false,
      extra_price: 0,
      nutritional_info: { calories: 0, proteins: 0, carbs: 0, fat: 0 },
      tags: []
    });
    setImagePreview(null);
    setShowIngredientModal(true);
  };

  const openEditIngredientModal = (ingredient) => {
    setEditingIngredient(ingredient);
    setIngredientForm({
      name: ingredient.name,
      category: ingredient.category,
      image: ingredient.image || '',
      is_premium: ingredient.is_premium || false,
      extra_price: ingredient.extra_price || 0,
      nutritional_info: ingredient.nutritional_info || { calories: 0, proteins: 0, carbs: 0, fat: 0 },
      tags: ingredient.tags || []
    });
    setImagePreview(ingredient.image ? getImageUrl(ingredient.image) : null);
    setShowIngredientModal(true);
  };

  const closeIngredientModal = () => {
    setShowIngredientModal(false);
    setEditingIngredient(null);
    setIngredientForm({
      name: '',
      category: 'base_salade',
      image: '',
      is_premium: false,
      extra_price: 0,
      nutritional_info: { calories: 0, proteins: 0, carbs: 0, fat: 0 },
      tags: []
    });
    setImagePreview(null);
  };

  const handleIngredientFormChange = (field, value) => {
    setIngredientForm(prev => ({ ...prev, [field]: value }));
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Vérification du type de fichier
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.warning('Format de fichier non supporté. Utilisez: JPEG, PNG, GIF ou WEBP');
      return;
    }

    // Vérification de la taille (10 MB max - sera compressée automatiquement)
    if (file.size > 10 * 1024 * 1024) {
      toast.warning('Le fichier est trop volumineux (10 MB max)');
      return;
    }

    try {
      setUploadingImage(true);

      // Prévisualisation locale
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);

      // Upload vers le serveur (avec compression automatique)
      const formData = new FormData();
      formData.append('image', file);

      const response = await uploadIngredientImage(formData);
      const imageUrl = response.data.data.imageUrl;

      // Affichage des infos de compression
      if (response.data.data?.compressionRatio) {
        console.log(`[Upload] Image compressée: ${response.data.data.originalSize} → ${response.data.data.compressedSize} (${response.data.data.compressionRatio} de réduction)`);
      }

      // Mise à jour du formulaire avec l'URL de l'image
      setIngredientForm(prev => ({ ...prev, image: imageUrl }));

    } catch (error) {
      console.error('Erreur upload image:', error);
      toast.error("Erreur lors de l'upload de l'image");
      setImagePreview(null);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveIngredient = async () => {
    // Validation
    if (!ingredientForm.name.trim()) {
      toast.warning("Le nom de l'ingrédient est requis");
      return;
    }

    if (!ingredientForm.category) {
      toast.warning('La catégorie est requise');
      return;
    }

    try {
      if (editingIngredient) {
        // Mise à jour
        await updateIngredient(editingIngredient._id, ingredientForm);
        toast.success('Ingrédient mis à jour avec succès !');
      } else {
        // Création
        const response = await createIngredient(ingredientForm);

        // Vérifier si les infos nutritionnelles ont été auto-complétées
        if (response.data._nutritionAutoFilled) {
          const sourceName = {
            'nutritionix': 'Nutritionix',
            'openfoodfacts': 'Open Food Facts',
            'openai': 'Intelligence Artificielle'
          }[response.data._nutritionSource] || 'API externe';

          toast.success(`Ingrédient créé ! Infos nutritionnelles remplies via ${sourceName}.`);
        } else {
          toast.success('Ingrédient créé avec succès !');
        }
      }

      closeIngredientModal();
      loadAllData();
    } catch (error) {
      console.error('Erreur sauvegarde ingrédient:', error);
      toast.error("Erreur lors de la sauvegarde de l'ingrédient");
    }
  };

  // --- LOGIQUE GESTION PRODUITS (CRÉATION/ÉDITION) ---

  const openCreateProductModal = () => {
    setEditingProduct(null);
    setProductForm({
      name: '',
      category: 'drink',
      categoryId: null,
      image: '',
      price: 0,
      menu_surcharge: 0,
      nutritional_info: { calories: 0, proteins: 0, carbs: 0, fat: 0 },
      extras: []
    });
    setProductImagePreview(null);
    setShowProductModal(true);
  };

  const openEditProductModal = (product) => {
    setEditingProduct(product);
    setProductForm({
      name: product.name,
      category: product.category,
      categoryId: product.categoryId || null,
      image: product.image || '',
      price: product.price,
      menu_surcharge: product.menu_surcharge || 0,
      nutritional_info: product.nutritional_info || { calories: 0, proteins: 0, carbs: 0, fat: 0 },
      extras: Array.isArray(product.extras) ? product.extras : []
    });
    setProductImagePreview(product.image ? getImageUrl(product.image) : null);
    setShowProductModal(true);
  };

  const closeProductModal = () => {
    setShowProductModal(false);
    setEditingProduct(null);
    setProductForm({
      name: '',
      category: 'drink',
      categoryId: null,
      image: '',
      price: 0,
      menu_surcharge: 0,
      nutritional_info: { calories: 0, proteins: 0, carbs: 0, fat: 0 },
      extras: []
    });
    setProductImagePreview(null);
  };

  const handleProductFormChange = (field, value) => {
    setProductForm(prev => ({ ...prev, [field]: value }));
  };

  // --- Suppléments / extras du produit (facultatifs côté client) ---
  const addProductExtra = () => {
    setProductForm(prev => ({
      ...prev,
      extras: [...(prev.extras || []), { id: `extra-${Date.now()}`, name: '', price: 0 }]
    }));
  };
  const updateProductExtra = (index, field, value) => {
    setProductForm(prev => ({
      ...prev,
      extras: (prev.extras || []).map((ex, i) => i === index ? { ...ex, [field]: value } : ex)
    }));
  };
  const removeProductExtra = (index) => {
    setProductForm(prev => ({
      ...prev,
      extras: (prev.extras || []).filter((_, i) => i !== index)
    }));
  };

  const handleProductImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.warning('Format de fichier non supporté. Utilisez: JPEG, PNG, GIF ou WEBP');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.warning('Le fichier est trop volumineux (10 MB max)');
      return;
    }

    try {
      setUploadingProductImage(true);

      const reader = new FileReader();
      reader.onloadend = () => {
        setProductImagePreview(reader.result);
      };
      reader.readAsDataURL(file);

      const formData = new FormData();
      formData.append('image', file);

      const response = await uploadProductImage(formData);
      const imageUrl = response.data.data.imageUrl;

      setProductForm(prev => ({ ...prev, image: imageUrl }));

    } catch (error) {
      console.error('Erreur upload image produit:', error);
      toast.error("Erreur lors de l'upload de l'image");
      setProductImagePreview(null);
    } finally {
      setUploadingProductImage(false);
    }
  };

  const handleMenuImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) { toast.warning('Format non supporté (JPEG, PNG, GIF, WEBP)'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.warning('Fichier trop volumineux (10 MB max)'); return; }
    try {
      setUploadingMenuImage(true);
      const reader = new FileReader();
      reader.onloadend = () => setMenuImagePreview(reader.result);
      reader.readAsDataURL(file);
      const formData = new FormData();
      formData.append('image', file);
      const response = await uploadMenuImage(formData);
      const imageUrl = response.data.data.imageUrl;
      setMenuForm(prev => ({ ...prev, image: imageUrl }));
    } catch (error) {
      console.error('Erreur upload image menu:', error);
      toast.error("Erreur lors de l'upload de l'image");
      setMenuImagePreview(null);
    } finally {
      setUploadingMenuImage(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!productForm.name.trim()) {
      toast.warning("Le nom de l'article est requis");
      return;
    }

    if (!productForm.category) {
      toast.warning('La catégorie est requise');
      return;
    }

    if (productForm.price === undefined || productForm.price < 0) {
      toast.warning('Le prix est requis et doit être positif');
      return;
    }

    try {
      if (editingProduct) {
        await updateProduct(editingProduct._id, productForm);
        toast.success('Article mis à jour avec succès !');
      } else {
        await createProduct(productForm);
        toast.success('Article créé avec succès !');
      }

      closeProductModal();
      loadAllData();
    } catch (error) {
      console.error('Erreur sauvegarde produit:', error);
      toast.error("Erreur lors de la sauvegarde de l'article");
    }
  };

  const toggleProductAvailability = async (product) => {
    try {
      const newStatus = !product.isAvailable;
      await updateProduct(product._id, { isAvailable: newStatus });

      setProducts(prevProducts =>
        prevProducts.map(p =>
          p._id === product._id ? { ...p, isAvailable: newStatus } : p
        )
      );
    } catch (error) {
      console.error("Erreur mise à jour produit", error);
      toast.error("Impossible de mettre à jour l'article.");
    }
  };

  // --- LOGIQUE UPLOAD DIRECT D'IMAGE ---
  // --- LOGIQUE GESTION MENUS (CRÉATION/ÉDITION) ---

  const openCreateMenuModal = () => {
    setEditingMenu(null);
    setMenuForm({
      image: '',
      name: '',
      price_addition: 0,
      mode: '',
      allowedProductIds: []
    });
    setMenuImagePreview(null);
    setShowMenuModal(true);
  };

  const openEditMenuModal = (menu) => {
    setEditingMenu(menu);
    const inc = menu.includes || {};
    const mode = inc.drink && inc.dessert
      ? (menu.selectionMode === 'or' ? 'or' : 'and')
      : inc.drink ? 'drink' : inc.dessert ? 'dessert' : '';
    setMenuForm({
      image: menu.image || '',
      name: menu.name,
      price_addition: menu.price_addition,
      mode,
      allowedProductIds: menu.allowedProductIds || []
    });
    setMenuImagePreview(menu.image ? getImageUrl(menu.image) : null);
    setShowMenuModal(true);
  };

  const closeMenuModal = () => {
    setShowMenuModal(false);
    setEditingMenu(null);
    setMenuForm({
      name: '',
      price_addition: 0,
      mode: '',
      allowedProductIds: []
    });
  };

  const handleMenuFormChange = (field, value) => {
    setMenuForm(prev => ({ ...prev, [field]: value }));
  };

  const toggleAllowedProduct = (productId) => {
    setMenuForm(prev => {
      const list = prev.allowedProductIds || [];
      return {
        ...prev,
        allowedProductIds: list.includes(productId)
          ? list.filter(id => id !== productId)
          : [...list, productId]
      };
    });
  };

  const handleSaveMenu = async () => {
    if (!menuForm.name.trim()) {
      toast.warning('Le nom du menu est requis');
      return;
    }

    if (menuForm.price_addition === undefined) {
      toast.warning('Le prix additionnel est requis');
      return;
    }

    // Le sélecteur `mode` pilote includes (catégories proposées) + selectionMode (OU/ET).
    const m = menuForm.mode;
    const includes = {
      drink: m === 'drink' || m === 'or' || m === 'and',
      dessert: m === 'dessert' || m === 'or' || m === 'and',
      side: false
    };
    const selectionMode = m === 'or' ? 'or' : 'and';
    const ids = menuForm.allowedProductIds || [];
    // On ne garde que les produits cochés des catégories réellement proposées.
    const allowedProductIds = products
      .filter(p => ids.includes(p._id) && ((p.category === 'drink' && includes.drink) || (p.category === 'dessert' && includes.dessert)))
      .map(p => p._id);

    const payload = {
      image: menuForm.image,
      name: menuForm.name,
      price_addition: menuForm.price_addition,
      includes,
      selectionMode,
      allowedProductIds
    };

    try {
      if (editingMenu) {
        await updateMenu(editingMenu._id, payload);
        toast.success('Menu mis à jour avec succès !');
      } else {
        await createMenu(payload);
        toast.success('Menu créé avec succès !');
      }

      closeMenuModal();
      loadAllData();
    } catch (error) {
      console.error('Erreur sauvegarde menu:', error);
      toast.error("Erreur lors de la sauvegarde du menu");
    }
  };

  const toggleMenuAvailability = async (menu) => {
    try {
      const newStatus = !menu.isAvailable;
      await updateMenu(menu._id, { isAvailable: newStatus });

      setMenus(prevMenus => 
        prevMenus.map(m => 
          m._id === menu._id ? { ...m, isAvailable: newStatus } : m
        )
      );
    } catch (error) {
      console.error("Erreur mise à jour menu", error);
      toast.error("Impossible de mettre à jour le menu.");
    }
  };

  // --- LOGIQUE GESTION FORMULES (CRÉATION/ÉDITION) ---

  const openCreateFormulaModal = () => {
    setEditingFormula(null);
    setFormulaForm({
      name: '',
      type: 'salad',
      base_price: 0,
      image: '',
      limits: {
        base: 0,
        protein: 0,
        topping: 0,
        sauce: 0
      },
      extra_cost_per_component: 0,
      isAvailable: true
    });
    setFormulaImagePreview(null);
    setShowFormulaModal(true);
  };

  const openEditFormulaModal = (formula) => {
    setEditingFormula(formula);
    setFormulaForm({
      name: formula.name,
      type: formula.type,
      base_price: formula.base_price,
      image: formula.image || '',
      limits: formula.limits || {},
      extra_cost_per_component: formula.extra_cost_per_component || 0,
      isAvailable: formula.isAvailable !== undefined ? formula.isAvailable : true
    });
    setFormulaImagePreview(formula.image || null);
    setShowFormulaModal(true);
  };

  const closeFormulaModal = () => {
    setShowFormulaModal(false);
    setEditingFormula(null);
    setFormulaImagePreview(null);
  };

  const handleFormulaFormChange = (field, value) => {
    setFormulaForm(prev => ({ ...prev, [field]: value }));
  };

  const handleFormulaLimitChange = (limitKey, value) => {
    setFormulaForm(prev => ({
      ...prev,
      limits: {
        ...prev.limits,
        [limitKey]: parseInt(value) || 0
      }
    }));
  };

  const handleFormulaImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!editingFormula) {
      toast.warning("Veuillez d'abord sauvegarder la formule avant d'uploader une image");
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      setUploadingFormulaImage(true);
      const response = await uploadFormulaImage(editingFormula._id, formData);
      
      setFormulaForm(prev => ({ ...prev, image: response.data.data.image }));
      setFormulaImagePreview(response.data.data.image);
      
      toast.success('Image uploadée avec succès !');
      loadAllData();
    } catch (error) {
      console.error('Erreur upload image formule:', error);
      toast.error("Erreur lors de l'upload de l'image");
    } finally {
      setUploadingFormulaImage(false);
    }
  };

  const handleSaveFormula = async () => {
    if (!formulaForm.name.trim()) {
      toast.warning('Le nom de la formule est requis');
      return;
    }

    if (!formulaForm.type) {
      toast.warning('Le type est requis');
      return;
    }

    if (formulaForm.base_price === undefined || formulaForm.base_price < 0) {
      toast.warning('Le prix est requis et doit être positif');
      return;
    }

    try {
      if (editingFormula) {
        await updateFormula(editingFormula._id, formulaForm);
        toast.success('Formule mise à jour avec succès !');
      } else {
        const response = await createFormula(formulaForm);
        toast.success('Formule créée ! Vous pouvez maintenant uploader une image.');
        // Passer en mode édition pour permettre l'upload d'image
        setEditingFormula(response.data);
      }

      loadAllData();
    } catch (error) {
      console.error('Erreur sauvegarde formule:', error);
      toast.error("Erreur lors de la sauvegarde de la formule");
    }
  };

  const handleDeleteIngredient = (ingredientId) => {
    setConfirmState({
      open: true,
      title: "Supprimer l'ingrédient",
      message: "Êtes-vous sûr de vouloir supprimer cet ingrédient ? Cette action est irréversible.",
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteIngredient(ingredientId);
          toast.success('Ingrédient supprimé avec succès !');
          loadAllData();
        } catch (error) {
          console.error('Erreur suppression ingrédient:', error);
          toast.error("Erreur lors de la suppression de l'ingrédient");
        }
      }
    });
  };

  const handleDeleteMenu = (menuId) => {
    setConfirmState({
      open: true,
      title: 'Supprimer le menu',
      message: 'Êtes-vous sûr de vouloir supprimer ce menu ? Cette action est irréversible.',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteMenu(menuId);
          toast.success('Menu supprimé avec succès !');
          loadAllData();
        } catch (error) {
          console.error('Erreur suppression menu:', error);
          toast.error("Erreur lors de la suppression du menu");
        }
      }
    });
  };

  const handleDeleteFormula = (formulaId) => {
    setConfirmState({
      open: true,
      title: 'Supprimer la formule',
      message: 'Êtes-vous sûr de vouloir supprimer cette formule ? Cette action est irréversible.',
      variant: 'danger',
      onConfirm: async () => {
        closeConfirm();
        try {
          await deleteFormula(formulaId);
          toast.success('Formule supprimée avec succès !');
          loadAllData();
        } catch (error) {
          console.error('Erreur suppression formule:', error);
          toast.error("Erreur lors de la suppression de la formule");
        }
      }
    });
  };

  const toggleFormulaAvailability = async (formula) => {
    try {
      const newStatus = !formula.isAvailable;
      await updateFormula(formula._id, { isAvailable: newStatus });

      setFormulas(prevFormulas => 
        prevFormulas.map(f => 
          f._id === formula._id ? { ...f, isAvailable: newStatus } : f
        )
      );
    } catch (error) {
      console.error("Erreur mise à jour formule", error);
      toast.error("Impossible de mettre à jour la formule.");
    }
  };

  if (loading) return <div className="p-10 text-center">Chargement de l'interface Admin...</div>;

  return (
    <div className="container mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-4xl font-bold text-gray-800">Panneau de Contrôle</h1>
      </div>

      {/* Barre d'onglets */}
      <div className="border-b border-gray-200 mb-8">
        <nav className="flex space-x-6 overflow-x-auto">
          {[
            { id: 'commandes',   label: 'Commandes',    icon: 'fire' },
            { id: 'ingredients', label: 'Ingrédients',  icon: 'avocado' },
            { id: 'menus',       label: 'Menus',        icon: 'restaurant' },
            { id: 'formules',    label: 'Salades',      icon: 'salad' },
            { id: 'produits',    label: 'Articles',     icon: 'products' },
            { id: 'product-cats', label: 'Catégories',  icon: 'category' },
            { id: 'dishes',      label: 'Plats chauds', icon: 'dish' },
            { id: 'bubbletea',   label: 'Bubble Tea',   icon: 'cocktail' },
            { id: 'milkshake',   label: 'Milkshake',   icon: 'milkshake' },
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

      <div>
        {activeTab === 'commandes' && (
        <div className="space-y-8">
          
          {/* Commandes En Cours */}
          <div className="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              En Préparation ({activeOrders.length})
            </h2>
            <div className="space-y-4 max-h-[500px] overflow-y-auto">
              {activeOrders.length === 0 && <p className="text-gray-500 italic">Aucune commande en cours.</p>}
              {activeOrders.map(order => (
                <div key={order._id} className="border p-4 rounded-lg flex justify-between items-center bg-gray-50">
                  <div>
                    <p className="font-bold text-lg">{orderLabel(order)} - {order.customerName}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusLabel(order.status, order.cancelType, order.cancelledAmount, order.refundedAmount).color}`}>
                        {getStatusLabel(order.status, order.cancelType, order.cancelledAmount, order.refundedAmount).text}
                      </span>
                      {getStatusLabel(order.status, order.cancelType, order.cancelledAmount, order.refundedAmount).refundDone && (
                        <button onClick={() => openRefundDetails(order)}
                          className="text-xs font-semibold text-purple-700 underline hover:text-purple-900">
                          détails
                        </button>
                      )}
                      {refundBadge(order) && (
                        <span className="px-2 py-1 rounded text-xs font-bold bg-purple-50 text-purple-700">{refundBadge(order)}</span>
                      )}
                    </div>
                    {order.scheduledFor && (
                      <p className="text-sm font-semibold text-violet-700 mt-1">
                        Retrait {tsToDate(order.scheduledFor)?.toLocaleString('fr-FR', {
                          weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: RESTAURANT_TIMEZONE,
                        })}
                      </p>
                    )}
                    <p className="text-gray-600 mt-1">{(order.totalPrice || 0).toFixed(2)} €</p>
                  </div>
                  <div className="flex gap-2">
                    {canRefund(order) && (
                      <button
                        onClick={() => setRefundTarget(order)}
                        className="bg-purple-100 hover:bg-purple-200 text-purple-700 px-4 py-2 rounded font-semibold transition inline-flex items-center gap-1.5"
                      >
                        <Icon name="refund" /> Rembourser
                      </button>
                    )}
                    <button
                      onClick={() => handleCancelOrder(order._id)}
                      className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded font-semibold transition"
                    >
                      Annuler
                    </button>
                    <OrderKebab order={order} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Historique */}
          <div>
            <h2 className="text-2xl font-bold mb-4 text-gray-700">Historique Récent</h2>
            <div className="relative mb-4">
              <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
                <Icon name="search" />
              </span>
              <input
                type="text"
                value={historySearch}
                onChange={(e) => { setHistorySearch(e.target.value); setHistoryPage(1); }}
                placeholder="Rechercher (nom, n° de commande, date/heure)…"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="space-y-2">
              {historyOrders.length === 0 && (
                <p className="text-gray-500 italic">
                  {historyQuery ? 'Aucune commande ne correspond à la recherche.' : "Aucune commande dans l'historique."}
                </p>
              )}
              {historyPageItems.map(order => (
                <div key={order._id} className="border-b last:border-0 py-2 flex justify-between items-center gap-2 text-sm">
                  <span className="text-gray-600">
                    {formatHistoryDate(order) && (
                      <span className="text-gray-400 tabular-nums mr-2">{formatHistoryDate(order)}</span>
                    )}
                    {orderLabel(order)} - {order.customerName}
                  </span>
                  <div className="flex items-center gap-2">
                    {refundBadge(order) && (
                      <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700">{refundBadge(order)}</span>
                    )}
                    <span className={`px-2 py-0.5 rounded text-xs ${getStatusLabel(order.status, order.cancelType, order.cancelledAmount, order.refundedAmount).color}`}>
                      {getStatusLabel(order.status, order.cancelType, order.cancelledAmount, order.refundedAmount).text}
                    </span>
                    {getStatusLabel(order.status, order.cancelType, order.cancelledAmount, order.refundedAmount).refundDone && (
                      <button onClick={() => openRefundDetails(order)}
                        className="text-xs font-semibold text-purple-700 underline hover:text-purple-900">
                        détails
                      </button>
                    )}
                    {canRefund(order) && (
                      <button
                        onClick={() => setRefundTarget(order)}
                        className="text-purple-700 hover:text-purple-900 font-semibold inline-flex items-center gap-1"
                      >
                        <Icon name="refund" /> Rembourser
                      </button>
                    )}
                    <OrderKebab order={order} />
                  </div>
                </div>
              ))}
            </div>
            {historyOrders.length > 0 && (
              <Pagination page={historySafePage} totalPages={historyTotalPages} setPage={setHistoryPage} />
            )}
          </div>
        </div>
        )}

        {activeTab === 'ingredients' && (
            <div>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold">Gestion des Ingrédients</h2>
                        <p className="text-sm text-gray-500 mt-1">Cliquez sur un ingrédient pour le désactiver/activer. Utilisez pour modifier.</p>
                    </div>
                    <button
                        onClick={openCreateIngredientModal}
                        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                    >
                        <Icon name="add" className="w-5 h-5 inline" />
                        Nouvel Ingrédient
                    </button>
                </div>

                <ListToolbar
                    query={ingredientControls.query} setQuery={ingredientControls.setQuery}
                    sortOrder={ingredientControls.sortOrder} setSortOrder={ingredientControls.setSortOrder}
                    total={ingredientControls.total} placeholder="Rechercher un ingrédient…"
                    rightSlot={<ViewToggle view={ingredientView} setView={setIngredientView} />} />

                {ingredientView === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {ingredientControls.pageItems.map(ing => (
                        <div key={ing._id} className={`flex flex-col ${ing.isAvailable ? '' : 'opacity-60'}`}>
                            <div {...clickable(() => openEditIngredientModal(ing))}
                                className="cursor-pointer bg-white rounded-2xl border border-gray-100 shadow-soft hover:shadow-xl hover:-translate-y-1 transition-all overflow-hidden">
                                <div className="h-40 bg-gray-50">
                                    {ing.image ? (
                                        <img src={getImageUrl(ing.image)} alt={ing.name} className="w-full h-full object-cover"
                                            onError={(e) => e.target.style.display = 'none'} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl"><Icon name="avocado" /></div>
                                    )}
                                </div>
                                <div className="p-4">
                                    <h3 className="font-bold text-gray-800 truncate">{ing.name}</h3>
                                    <p className="text-xs text-gray-500 capitalize">{ing.category?.replace('_', ' ')}</p>
                                </div>
                            </div>
                            <div className="flex items-center justify-between mt-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className={`text-sm font-bold ${ing.isAvailable ? 'text-green-700' : 'text-gray-400'}`}>
                                    {ing.isAvailable ? 'Disponible' : 'Indisponible'}
                                </span>
                                <button
                                    onClick={() => toggleIngredientAvailability(ing)}
                                    title={ing.isAvailable ? 'Désactiver' : 'Activer'}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shadow-inner ${ing.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${ing.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                ) : (
                    <div className="overflow-x-auto bg-white rounded-lg shadow">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photo</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nom</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Catégorie</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dispo</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {ingredientControls.pageItems.map(ing => (
                                    <tr key={ing._id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            {ing.image ? (
                                                <img src={getImageUrl(ing.image)} alt={ing.name} className="w-12 h-12 rounded object-cover" />
                                            ) : (
                                                <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center text-xs text-gray-500">—</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-medium text-wood">{ing.name}</td>
                                        <td className="px-4 py-3 text-xs text-stone-600 capitalize">{ing.category?.replace('_', ' ')}</td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => toggleIngredientAvailability(ing)}
                                                title={ing.isAvailable ? 'Désactiver' : 'Activer'}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${ing.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${ing.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm whitespace-nowrap">
                                            <button onClick={() => openEditIngredientModal(ing)} className="text-brand-700 hover:text-brand-900 mr-3"><Icon name="edit" className="w-4 h-4 inline mr-1" />Modifier</button>
                                            <button onClick={() => handleDeleteIngredient(ing._id)} className="text-red-600 hover:text-red-800"><Icon name="trash" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <Pagination page={ingredientControls.page} totalPages={ingredientControls.totalPages} setPage={ingredientControls.setPage} />
            </div>
        )}

        {activeTab === 'menus' && (
            <div>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold">Gestion des Menus</h2>
                        <p className="text-sm text-gray-500 mt-1">Gérez les formules menu avec suppléments</p>
                    </div>
                    <button
                        onClick={openCreateMenuModal}
                        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                    >
                        <Icon name="add" className="w-5 h-5 inline" />
                        Nouveau Menu
                    </button>
                </div>

                <ListToolbar
                    query={menuControls.query} setQuery={menuControls.setQuery}
                    sortOrder={menuControls.sortOrder} setSortOrder={menuControls.setSortOrder}
                    total={menuControls.total} placeholder="Rechercher un menu…"
                    rightSlot={<ViewToggle view={menuView} setView={setMenuView} />} />

                {menuView === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {menuControls.pageItems.map(menu => (
                        <div key={menu._id} className={`flex flex-col ${menu.isAvailable ? '' : 'opacity-60'}`}>
                            <div {...clickable(() => openEditMenuModal(menu))}
                                className="cursor-pointer bg-white rounded-2xl border border-gray-100 shadow-soft hover:shadow-xl hover:-translate-y-1 transition-all overflow-hidden">
                                <div className="h-40 bg-gray-50">
                                    {menu.image ? (
                                        <img src={getImageUrl(menu.image)} alt={menu.name} className="w-full h-full object-cover"
                                            onError={(e) => e.target.style.display = 'none'} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl"><Icon name="menu-dish" /></div>
                                    )}
                                </div>
                                <div className="p-4">
                                    <h3 className="font-bold text-gray-800">{menu.name}</h3>
                                    <p className="text-sm text-brand-600 font-semibold mt-1">Supplément +{(menu.price_addition || 0).toFixed(2)}€</p>
                                    <div className="flex gap-1 mt-2 text-xs">
                                        {menu.includes?.drink && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded flex items-center gap-1"><Icon name="drink" /> Boisson</span>}
                                        {menu.includes?.dessert && <span className="bg-pink-100 text-pink-700 px-2 py-0.5 rounded flex items-center gap-1"><Icon name="dessert" /> Dessert</span>}
                                        {menu.includes?.side && <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">Accomp.</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between mt-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className={`text-sm font-bold ${menu.isAvailable ? 'text-green-700' : 'text-gray-400'}`}>
                                    {menu.isAvailable ? 'Disponible' : 'Indisponible'}
                                </span>
                                <button
                                    onClick={() => toggleMenuAvailability(menu)}
                                    title={menu.isAvailable ? 'Désactiver' : 'Activer'}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shadow-inner ${menu.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}>
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${menu.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                ) : (
                    <div className="overflow-x-auto bg-white rounded-lg shadow">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photo</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nom</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplément</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Inclus</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dispo</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {menuControls.pageItems.map(menu => (
                                    <tr key={menu._id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            {menu.image ? (
                                                <img src={getImageUrl(menu.image)} alt={menu.name} className="w-12 h-12 rounded object-cover" />
                                            ) : (
                                                <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center text-xs text-gray-500">—</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-medium text-wood">{menu.name}</td>
                                        <td className="px-4 py-3 text-sm text-wood">+{(menu.price_addition || 0).toFixed(2)} €</td>
                                        <td className="px-4 py-3 text-base">
                                            {menu.includes?.drink && <span title="Boisson" className="mr-1 inline-flex"><Icon name="drink" /></span>}
                                            {menu.includes?.dessert && <span title="Dessert" className="mr-1 inline-flex"><Icon name="dessert" /></span>}
                                            {menu.includes?.side && <span title="Accompagnement" className="inline-flex"><Icon name="side" /></span>}
                                            {!menu.includes?.drink && !menu.includes?.dessert && !menu.includes?.side && <span className="text-gray-400 text-xs">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => toggleMenuAvailability(menu)}
                                                title={menu.isAvailable ? 'Désactiver' : 'Activer'}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${menu.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${menu.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm whitespace-nowrap">
                                            <button onClick={() => openEditMenuModal(menu)} className="text-brand-700 hover:text-brand-900 mr-3"><Icon name="edit" className="w-4 h-4 inline mr-1" />Modifier</button>
                                            <button onClick={() => handleDeleteMenu(menu._id)} className="text-red-600 hover:text-red-800"><Icon name="trash" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <Pagination page={menuControls.page} totalPages={menuControls.totalPages} setPage={menuControls.setPage} />
            </div>

        )}

        {activeTab === 'formules' && (
            <div>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold">Gestion des Salades</h2>
                        <p className="text-sm text-gray-500 mt-1">Gérez les salades à composer</p>
                    </div>
                    <button
                        onClick={openCreateFormulaModal}
                        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                    >
                        <Icon name="add" className="w-5 h-5 inline" />
                        Nouvelle salade
                    </button>
                </div>

                <ListToolbar
                    query={formulaControls.query} setQuery={formulaControls.setQuery}
                    sortOrder={formulaControls.sortOrder} setSortOrder={formulaControls.setSortOrder}
                    total={formulaControls.total} placeholder="Rechercher une formule…"
                    rightSlot={<ViewToggle view={formulaView} setView={setFormulaView} />} />

                {formulaView === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {formulaControls.pageItems.map(formula => (
                        <div key={formula._id} className={`flex flex-col ${formula.isAvailable ? '' : 'opacity-60'}`}>
                            <div {...clickable(() => openEditFormulaModal(formula))}
                                className="cursor-pointer bg-white rounded-2xl border border-gray-100 shadow-soft hover:shadow-xl hover:-translate-y-1 transition-all overflow-hidden">
                                <div className="h-40 bg-gray-50">
                                    {formula.image ? (
                                        <img src={getImageUrl(formula.image)} alt={formula.name} className="w-full h-full object-cover"
                                            onError={(e) => e.target.style.display = 'none'} />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl"><Icon name="salad" /></div>
                                    )}
                                </div>
                                <div className="p-4">
                                    <h3 className="font-bold text-gray-800">{formula.name}</h3>
                                    <p className="text-sm text-brand-600 font-semibold mt-1">{(formula.base_price || 0).toFixed(2)}€</p>
                                    <div className="flex flex-wrap gap-1 mt-2 text-xs">
                                        {formula.limits?.base > 0 && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Base: {formula.limits.base}</span>}
                                        {formula.limits?.protein > 0 && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Prot: {formula.limits.protein}</span>}
                                        {formula.limits?.topping > 0 && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded">Top: {formula.limits.topping}</span>}
                                        {formula.limits?.sauce > 0 && <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">Sauce: {formula.limits.sauce}</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between mt-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
                                <span className={`text-sm font-bold ${formula.isAvailable ? 'text-green-700' : 'text-gray-400'}`}>
                                    {formula.isAvailable ? 'Disponible' : 'Indisponible'}
                                </span>
                                <button
                                    onClick={() => toggleFormulaAvailability(formula)}
                                    title={formula.isAvailable ? 'Désactiver' : 'Activer'}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shadow-inner ${formula.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}>
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${formula.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                ) : (
                    <div className="overflow-x-auto bg-white rounded-lg shadow">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photo</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nom</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prix de base</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dispo</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {formulaControls.pageItems.map(formula => (
                                    <tr key={formula._id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            {formula.image ? (
                                                <img src={getImageUrl(formula.image)} alt={formula.name} className="w-12 h-12 rounded object-cover" />
                                            ) : (
                                                <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center text-xs text-gray-500">—</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-medium text-wood">{formula.name}</td>
                                        <td className="px-4 py-3 text-sm text-wood">{(formula.base_price || 0).toFixed(2)} €</td>
                                        <td className="px-4 py-3 text-xs text-stone-600 capitalize">{formula.type || 'Salade'}</td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => toggleFormulaAvailability(formula)}
                                                title={formula.isAvailable ? 'Désactiver' : 'Activer'}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formula.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${formula.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm whitespace-nowrap">
                                            <button onClick={() => openEditFormulaModal(formula)} className="text-brand-700 hover:text-brand-900 mr-3"><Icon name="edit" className="w-4 h-4 inline mr-1" />Modifier</button>
                                            <button onClick={() => handleDeleteFormula(formula._id)} className="text-red-600 hover:text-red-800"><Icon name="trash" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <Pagination page={formulaControls.page} totalPages={formulaControls.totalPages} setPage={formulaControls.setPage} />
            </div>

        )}

        {activeTab === 'produits' && (
            <div>
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2"><Icon name="products" /> Gestion des Articles</h2>
                        <p className="text-sm text-gray-500 mt-1">Gérez les boissons, cafés, desserts et salés</p>
                    </div>
                    <button
                        onClick={openCreateProductModal}
                        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                    >
                        <Icon name="add" className="w-5 h-5 inline" />
                        Nouvel Article
                    </button>
                </div>

                <ListToolbar
                    query={productControls.query} setQuery={productControls.setQuery}
                    sortOrder={productControls.sortOrder} setSortOrder={productControls.setSortOrder}
                    total={productControls.total} placeholder="Rechercher un article…"
                    rightSlot={
                        <div className="flex flex-wrap items-center gap-2">
                            {PRODUCT_CATEGORIES.map(cat => (
                                <button
                                    key={cat.key}
                                    onClick={() => toggleProductCatFilter(cat.key)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 ${
                                        productCatFilter.includes(cat.key)
                                            ? 'bg-brand-600 text-white border-brand-600'
                                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                    }`}
                                >
                                    <Icon name={cat.icon} /> {cat.label}
                                </button>
                            ))}
                            <ViewToggle view={productView} setView={setProductView} />
                        </div>
                    } />

                {productView === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {productControls.pageItems.map(product => (
                            <div
                                key={product._id}
                                className={`flex flex-col ${product.isAvailable ? '' : 'opacity-60'}`}
                            >
                                <div className="h-56">
                                    <ProductCard
                                        product={product}
                                        isSelected={false}
                                        onClick={() => openEditProductModal(product)}
                                    />
                                </div>
                                <div className="flex items-center justify-between mt-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100">
                                    <span className={`text-sm font-bold ${product.isAvailable ? 'text-green-700' : 'text-gray-400'}`}>
                                        {product.isAvailable ? 'Disponible' : 'Indisponible'}
                                    </span>
                                    <button
                                        onClick={() => toggleProductAvailability(product)}
                                        title={product.isAvailable ? 'Désactiver' : 'Activer'}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none shadow-inner ${product.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${product.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="overflow-x-auto bg-white rounded-lg shadow">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photo</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nom</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Catégorie</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prix</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dispo</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {productControls.pageItems.map(product => (
                                    <tr key={product._id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            {product.image ? (
                                                <img src={getImageUrl(product.image)} alt={product.name} className="w-12 h-12 rounded object-cover" />
                                            ) : (
                                                <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center text-xs text-gray-500">—</div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm font-medium text-wood">{product.name}</td>
                                        <td className="px-4 py-3 text-xs text-stone-600">{(PRODUCT_CATEGORIES.find(c => c.key === product.category)?.label) || product.category}</td>
                                        <td className="px-4 py-3 text-sm text-wood">{(product.price || 0).toFixed(2)} €</td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => toggleProductAvailability(product)}
                                                title={product.isAvailable ? 'Désactiver' : 'Activer'}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${product.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${product.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm">
                                            <button onClick={() => openEditProductModal(product)} className="text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"><Icon name="edit" /> Modifier</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <Pagination page={productControls.page} totalPages={productControls.totalPages} setPage={productControls.setPage} />
            </div>
        )}
      </div>

      {/* ====== ONGLET PLATS CHAUDS ====== */}
      {activeTab === 'dishes' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-wood">Plats Chauds</h2>
            <button
              onClick={openCreateDishModal}
              className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
            >
              <Icon name="add" className="w-5 h-5 inline" />
              Nouveau plat
            </button>
          </div>

          <ListToolbar
            query={dishControls.query} setQuery={dishControls.setQuery}
            sortOrder={dishControls.sortOrder} setSortOrder={dishControls.setSortOrder}
            total={dishControls.total} placeholder="Rechercher un plat…"
            rightSlot={<ViewToggle view={dishView} setView={setDishView} />} />

          {dishView === 'table' ? (
            <div className="overflow-x-auto bg-white rounded-lg shadow">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Photo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nom</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prix</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Accompagnements</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Max</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tags</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dispo</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dishControls.pageItems.map(dish => (
                    <tr key={dish._id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {dish.image ? (
                          <img src={getImageUrl(dish.image)} alt={dish.name} className="w-12 h-12 rounded object-cover" />
                        ) : (
                          <div className="w-12 h-12 rounded bg-gray-200 flex items-center justify-center text-xs text-gray-500">—</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-wood">{dish.name}</td>
                      <td className="px-4 py-3 text-sm text-wood">{dish.price.toFixed(2)} €</td>
                      <td className="px-4 py-3 text-xs text-stone-600">{(dish.sides || []).length} option(s)</td>
                      <td className="px-4 py-3 text-sm text-wood">{dish.maxSides}</td>
                      <td className="px-4 py-3 text-xs">
                        {(dish.dietaryTags || []).map(tag => (
                          <span key={tag} className="inline-block mr-1 mb-1 px-2 py-0.5 bg-brand-100 text-brand-700 rounded">{tag}</span>
                        ))}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleDishAvailability(dish)}
                          title={dish.isAvailable ? 'Désactiver' : 'Activer'}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${dish.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${dish.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right text-sm">
                        <button onClick={() => openEditDishModal(dish)} className="text-brand-700 hover:text-brand-900 mr-3"><Icon name="edit" className="w-4 h-4 inline mr-1" />Modifier</button>
                        <button onClick={() => handleDeleteDish(dish._id)} className="text-cherry hover:text-cherry/70"><Icon name="trash" className="w-4 h-4 inline" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dishes.length === 0 && (
                <div className="text-center py-12 text-stone-500">
                  Aucun plat chaud. Cliquez sur "+ Nouveau plat" pour commencer.
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {dishControls.pageItems.map(dish => (
                <div key={dish._id} className={`flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden ${dish.isAvailable ? '' : 'opacity-60'}`}>
                  <div className="h-40 bg-gray-50">
                    {dish.image ? (
                      <img src={getImageUrl(dish.image)} alt={dish.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl"><Icon name="dish" /></div>
                    )}
                  </div>
                  <div className="p-4 flex flex-col flex-grow">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-bold text-wood">{dish.name}</h3>
                      <span className="font-mono font-bold text-wood">{dish.price.toFixed(2)} €</span>
                    </div>
                    <p className="text-xs text-stone-500 mb-2">{(dish.sides || []).length} accompagnement(s) • max {dish.maxSides}</p>
                    {(dish.dietaryTags || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {dish.dietaryTags.map(tag => (
                          <span key={tag} className="px-2 py-0.5 bg-brand-100 text-brand-700 rounded text-xs">{tag}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-gray-100">
                      <button
                        onClick={() => toggleDishAvailability(dish)}
                        title={dish.isAvailable ? 'Désactiver' : 'Activer'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${dish.isAvailable ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${dish.isAvailable ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                      <div className="text-sm">
                        <button onClick={() => openEditDishModal(dish)} className="text-brand-700 hover:text-brand-900 mr-3"><Icon name="edit" /></button>
                        <button onClick={() => handleDeleteDish(dish._id)} className="text-cherry hover:text-cherry/70"><Icon name="trash" /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Pagination page={dishControls.page} totalPages={dishControls.totalPages} setPage={dishControls.setPage} />
        </div>
      )}

      {activeTab === 'bubbletea' && <BubbleTeaManager />}
        {activeTab === 'milkshake' && <MilkshakeManager />}
        {activeTab === 'product-cats' && <ProductCategoryManager />}

      {/* MODAL CRÉATION/ÉDITION INGRÉDIENT */}
      {showIngredientModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white text-gray-800 p-6 rounded-t-lg border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">
                  {editingIngredient ? 'Modifier l\'ingrédient' : 'Nouvel Ingrédient'}
                </h3>
                <button
                  onClick={closeIngredientModal}
                  className="text-gray-400 hover:text-gray-600 text-3xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6">
              
              {/* Upload d'image */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Image de l'ingrédient
                </label>
                
                {/* Prévisualisation */}
                {imagePreview && (
                  <div className="mb-4">
                    <img 
                      src={imagePreview} 
                      alt="Aperçu" 
                      className="w-40 h-40 object-cover rounded-lg border-2 border-purple-200 shadow-md"
                    />
                  </div>
                )}

                {/* Input file */}
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer bg-purple-100 hover:bg-purple-200 text-purple-700 px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2">
                    <span>{uploadingImage ? 'Upload...' : 'Choisir une image'}</span>
                    <input 
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                      className="hidden"
                    />
                  </label>
                  <span className="text-xs text-gray-500">JPEG, PNG, GIF, WEBP (5 MB max)</span>
                </div>

                {/* URL manuelle (optionnel) */}
                <div className="mt-3">
                  <input
                    type="text"
                    placeholder="Ou collez une URL d'image"
                    value={ingredientForm.image}
                    onChange={(e) => {
                      handleIngredientFormChange('image', e.target.value);
                      setImagePreview(e.target.value);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Nom */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Nom de l'ingrédient *
                </label>
                <input
                  type="text"
                  value={ingredientForm.name}
                  onChange={(e) => handleIngredientFormChange('name', e.target.value)}
                  placeholder="Ex: Mangue, Saumon, Avocat..."
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Catégorie */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Catégorie *
                </label>
                <select
                  value={ingredientForm.category}
                  onChange={(e) => handleIngredientFormChange('category', e.target.value)}
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <optgroup label="Salades">
                    <option value="base_salade">Base Salade</option>
                    <option value="proteine">Protéine</option>
                    <option value="topping_legume">Topping Légume</option>
                    <option value="topping_fruit">Topping Fruit</option>
                    <option value="sauce">Sauce</option>
                  </optgroup>
                </select>
              </div>

              {/* Premium & Prix */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ingredientForm.is_premium}
                      onChange={(e) => handleIngredientFormChange('is_premium', e.target.checked)}
                      className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <span className="text-sm font-bold text-gray-700">Premium</span>
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Prix supplémentaire (€)
                  </label>
                  <input
                    type="number"
                    step="0.10"
                    value={ingredientForm.extra_price}
                    onChange={(e) => handleIngredientFormChange('extra_price', parseFloat(e.target.value) || 0)}
                    className="w-full border rounded-lg px-4 py-2"
                    min="0"
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Tags (séparés par des virgules)
                </label>
                <input
                  type="text"
                  placeholder="Ex: sucré, croquant, frais"
                  value={ingredientForm.tags.join(', ')}
                  onChange={(e) => handleIngredientFormChange('tags', e.target.value.split(',').map(t => t.trim()).filter(t => t))}
                  className="w-full border rounded-lg px-4 py-2"
                />
              </div>

              {/* Infos nutritionnelles (optionnel) */}
              <details className="bg-gray-50 p-4 rounded-lg">
                <summary className="cursor-pointer font-bold text-gray-700 mb-2">
                  Informations nutritionnelles (optionnel)
                </summary>
                {!editingIngredient && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 mt-3">
                    <p className="text-xs text-blue-700 flex items-start gap-2">
                      <Icon name="ai" className="w-4 h-4 inline" />
                      <span>
                        <strong>Auto-complétion intelligente :</strong> Si vous laissez ces champs vides, 
                        les informations nutritionnelles seront automatiquement recherchées et remplies 
                        lors de la création de l'ingrédient.
                      </span>
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Calories (kcal)</label>
                    <input
                      type="number"
                      value={ingredientForm.nutritional_info.calories}
                      onChange={(e) => handleIngredientFormChange('nutritional_info', {
                        ...ingredientForm.nutritional_info,
                        calories: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Protéines (g)</label>
                    <input
                      type="number"
                      value={ingredientForm.nutritional_info.proteins}
                      onChange={(e) => handleIngredientFormChange('nutritional_info', {
                        ...ingredientForm.nutritional_info,
                        proteins: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Glucides (g)</label>
                    <input
                      type="number"
                      value={ingredientForm.nutritional_info.carbs}
                      onChange={(e) => handleIngredientFormChange('nutritional_info', {
                        ...ingredientForm.nutritional_info,
                        carbs: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Lipides (g)</label>
                    <input
                      type="number"
                      value={ingredientForm.nutritional_info.fat}
                      onChange={(e) => handleIngredientFormChange('nutritional_info', {
                        ...ingredientForm.nutritional_info,
                        fat: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                </div>
              </details>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 p-6 rounded-b-lg border-t flex justify-end gap-3">
              <button
                onClick={closeIngredientModal}
                className="px-6 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 transition"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveIngredient}
                className="px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold transition"
              >
                {editingIngredient ? 'Mettre à jour' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRÉATION/ÉDITION PRODUIT */}
      {showProductModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white text-gray-800 p-6 rounded-t-lg border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">
                  {editingProduct ? "Modifier l'article" : 'Nouvel Article'}
                </h3>
                <button
                  onClick={closeProductModal}
                  className="text-gray-400 hover:text-gray-600 text-3xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6">
              
              {/* Upload d'image */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Image de l'article
                </label>
                
                {productImagePreview && (
                  <div className="mb-4">
                    <img 
                      src={productImagePreview} 
                      alt="Aperçu" 
                      className="w-40 h-40 object-cover rounded-lg border-2 border-blue-200 shadow-md"
                    />
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <label className="cursor-pointer bg-blue-100 hover:bg-blue-200 text-blue-700 px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2">
                    <span>{uploadingProductImage ? 'Upload...' : 'Choisir une image'}</span>
                    <input 
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                      onChange={handleProductImageUpload}
                      disabled={uploadingProductImage}
                      className="hidden"
                    />
                  </label>
                  <span className="text-xs text-gray-500">JPEG, PNG, GIF, WEBP (10 MB max)</span>
                </div>

                <div className="mt-3">
                  <input
                    type="text"
                    placeholder="Ou collez une URL d'image"
                    value={productForm.image}
                    onChange={(e) => {
                      handleProductFormChange('image', e.target.value);
                      setProductImagePreview(e.target.value);
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Nom */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Nom de l'article *
                </label>
                <input
                  type="text"
                  value={productForm.name}
                  onChange={(e) => handleProductFormChange('name', e.target.value)}
                  placeholder="Ex: Coca Cola, Tiramisu..."
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Catégorie */}
              <div>
                <label className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                  <Icon name="category" /> Catégorie *
                </label>
                <select
                  value={productForm.category}
                  onChange={(e) => setProductForm(prev => ({ ...prev, category: e.target.value, categoryId: null }))}
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="drink">Boissons</option>
                  <option value="coffee">Cafés</option>
                  <option value="dessert">Desserts</option>
                  <option value="side">Salés</option>
                </select>
              </div>

              {/* Sous-catégorie (arbre du gérant, optionnelle) */}
              <div>
                <label className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                  <Icon name="category" /> Sous-catégorie
                </label>
                <select
                  value={productForm.categoryId || ''}
                  onChange={(e) => handleProductFormChange('categoryId', e.target.value || null)}
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">(Non classé)</option>
                  {productCategoryOptions.map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                {productCategoryOptions.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    Aucune catégorie pour cette section. Créez-en dans l'onglet « Catégories ».
                  </p>
                )}
              </div>

              {/* Prix */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Prix (€) *
                  </label>
                  <input
                    type="number"
                    step="0.10"
                    value={productForm.price}
                    onChange={(e) => handleProductFormChange('price', parseFloat(e.target.value) || 0)}
                    className="w-full border rounded-lg px-4 py-2"
                    min="0"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Supplément menu (€)
                  </label>
                  <input
                    type="number"
                    step="0.10"
                    value={productForm.menu_surcharge}
                    onChange={(e) => handleProductFormChange('menu_surcharge', parseFloat(e.target.value) || 0)}
                    className="w-full border rounded-lg px-4 py-2"
                    min="0"
                  />
                </div>
              </div>

              {/* Infos nutritionnelles */}
              <details className="bg-gray-50 p-4 rounded-lg">
                <summary className="cursor-pointer font-bold text-gray-700 mb-2">
                  Informations nutritionnelles (optionnel)
                </summary>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Calories (kcal)</label>
                    <input
                      type="number"
                      value={productForm.nutritional_info.calories}
                      onChange={(e) => handleProductFormChange('nutritional_info', {
                        ...productForm.nutritional_info,
                        calories: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Protéines (g)</label>
                    <input
                      type="number"
                      value={productForm.nutritional_info.proteins}
                      onChange={(e) => handleProductFormChange('nutritional_info', {
                        ...productForm.nutritional_info,
                        proteins: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Glucides (g)</label>
                    <input
                      type="number"
                      value={productForm.nutritional_info.carbs}
                      onChange={(e) => handleProductFormChange('nutritional_info', {
                        ...productForm.nutritional_info,
                        carbs: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Lipides (g)</label>
                    <input
                      type="number"
                      value={productForm.nutritional_info.fat}
                      onChange={(e) => handleProductFormChange('nutritional_info', {
                        ...productForm.nutritional_info,
                        fat: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border rounded px-3 py-1 text-sm"
                      min="0"
                    />
                  </div>
                </div>
              </details>

              {/* Suppléments / Extras (facultatif) */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-bold text-gray-700">Suppléments / Extras (facultatif)</p>
                    <p className="text-xs text-gray-500">Le client pourra les ajouter à cet article (boutique &amp; caisse).</p>
                  </div>
                  <button
                    type="button"
                    onClick={addProductExtra}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold transition"
                  >
                    <Icon name="add" /> Ajouter
                  </button>
                </div>
                {(productForm.extras || []).length === 0 ? (
                  <p className="text-sm text-gray-400 italic">Aucun supplément.</p>
                ) : (
                  <div className="space-y-2">
                    {(productForm.extras || []).map((extra, index) => (
                      <div key={extra.id || index} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={extra.name}
                          onChange={(e) => updateProductExtra(index, 'name', e.target.value)}
                          placeholder="Nom (ex: Chantilly)"
                          className="flex-grow border rounded-lg px-3 py-2 text-sm"
                        />
                        <div className="relative w-28 shrink-0">
                          <input
                            type="number"
                            step="0.10"
                            min="0"
                            value={extra.price}
                            onChange={(e) => updateProductExtra(index, 'price', parseFloat(e.target.value) || 0)}
                            className="w-full border rounded-lg pl-3 pr-7 py-2 text-sm"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeProductExtra(index)}
                          className="p-2 text-red-500 hover:text-red-700 transition"
                          aria-label="Retirer le supplément"
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 p-6 rounded-b-lg border-t flex justify-end gap-3">
              <button
                onClick={closeProductModal}
                className="px-6 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 transition"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveProduct}
                className="px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold transition"
              >
                {editingProduct ? 'Mettre à jour' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRÉATION/ÉDITION MENU */}
      {showMenuModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="bg-white text-gray-800 p-6 rounded-t-lg border-b border-gray-200 shrink-0">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">
                  {editingMenu ? 'Modifier le menu' : 'Nouveau Menu'}
                </h3>
                <button
                  onClick={closeMenuModal}
                  className="text-gray-400 hover:text-gray-600 text-3xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1">

              {/* Upload d'image */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Image du menu</label>
                {menuImagePreview && (
                  <div className="mb-4">
                    <img src={menuImagePreview} alt="Aperçu" className="w-40 h-40 object-cover rounded-lg border-2 border-orange-200 shadow-md" />
                  </div>
                )}
                <label className="cursor-pointer bg-orange-100 hover:bg-orange-200 text-orange-700 px-4 py-2 rounded-lg font-semibold transition inline-flex items-center gap-2">
                  <span>{uploadingMenuImage ? 'Upload...' : 'Choisir une image'}</span>
                  <input type="file" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                    onChange={handleMenuImageUpload} disabled={uploadingMenuImage} className="hidden" />
                </label>
                <span className="text-xs text-gray-500 ml-2">JPEG, PNG, GIF, WEBP (10 MB max)</span>
              </div>

              {/* Nom */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Nom du menu *
                </label>
                <input
                  type="text"
                  value={menuForm.name}
                  onChange={(e) => handleMenuFormChange('name', e.target.value)}
                  placeholder="Ex: Menu M, Menu L, Menu XL..."
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Prix additionnel */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Prix additionnel (€) *
                </label>
                <input
                  type="number"
                  step="0.10"
                  value={menuForm.price_addition}
                  onChange={(e) => handleMenuFormChange('price_addition', parseFloat(e.target.value) || 0)}
                  className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  min="0"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Montant ajouté au prix de base de la formule</p>
              </div>

              {/* Ce que comprend le menu */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-3">
                  Ce menu comprend :
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'drink', label: 'Boisson' },
                    { key: 'dessert', label: 'Dessert' },
                    { key: 'or', label: 'Boisson OU dessert' },
                    { key: 'and', label: 'Boisson ET dessert' },
                  ].map(opt => (
                    <label key={opt.key}
                      className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-all ${menuForm.mode === opt.key ? 'border-brand-600 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input
                        type="radio"
                        name="menuMode"
                        checked={menuForm.mode === opt.key}
                        onChange={() => handleMenuFormChange('mode', opt.key)}
                        className="w-4 h-4 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="font-medium text-sm">{opt.label}</span>
                    </label>
                  ))}
                </div>
                {menuForm.mode === 'or' && (
                  <p className="text-xs text-gray-500 mt-2">Le client prend un seul article parmi les boissons et desserts cochés.</p>
                )}
                {menuForm.mode === 'and' && (
                  <p className="text-xs text-gray-500 mt-2">Le client prend une boisson et un dessert parmi ceux cochés.</p>
                )}
              </div>

              {/* Articles proposés — affichés selon le choix ci-dessus */}
              {menuForm.mode && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Articles proposés
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Coche les articles que le client pourra choisir dans ce menu.
                  </p>
                  {['drink', 'dessert']
                    .filter(cat => cat === 'drink'
                      ? ['drink', 'or', 'and'].includes(menuForm.mode)
                      : ['dessert', 'or', 'and'].includes(menuForm.mode))
                    .map(cat => (
                    <div key={cat} className="mb-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                        {cat === 'drink' ? 'Boissons' : 'Desserts'}
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {products.filter(p => p.category === cat).map(p => (
                          <label key={p._id} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={(menuForm.allowedProductIds || []).includes(p._id)}
                              onChange={() => toggleAllowedProduct(p._id)}
                              className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-gray-50 p-6 rounded-b-lg border-t flex justify-end gap-3 shrink-0">
              <button
                onClick={closeMenuModal}
                className="px-6 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 transition"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveMenu}
                className="px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold transition"
              >
                {editingMenu ? 'Mettre à jour' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GESTION FORMULE */}
      {showFormulaModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full my-8">
            {/* Header */}
            <div className="bg-white text-gray-800 p-6 rounded-t-lg border-b border-gray-200">
              <h3 className="text-2xl font-bold">
                {editingFormula ? 'Modifier la formule' : 'Nouvelle formule'}
              </h3>
              <p className="text-gray-500 text-sm mt-1">
                {editingFormula ? 'Modifiez les informations de la formule' : 'Créez une nouvelle formule'}
              </p>
            </div>

            {/* Body */}
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              
              {/* Ligne 1: Nom et Type */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Nom de la formule *
                  </label>
                  <input
                    type="text"
                    value={formulaForm.name}
                    onChange={(e) => handleFormulaFormChange('name', e.target.value)}
                    placeholder="Ex: Standard, Medium, Big..."
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Type *
                  </label>
                  <select
                    value={formulaForm.type}
                    onChange={(e) => handleFormulaFormChange('type', e.target.value)}
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    required
                  >
                    <option value="salad">Salade</option>
                  </select>
                </div>
              </div>

              {/* Ligne 2: Prix et Coût extra */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Prix de base (€) *
                  </label>
                  <input
                    type="number"
                    step="0.10"
                    value={formulaForm.base_price}
                    onChange={(e) => handleFormulaFormChange('base_price', parseFloat(e.target.value) || 0)}
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    min="0"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Coût par composant extra (€)
                  </label>
                  <input
                    type="number"
                    step="0.10"
                    value={formulaForm.extra_cost_per_component}
                    onChange={(e) => handleFormulaFormChange('extra_cost_per_component', parseFloat(e.target.value) || 0)}
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    min="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">Prix pour chaque ingrédient supplémentaire</p>
                </div>
              </div>

              {/* Image */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  Image de la formule
                </label>
                
                {formulaImagePreview && (
                  <div className="mb-3">
                    <img 
                      src={formulaImagePreview.startsWith('http') ? formulaImagePreview : `${import.meta.env.VITE_API_URL}${formulaImagePreview}`}
                      alt="Aperçu"
                      className="w-full h-48 object-cover rounded-lg border"
                    />
                  </div>
                )}

                {!editingFormula && (
                  <p className="text-sm text-yellow-600 mb-2 bg-yellow-50 p-3 rounded border border-yellow-200">
                    Vous devez d'abord créer la formule avant de pouvoir uploader une image.
                  </p>
                )}

                {editingFormula && (
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFormulaImageUpload}
                      disabled={uploadingFormulaImage}
                      className="flex-1 border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                    {uploadingFormulaImage && (
                      <span className="text-sm text-brand-600 font-semibold">Upload en cours...</span>
                    )}
                  </div>
                )}

                {!editingFormula && (
                  <input
                    type="text"
                    value={formulaForm.image}
                    onChange={(e) => handleFormulaFormChange('image', e.target.value)}
                    placeholder="URL de l'image (Unsplash, etc.)"
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  />
                )}
              </div>

              {/* Limites - Salade */}
              {(formulaForm.type === 'salad' || formulaForm.type === 'combo') && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <h4 className="font-bold text-green-800 mb-3 flex items-center gap-2">
                    <span>Limites Salade</span>
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Bases</label>
                      <input
                        type="number"
                        value={formulaForm.limits.base || 0}
                        onChange={(e) => handleFormulaLimitChange('base', e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Protéines</label>
                      <input
                        type="number"
                        value={formulaForm.limits.protein || 0}
                        onChange={(e) => handleFormulaLimitChange('protein', e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Toppings</label>
                      <input
                        type="number"
                        value={formulaForm.limits.topping || 0}
                        onChange={(e) => handleFormulaLimitChange('topping', e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Sauces</label>
                      <input
                        type="number"
                        value={formulaForm.limits.sauce || 0}
                        onChange={(e) => handleFormulaLimitChange('sauce', e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm"
                        min="0"
                      />
                    </div>
                  </div>
                </div>
              )}


              {/* Disponibilité */}
              <div>
                <label className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formulaForm.isAvailable}
                    onChange={(e) => handleFormulaFormChange('isAvailable', e.target.checked)}
                    className="w-5 h-5 text-brand-600 rounded focus:ring-brand-500"
                  />
                  <span className="font-medium">Formule disponible à la vente</span>
                </label>
              </div>

            </div>

            {/* Footer */}
            <div className="bg-gray-50 p-6 rounded-b-lg border-t flex justify-end gap-3">
              <button
                onClick={closeFormulaModal}
                className="px-6 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 transition"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveFormula}
                className="px-6 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold transition"
              >
                {editingFormula ? 'Mettre à jour' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL DE CONFIRMATION GLOBALE */}
      <ConfirmModal
        isOpen={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />

      {/* MODAL DE REMBOURSEMENT */}
      {refundTarget && (
        <RefundModal
          order={refundTarget}
          lines={orderToLines(refundTarget)}
          submitting={refundSubmitting}
          onConfirm={handleRefund}
          onClose={() => setRefundTarget(null)}
        />
      )}

      {/* DÉTAILS D'UN REMBOURSEMENT */}
      {refundDetailsTarget && (
        <RefundDetailsModal
          order={refundDetailsTarget}
          userNames={refundByNames}
          onClose={() => setRefundDetailsTarget(null)}
        />
      )}

      {/* MODAL ENVOI DU TICKET PAR EMAIL */}
      {emailTarget && (
        <SendReceiptModal
          channel="email"
          orderId={emailTarget._id}
          defaultTo={emailDefaultTo}
          onClose={() => { setEmailTarget(null); setEmailDefaultTo(''); }}
        />
      )}

      {/* MODAL DÉTAIL DU TICKET */}
      {ticketTarget && (
        <OrderTicketModal order={ticketTarget} onClose={() => setTicketTarget(null)} />
      )}

      {/* MODAL FACTURE */}
      {invoiceTarget && (
        <InvoiceModal order={invoiceTarget} onClose={() => setInvoiceTarget(null)} />
      )}

      {/* MODAL CRÉATION/ÉDITION PLAT CHAUD */}
      {isDishModalOpen && (
        <div className="fixed inset-0 z-50 bg-brand-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 md:p-8">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl gelasio text-wood">
                  {editingDish ? 'Modifier le plat' : 'Nouveau plat chaud'}
                </h3>
                <button onClick={() => setIsDishModalOpen(false)} className="text-2xl text-stone-500 hover:text-wood"><Icon name="close" className="w-5 h-5 inline" /></button>
              </div>

              <div className="space-y-4">
                {/* Image */}
                <div>
                  <label className="block text-sm font-medium text-wood mb-2">Photo du plat</label>
                  <div className="flex items-center gap-4">
                    {dishForm.image && (
                      <img src={getImageUrl(dishForm.image)} alt="" className="w-20 h-20 rounded object-cover" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => e.target.files[0] && handleDishImageUpload(e.target.files[0])}
                      disabled={uploadingDishImage}
                    />
                    {uploadingDishImage && <span className="text-sm text-stone-500">Upload...</span>}
                  </div>
                </div>

                {/* Nom + Prix */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-wood mb-1">Nom *</label>
                    <input
                      type="text"
                      value={dishForm.name}
                      onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="ex: Colombo de Poulet"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-wood mb-1">Prix (€) *</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={dishForm.price}
                      onChange={(e) => setDishForm({ ...dishForm, price: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-wood mb-1">Description</label>
                  <textarea
                    value={dishForm.description}
                    onChange={(e) => setDishForm({ ...dishForm, description: e.target.value })}
                    rows="3"
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Description du plat..."
                  />
                </div>

                {/* Accompagnements dynamiques */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-wood">Accompagnements</label>
                    <button type="button" onClick={handleAddSide} className="text-sm text-brand-700 hover:text-brand-900">+ Ajouter</button>
                  </div>
                  <DndContext sensors={sideSensors} collisionDetection={closestCenter} onDragEnd={handleSideDragEnd}>
                    <SortableContext items={dishForm.sides.map((_, i) => `side-${i}`)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {dishForm.sides.map((side, idx) => (
                          <SortableSide
                            key={`side-${idx}`}
                            id={`side-${idx}`}
                            side={side}
                            idx={idx}
                            onChange={handleSideChange}
                            onRemove={handleRemoveSide}
                          />
                        ))}
                        {dishForm.sides.length === 0 && (
                          <p className="text-xs text-stone-500">Aucun accompagnement. Cliquez "+ Ajouter" pour en proposer.</p>
                        )}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>

                {/* MaxSides */}
                <div>
                  <label className="block text-sm font-medium text-wood mb-1">Nombre max d'accompagnements (côté client)</label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={dishForm.maxSides}
                    onChange={(e) => setDishForm({ ...dishForm, maxSides: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                {/* DietaryTags */}
                <div>
                  <label className="block text-sm font-medium text-wood mb-1">Tags diététiques (séparés par des virgules)</label>
                  <input
                    type="text"
                    value={dishTagsInput}
                    onChange={(e) => setDishTagsInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="ex: épicé, sans gluten, vegan"
                  />
                </div>

                {/* isAvailable */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="dishAvailable"
                    checked={dishForm.isAvailable}
                    onChange={(e) => setDishForm({ ...dishForm, isAvailable: e.target.checked })}
                  />
                  <label htmlFor="dishAvailable" className="text-sm text-wood">Plat disponible</label>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setIsDishModalOpen(false)} className="px-4 py-2 text-wood hover:bg-wood/10 rounded">Annuler</button>
                <button onClick={handleSaveDish} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">
                  {editingDish ? 'Enregistrer' : 'Créer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;