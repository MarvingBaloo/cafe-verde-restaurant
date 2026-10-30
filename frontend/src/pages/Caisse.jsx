import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api, {
  fetchFormulas, fetchIngredients, fetchDishes, fetchProducts, fetchMenus, fetchBubbleTeas, fetchMilkshakes,
  fetchProductCategories,
  searchUsers, registerQuick, createOrder, fetchUnpaidOnlineOrders, settleOrder, refundOrder, getUserById,
  recordPartPayment,
  fetchOpenTickets, updateOpenTicketItems,
  fetchOrders, updateOrderStatus, fetchTaxConfig,
} from '../services/api';
import { buildCartTax } from '../utils/tax';
import { tsToDate, orderLabel, partToTicket } from '../utils/orderTicket';
import { socket } from '../socket';
import Icon from '../components/Icon';
import useOnlineOrderAlert from '../hooks/useOnlineOrderAlert';
import Ticket from '../components/Ticket';
import PrintArea from '../components/PrintArea';
import RefundModal from '../components/modals/RefundModal';
import SendReceiptModal from '../components/modals/SendReceiptModal';
import InvoiceModal from '../components/modals/InvoiceModal';
import QuickClientModal from '../components/modals/QuickClientModal';
import ProductExtrasModal from '../components/modals/ProductExtrasModal';
import PartClientPicker from '../components/caisse/PartClientPicker';
import PartPaymentModal from '../components/modals/PartPaymentModal';
import CardPassages from '../components/caisse/CardPassages';
import PaperTicketInput from '../components/caisse/PaperTicketInput';
import TerminalSimulator from '../components/caisse/TerminalSimulator';
import TerminalCancelButton from '../components/caisse/TerminalCancelButton';
import { paperTicketOk } from '../utils/paperTicket';
import {
  newPassage, passageAmount, passagesStarted, passagesPending, toCardPayments, terminalFields, terminalLines, mixedSummary,
} from '../utils/cardPayments';
import ConfirmModal from '../components/modals/ConfirmModal';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { POINTS_PER_EURO, pointsToEuros, maxPointsForEuros } from '../utils/loyalty';
import { declineLabel } from '../utils/terminalErrors';

const SALADE_STEPS = [
  { category: 'base_salade',                      label: 'Base',     limitKey: 'base' },
  { category: 'proteine',                          label: 'Protéine', limitKey: 'protein' },
  { category: ['topping_legume', 'topping_fruit'], label: 'Toppings', limitKey: 'topping' },
  { category: 'sauce',                             label: 'Sauce',    limitKey: 'sauce' },
];

const CAT_TO_LIMIT = {
  base_salade: 'base', proteine: 'protein',
  topping_legume: 'topping', topping_fruit: 'topping', sauce: 'sauce',
};

function calcSaladPrice(formula, ingredients) {
  const counts = {};
  ingredients.forEach(ing => {
    const k = CAT_TO_LIMIT[ing.category];
    if (k) counts[k] = (counts[k] || 0) + 1;
  });
  let extra = 0;
  Object.entries(counts).forEach(([k, n]) => {
    const lim = (formula.limits || {})[k] || 0;
    if (n > lim) extra += (n - lim) * (formula.extra_cost_per_component || 0);
  });
  const premiumCost = ingredients.reduce((s, ing) => s + (ing.extra_price || 0), 0);
  return formula.base_price + extra + premiumCost;
}

// Prix d'une salade incluant l'option menu (price_addition) et le surcoût des produits inclus.
function calcSaladTotal(formula, ingredients, menu, menuProducts) {
  let total = calcSaladPrice(formula, ingredients);
  if (menu) {
    total += menu.price_addition || 0;
    (menuProducts || []).forEach(p => { total += p.menu_surcharge || 0; });
  }
  return total;
}

// Un menu "réel" (qui ajoute boisson/dessert) ; Solo / Sans Menu = salade seule.
const isUpgradeMenu = (menu) => !!menu && menu.name !== 'Solo' && menu.name !== 'Sans Menu';

const round2 = n => Math.round(n * 100) / 100;

// Signature de base d'un article : deux exemplaires fusionnent dans la note seulement si identiques.
const baseSignature = (it) => {
  if (it.type === 'product') {
    const extras = (it.selectedExtras || it.product?.selectedExtras || []).map(e => e.name).sort().join(',');
    return `product:${it.product?._id}:${extras}`;
  }
  if (it.type === 'dish') {
    const sides = (it.selectedSides || []).map(s => s.name).sort().join(',');
    const menuSig = `${it.menu?._id || 'none'}:${(it.menuProducts || []).map(p => p._id).sort().join(',')}`;
    return `dish:${it.dish?._id}:${sides}:${menuSig}`;
  }
  if (it.type === 'formula') {
    const ings = (it.ingredients || []).map(i => i._id).sort().join(',');
    const menuSig = `${it.menu?._id || 'none'}:${(it.menuProducts || []).map(p => p._id).sort().join(',')}`;
    return `formula:${it.formula?._id}:${ings}:${menuSig}`;
  }
  if (it.type === 'bubbletea') {
    const sel = (it.selections || []).map(s => `${s.category}=${s.name}`).sort().join(',');
    return `bubbletea:${it.bubbleTea?._id}:${sel}`;
  }
  if (it.type === 'milkshake') {
    const sel = (it.selections || []).map(s => `${s.category}=${s.name}`).sort().join(',');
    return `milkshake:${it.milkshake?._id}:${sel}`;
  }
  return it.id;
};

// Les articles verrouillés (commande en ligne) ont une signature distincte : ils se regroupent entre eux
// (quantité) mais ne fusionnent jamais avec un ajout identique du manager, et restent non modifiables.
const itemSignature = (it) => (it.locked ? `locked:${baseSignature(it)}` : baseSignature(it));

// Regroupe le panier (liste granulaire d'exemplaires) en lignes affichées avec quantité.
// Le panier reste granulaire en interne → split « par article » et soumission inchangés.
function groupCartItems(cart) {
  const map = new Map();
  cart.forEach((it) => {
    const sig = itemSignature(it);
    const g = map.get(sig);
    if (g) {
      g.qty += 1;
      g.lineTotal = round2(g.lineTotal + it.price);
      g.itemIds.push(it.id);
    } else {
      map.set(sig, { sig, item: it, qty: 1, unitPrice: it.price, lineTotal: it.price, itemIds: [it.id] });
    }
  });
  return [...map.values()];
}

// Convertit une commande passée en ligne en articles de panier VERROUILLÉS (non supprimables).
// Reconstruit le détail (salade legacy, salads[], plats, produits) avec les prix d'origine.
function buildLockedCartFromOnline(o) {
  const items = [];

  // Salade unique (format legacy envoyé par le front client)
  if (o.formula) {
    const menu = isUpgradeMenu(o.menu) ? o.menu : null;
    const menuProducts = menu ? (o.products || []) : [];
    const price = calcSaladTotal(o.formula, o.ingredients || [], menu, menuProducts);
    const qty = o.formulaQuantity || 1;
    const menuLabel = menu ? ` — ${menu.name}` : '';
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `online-salade-${o._id}-${i}`, type: 'formula',
        label: `${o.formula.name} (${(o.ingredients || []).length} ing.)${menuLabel}`,
        price, formula: o.formula, ingredients: o.ingredients || [], menu, menuProducts, locked: true,
      });
    }
  }

  // salads[] (robustesse si une commande en ligne en contenait)
  (o.salads || []).forEach((s, si) => {
    const menu = isUpgradeMenu(s.menu) ? s.menu : null;
    const menuProducts = menu ? (s.menuProducts || []) : [];
    const price = calcSaladTotal(s.formula, s.ingredients || [], menu, menuProducts);
    const qty = s.quantity || 1;
    const menuLabel = menu ? ` — ${menu.name}` : '';
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `online-salads-${o._id}-${si}-${i}`, type: 'formula',
        label: `${s.formula?.name} (${(s.ingredients || []).length} ing.)${menuLabel}`,
        price, formula: s.formula, ingredients: s.ingredients || [], menu, menuProducts, locked: true,
      });
    }
  });

  // Plats chauds
  (o.dishes || []).forEach((d, di) => {
    const qty = d.quantity || 1;
    const sidesPrice = (d.selectedSides || []).reduce((s, side) => s + (side.priceAddition || 0), 0);
    const menu = isUpgradeMenu(d.menu) ? d.menu : null;
    const mProducts = menu ? (d.menuProducts || []) : [];
    const menuExtra = menu ? (menu.price_addition || 0) + mProducts.reduce((s, p) => s + (p.menu_surcharge || 0), 0) : 0;
    const subtotal = d.subtotal != null ? d.subtotal : ((d.price || 0) + sidesPrice + menuExtra);
    const menuLabel = menu ? ` — ${menu.name}` : '';
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `online-dish-${o._id}-${di}-${i}`, type: 'dish',
        label: `${d.name}${menuLabel}`, price: subtotal, dish: d,
        selectedSides: d.selectedSides || [], menu, menuProducts: mProducts, subtotal, locked: true,
      });
    }
  });

  // Produits à l'unité
  (o.cartProducts || []).forEach((p, pi) => {
    const qty = p.quantity || 1;
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `online-product-${o._id}-${pi}-${i}`, type: 'product',
        label: p.name, price: p.price, product: p, locked: true,
      });
    }
  });

  // Bubble teas
  (o.bubbleTeas || []).forEach((b, bi) => {
    const qty = b.quantity || 1;
    const subtotal = b.subtotal != null ? b.subtotal : (b.price || 0);
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `online-bubbletea-${o._id}-${bi}-${i}`, type: 'bubbletea',
        label: b.name, price: subtotal,
        bubbleTea: { _id: b.bubbleTeaId, name: b.name, price: b.price || 0 },
        selections: b.selections || [], subtotal, locked: true,
      });
    }
  });

  // Milkshakes
  (o.milkshakes || []).forEach((m, mi) => {
    const qty = m.quantity || 1;
    const subtotal = m.subtotal != null ? m.subtotal : (m.price || 0);
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `online-milkshake-${o._id}-${mi}-${i}`, type: 'milkshake',
        label: m.name, price: subtotal,
        milkshake: { _id: m.milkshakeId, name: m.name, price: m.price || 0 },
        selections: m.selections || [], subtotal, locked: true,
      });
    }
  });

  return items;
}

// Reconstruit le panier d'un ticket CAISSE (format salads[]/dishes[]/products à l'unité).
// `locked` : true = articles déjà en cuisine (non modifiables) ; false = ticket 'open' éditable.
function buildCartFromTicket(o, locked = true) {
  const items = [];
  const prefix = `tkt-${o._id}`;

  // Salades : salads[] est toujours rempli côté caisse ; repli legacy au cas où.
  const salads = (o.salads && o.salads.length)
    ? o.salads
    : (o.formula ? [{ formula: o.formula, ingredients: o.ingredients, menu: o.menu, menuProducts: [], quantity: o.formulaQuantity }] : []);
  salads.forEach((s, si) => {
    const menu = isUpgradeMenu(s.menu) ? s.menu : null;
    const menuProducts = menu ? (s.menuProducts || []) : [];
    const price = calcSaladTotal(s.formula, s.ingredients || [], menu, menuProducts);
    const qty = s.quantity || 1;
    const menuLabel = menu ? ` — ${menu.name}` : '';
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `${prefix}-salad-${si}-${i}`, type: 'formula',
        label: `${s.formula?.name} (${(s.ingredients || []).length} ing.)${menuLabel}`,
        price, formula: s.formula, ingredients: s.ingredients || [], menu, menuProducts, locked,
      });
    }
  });

  // Plats chauds
  (o.dishes || []).forEach((d, di) => {
    const qty = d.quantity || 1;
    const sidesPrice = (d.selectedSides || []).reduce((s, side) => s + (side.priceAddition || 0), 0);
    const menu = isUpgradeMenu(d.menu) ? d.menu : null;
    const mProducts = menu ? (d.menuProducts || []) : [];
    const menuExtra = menu ? (menu.price_addition || 0) + mProducts.reduce((s, p) => s + (p.menu_surcharge || 0), 0) : 0;
    const subtotal = d.subtotal != null ? d.subtotal : ((d.price || 0) + sidesPrice + menuExtra);
    const menuLabel = menu ? ` — ${menu.name}` : '';
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `${prefix}-dish-${di}-${i}`, type: 'dish',
        label: `${d.name}${menuLabel}`, price: subtotal, dish: d,
        selectedSides: d.selectedSides || [], menu, menuProducts: mProducts, subtotal, locked,
      });
    }
  });

  // Produits à l'unité : caisse → o.products ; (robustesse : o.cartProducts).
  const unitProducts = (o.products && o.products.length) ? o.products : (o.cartProducts || []);
  unitProducts.forEach((p, pi) => {
    const qty = p.quantity || 1;
    for (let i = 0; i < qty; i++) {
      items.push({ id: `${prefix}-product-${pi}-${i}`, type: 'product', label: p.name, price: p.price, selectedExtras: p.selectedExtras || [], product: p, locked });
    }
  });

  // Bubble teas
  (o.bubbleTeas || []).forEach((b, bi) => {
    const qty = b.quantity || 1;
    const subtotal = b.subtotal != null ? b.subtotal : (b.price || 0);
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `${prefix}-bubbletea-${bi}-${i}`, type: 'bubbletea',
        label: b.name, price: subtotal,
        bubbleTea: { _id: b.bubbleTeaId, name: b.name, price: b.price || 0 },
        selections: b.selections || [], subtotal, locked,
      });
    }
  });

  // Milkshakes
  (o.milkshakes || []).forEach((m, mi) => {
    const qty = m.quantity || 1;
    const subtotal = m.subtotal != null ? m.subtotal : (m.price || 0);
    for (let i = 0; i < qty; i++) {
      items.push({
        id: `${prefix}-milkshake-${mi}-${i}`, type: 'milkshake',
        label: m.name, price: subtotal,
        milkshake: { _id: m.milkshakeId, name: m.name, price: m.price || 0 },
        selections: m.selections || [], subtotal, locked,
      });
    }
  });

  return items;
}

// Une part porte un DÛ (`amount`) et l'historique de ce qu'elle a déjà réglé (`settled`).
// Une part réglée n'est pas close : lui attribuer un article augmente son dû et la ré-ouvre
// pour un complément. Les champs hors `settled` décrivent le règlement EN COURS de saisie.
const emptyPart = () => ({
  amount: 0, method: null, items: [], cashGiven: '', paymentIntentId: null,
  passages: [newPassage()], // mixte : cartes passées au terminal (cf. utils/cardPayments.js)
  ticketAmount: 0,          // mixte : tickets resto papier
  ticketKind: 'paper',      // « Tickets resto » seul : 'paper' ou 'card' (titre-restaurant au terminal)
  settled: [],         // règlements déjà encaissés : [{ covered, method, pointsRedeemed, … }]
  extraItems: [],      // quotes-parts d'articles partagés entre toutes les parts (répartition égale)
  client: null,        // client identifié pour cette part (fidélité par part) ; null = hérite du client global
  pointsRedeemed: 0,   // points du client de la part utilisés pour régler une portion de la part
});

// Montant reçu par répartition (article partagé), hors articles nominatifs de la part.
const partExtra = (p) => round2((p.extraItems || []).reduce((s, it) => s + (it.price || 0), 0));

// Montant brut déjà couvert par les règlements encaissés de la part.
const partCovered = (p) => round2((p.settled || []).reduce((s, t) => s + (t.covered || 0), 0));
// Reste dû (brut) de la part.
const partRemaining = (p) => round2(Math.max(0, (p.amount || 0) - partCovered(p)));
// Part soldée : elle doit quelque chose et ce dû est intégralement couvert.
const isPartPaid = (p) => (p.amount || 0) > 0 && partRemaining(p) <= 0.001;
// Une part dont l'encaissement a commencé : son dû ne peut plus être re-réparti.
const partStarted = (p) => (p.settled || []).length > 0;
// Net à encaisser sur le règlement en cours = reste dû − valeur des points saisis.
const partNetOf = (p) => round2(Math.max(0, partRemaining(p) - pointsToEuros(p.pointsRedeemed || 0)));
// Total des points consommés par la part, tous règlements confondus.
const partPointsTotal = (p) => (p.settled || []).reduce((s, t) => s + (t.pointsRedeemed || 0), 0);

// Répartit un total en `count` parts égales (au centime), le reliquat sur la 1re part.
function buildEqualAmounts(total, count) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i === 0 ? remainder : 0)) / 100);
}

// Tri d'une fratrie de catégories : par `order` puis par nom.
const sortCatNodes = (nodes) => [...nodes].sort((a, b) => {
  const oa = typeof a.order === 'number' ? a.order : 0;
  const ob = typeof b.order === 'number' ? b.order : 0;
  if (oa !== ob) return oa - ob;
  return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
});

// Compte récursif des produits sous un nœud (lui + descendants).
const countDeepCat = (nodeId, childrenByParent, productsByCatId) => {
  let total = (productsByCatId[nodeId] || []).length;
  (childrenByParent[nodeId] || []).forEach(c => { total += countDeepCat(c.id, childrenByParent, productsByCatId); });
  return total;
};

// Bouton produit de la caisse (markup partagé arbre / liste à plat).
const CaisseProductButton = ({ product, onClick }) => (
  <button onClick={() => onClick(product)}
    className="p-3 border rounded-lg text-left hover:bg-blue-50 hover:border-blue-300 flex justify-between items-center transition-all">
    <p className="text-sm font-semibold text-gray-800 truncate pr-2">{product.name}</p>
    <span className="font-bold text-blue-700 text-sm whitespace-nowrap">{product.price.toFixed(2)} €</span>
  </button>
);

// Nœud d'arbre de catégories en accordéon (caisse). Sous-catégories puis produits directs.
const CaisseCatNode = ({ node, depth, childrenByParent, productsByCatId, openCats, toggle, onAddProduct }) => {
  const isOpen = openCats.has(node.id);
  const kids = sortCatNodes((childrenByParent[node.id] || []).filter(c => c.isAvailable !== false));
  const prods = [...(productsByCatId[node.id] || [])].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  const total = countDeepCat(node.id, childrenByParent, productsByCatId);
  if (total === 0) return null;

  return (
    <div className="mb-1.5">
      <button onClick={() => toggle(node.id)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
        style={{ marginLeft: depth * 12 }}>
        <Icon name={isOpen ? 'arrow-down' : 'arrow-right'} className="text-brand-600 shrink-0" />
        <span className="flex-grow text-left font-semibold text-gray-800 text-sm truncate">{node.name}</span>
        <span className="text-xs text-gray-400">{total}</span>
      </button>
      {isOpen && (
        <div className="mt-1.5" style={{ marginLeft: depth * 12 }}>
          {kids.map(child => (
            <CaisseCatNode key={child.id} node={child} depth={depth + 1}
              childrenByParent={childrenByParent} productsByCatId={productsByCatId}
              openCats={openCats} toggle={toggle} onAddProduct={onAddProduct} />
          ))}
          {prods.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              {prods.map(p => <CaisseProductButton key={p._id} product={p} onClick={onAddProduct} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Caisse = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0); // 0=client, 1=commande, 2=encaissement
  const [maxStep, setMaxStep] = useState(0); // étape la plus avancée déjà atteinte (navigation avant via stepper)

  // Client
  const [clientMode, setClientMode] = useState(null); // 'search'|'new'|null
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [newForm, setNewForm] = useState({ name: '', phone: '', email: '' });
  const [creatingClient, setCreatingClient] = useState(false);
  const [clientError, setClientError] = useState('');
  const debounceRef = useRef(null);

  // Catalogue
  const [formulas, setFormulas] = useState([]);
  const [allIngredients, setAllIngredients] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [bubbleTeas, setBubbleTeas] = useState([]);
  const [milkshakes, setMilkshakes] = useState([]);
  const [products, setProducts] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [openCats, setOpenCats] = useState(() => new Set());
  const [productSearch, setProductSearch] = useState('');
  const [menus, setMenus] = useState([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [taxConfig, setTaxConfig] = useState(null);
  const [consumptionMode, setConsumptionMode] = useState('dineIn'); // sur place / à emporter

  // Panier
  const [cart, setCart] = useState([]);

  // Commande en ligne récupérée à la caisse (option A : on l'encaisse au lieu d'en créer une nouvelle).
  const [onlineOrderId, setOnlineOrderId] = useState(null);
  const [loadingOnline, setLoadingOnline] = useState(false);

  // Alerte sonore + suivi des commandes en ligne (bips répétés jusqu'à acquittement).
  const onlineAlert = useOnlineOrderAlert();
  const [onlinePanelOpen, setOnlinePanelOpen] = useState(false);
  const [onlineCancelTarget, setOnlineCancelTarget] = useState(null);   // confirmation inline d'annulation

  // --- Tickets ouverts (additions en cours, non réglées, déjà au KDS) ---
  const [openTickets, setOpenTickets] = useState([]);          // liste affichée à l'étape 0
  const [loadingOpenTickets, setLoadingOpenTickets] = useState(false);
  const [openTicketMode, setOpenTicketMode] = useState(false); // true = on compose/gère un ticket ouvert
  const [openTicketId, setOpenTicketId] = useState(null);      // ticket repris/persisté (pilote settle + ajouts)
  const [openTicketInKitchen, setOpenTicketInKitchen] = useState(false); // ticket déjà envoyé au KDS (articles verrouillés)
  // Règlements DÉJÀ encaissés sur ce ticket (convives partis avant la fin). Vide partout ailleurs :
  // tant qu'il l'est, tous les calculs ci-dessous retombent à l'identique sur le comportement d'origine.
  const [prepaidParts, setPrepaidParts] = useState([]);
  const [partPayOpen, setPartPayOpen] = useState(false);
  const [partPayClient, setPartPayClient] = useState(null); // client créé à la volée depuis la modale
  const [partSlip, setPartSlip] = useState(null);       // justificatif de la dernière part encaissée
  const [printingSlip, setPrintingSlip] = useState(false);
  const [askPrintSlip, setAskPrintSlip] = useState(false); // « Imprimer le ticket ? » après une part encaissée
  const [slipSendChannel, setSlipSendChannel] = useState(null); // 'email' | 'sms' | null
  const [customerLabel, setCustomerLabel] = useState('');      // nom libre du ticket (Table 4…)
  const [ticketNameInput, setTicketNameInput] = useState('');  // saisie du nom à l'ouverture
  const [ticketsPanelOpen, setTicketsPanelOpen] = useState(false); // panneau latéral des tickets ouverts
  const [ticketCancelTarget, setTicketCancelTarget] = useState(null); // id du ticket en confirmation d'annulation (panneau)

  // Recherche client à l'encaissement (rattacher une fidélité sans réinitialiser le panier/l'étape)
  const [clientPickQ, setClientPickQ] = useState('');
  const [clientPickResults, setClientPickResults] = useState([]);
  const [clientPickSearching, setClientPickSearching] = useState(false);
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClientPartIdx, setQuickClientPartIdx] = useState(null); // part cible d'un « Nouveau client » (null = client global)
  const pickDebounceRef = useRef(null);

  // Wizard salade
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardFormula, setWizardFormula] = useState(null);
  const [wizardIngredients, setWizardIngredients] = useState([]);
  const [wizardStepIdx, setWizardStepIdx] = useState(0);
  const [wizardMenu, setWizardMenu] = useState(null);          // menu choisi pour la salade en cours
  const [wizardMenuProducts, setWizardMenuProducts] = useState([]); // boissons/desserts inclus
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  // Modal plat chaud
  const [dishModalOpen, setDishModalOpen] = useState(false);
  const [dishModalItem, setDishModalItem] = useState(null);
  const [dishModalSides, setDishModalSides] = useState([]);
  const [dishModalMenu, setDishModalMenu] = useState(null);
  const [dishModalMenuProducts, setDishModalMenuProducts] = useState([]);

  // Modal bubble tea (composition : plusieurs options par catégorie possibles, facultatif)
  const [btModalOpen, setBtModalOpen] = useState(false);
  const [btModalItem, setBtModalItem] = useState(null);
  const [btModalSelected, setBtModalSelected] = useState([]); // [{ category, name, supplementPrice }]

  // Modal milkshake (composition : plusieurs options par catégorie possibles, facultatif)
  const [msModalOpen, setMsModalOpen] = useState(false);
  const [msModalItem, setMsModalItem] = useState(null);
  const [extrasProduct, setExtrasProduct] = useState(null); // produit dont on choisit les suppléments
  const [msModalSelected, setMsModalSelected] = useState([]); // [{ category, name, supplementPrice }]

  // Paiement
  const [payMode, setPayMode] = useState('cash'); // 'cash' | 'card' | 'ticket' | 'mixed'
  const [cashGiven, setCashGiven] = useState('');
  // « Tickets resto » : papier (rien au terminal) ou carte titre-restaurant (Swile, Edenred…),
  // qui doit passer au terminal comme une carte bancaire.
  const [ticketKind, setTicketKind] = useState('paper');
  const [ticketGiven, setTicketGiven] = useState(''); // tickets papier remis (≥ net, sans rendu)
  // Mixte : lignes réglées l'une après l'autre (cartes au terminal, tickets papier, espèces).
  const [mixedPassages, setMixedPassages] = useState(() => [newPassage()]);

  // Fidélité — points utilisés pour réduire la note (1 pt = 1/POINTS_PER_EURO €)
  const [pointsToRedeem, setPointsToRedeem] = useState(0);

  // Remise commerciale appliquée à la caisse (avant les points). '%' ou '€'.
  const [discountType, setDiscountType] = useState('percent'); // 'percent' | 'amount'
  const [discountInput, setDiscountInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderDone, setOrderDone] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState('idle');
  const [terminalAmount, setTerminalAmount] = useState(0); // montant envoyé au terminal (TPE simulé)
  // 'idle' (prêt) | 'collecting' (montant sur le terminal, attente carte) | 'processing' (capture) | 'done' | 'error'
  const currentIntentRef = useRef(null); // PaymentIntent en cours — permet l'annulation
  // Annulation demandée pendant l'envoi au terminal, avant que le PaymentIntent soit connu.
  const cancelRequestedRef = useRef(false);
  // Message d'étape du lecteur (carte refusée en sans contact, code demandé…) : informatif,
  // la transaction continue.
  const [terminalHint, setTerminalHint] = useState('');
  // Paiement autorisé alors que la caissière annulait : elle doit trancher. { paymentIntentId, amount }
  const [pendingAuth, setPendingAuth] = useState(null);
  // Paiement capturé depuis cette fenêtre de décision : le prochain encaissement du même
  // montant le consomme au lieu de solliciter à nouveau le terminal.
  const prepaidRef = useRef(null);
  // Paiements du solde déjà écrits sur le ticket par une mise en attente (cf. persistTicketAndLeave).
  const recordedTxRef = useRef(new WeakSet());

  // Séparation d'addition (split)
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  // Table dont des convives ont déjà payé : 'all' = une seule personne règle tout le reste,
  // 'split' = le reste est réparti entre plusieurs ; null tant que la caissière n'a pas choisi.
  const [restChoice, setRestChoice] = useState(null);
  const [splitMode, setSplitMode] = useState('equal'); // 'equal' | 'free' | 'item'
  const [parts, setParts] = useState([]); // cf. emptyPart() — { amount, items, settled[], … }
  const [currentPartIdx, setCurrentPartIdx] = useState(0);
  const [splitError, setSplitError] = useState('');
  const [encaissementStarted, setEncaissementStarted] = useState(false); // verrou config dès 1re part encaissée
  // Articles ajoutés après le 1er encaissement, en attente d'attribution à une part.
  const [pendingAssign, setPendingAssign] = useState([]);
  const [assignOpen, setAssignOpen] = useState(false); // modale d'attribution (refermable, la file reste)
  // Articles partagés entre toutes les parts : ils n'appartiennent à personne, donc ne doivent
  // plus figurer dans le pool sélectionnable du mode « par article ».
  const [spreadIds, setSpreadIds] = useState([]);

  // Impression des tickets (figés à la finalisation)
  const [receipt, setReceipt] = useState(null);
  const [printTarget, setPrintTarget] = useState(null); // 'simple' | 'recap' | index de part | null

  // Remboursement à chaud (commande qu'on vient d'encaisser).
  const [lastOrder, setLastOrder] = useState(null);   // commande créée renvoyée par le backend (id réel)
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [refundedInfo, setRefundedInfo] = useState(null); // { amount } une fois remboursé
  const [sendChannel, setSendChannel] = useState(null);   // 'email' | 'sms' | null — envoi du ticket

  // Suivi service — commandes prêtes à servir (status 'ready'). Panneau indépendant du wizard d'encaissement.
  const [readyOrders, setReadyOrders] = useState([]);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [servingId, setServingId] = useState(null); // commande en cours de validation "Servi"

  useEffect(() => {
    if (catalogLoaded) return;
    const ex = r => Array.isArray(r.data) ? r.data
      : Array.isArray(r.data?.data) ? r.data.data
      : Array.isArray(r.data?.message) ? r.data.message : [];
    Promise.all([fetchFormulas(), fetchIngredients(), fetchDishes(), fetchProducts(), fetchMenus(), fetchBubbleTeas(), fetchMilkshakes(), fetchProductCategories()])
      .then(([fRes, iRes, dRes, pRes, mRes, btRes, msRes, pcRes]) => {
        setFormulas(ex(fRes).filter(f => f.isAvailable !== false));
        setAllIngredients(ex(iRes).filter(i => i.isAvailable !== false));
        setDishes(ex(dRes).filter(d => d.isAvailable !== false));
        setBubbleTeas(ex(btRes).filter(b => b.isAvailable !== false));
        setMilkshakes(ex(msRes).filter(m => m.isAvailable !== false));
        setProducts(ex(pRes).filter(p => p.isAvailable !== false));
        setProductCategories(ex(pcRes).filter(c => c.isAvailable !== false));
        // Pas de filtre isAvailable (aligné sur MenuSelection) ; trié par price_addition croissant (Solo → L → XL).
        setMenus(ex(mRes).sort((a, b) => (a.price_addition || 0) - (b.price_addition || 0)));
        setCatalogLoaded(true);
      })
      .catch(console.error);
    // Config TVA : pilote le taux par défaut + le mode de consommation initial.
    fetchTaxConfig()
      .then(res => {
        const cfg = res.data || null;
        setTaxConfig(cfg);
        if (cfg?.defaultMode) setConsumptionMode(cfg.defaultMode);
      })
      .catch(console.error);
  }, [catalogLoaded]);

  // Suivi service : charge les commandes prêtes puis se synchronise en temps réel.
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetchOrders();
        const d = res.data;
        const all = Array.isArray(d) ? d
          : Array.isArray(d?.data) ? d.data
          : Array.isArray(d?.message) ? d.message : [];
        setReadyOrders(all.filter(o => o.status === 'ready'));
      } catch (err) {
        console.error('Suivi service — chargement échoué:', err);
      }
    };
    load();

    // Retire une commande de la liste si elle quitte l'état 'ready' (servie, reculée, annulée).
    const upsert = (o) => setReadyOrders(prev => {
      const without = prev.filter(x => x._id !== o._id);
      return o.status === 'ready' ? [o, ...without] : without;
    });
    const remove = (id) => setReadyOrders(prev => prev.filter(x => x._id !== id));

    const onNewOrder = (o) => { if (o.status === 'ready') upsert(o); };
    const onOrderUpdated = (o) => upsert(o);
    const onOrderCancelled = ({ orderId }) => remove(orderId);

    socket.on('new_order', onNewOrder);
    socket.on('order_updated', onOrderUpdated);
    socket.on('order:cancelled', onOrderCancelled);
    return () => {
      socket.off('new_order', onNewOrder);
      socket.off('order_updated', onOrderUpdated);
      socket.off('order:cancelled', onOrderCancelled);
    };
  }, []);

  // Marque une commande prête comme servie (status 'delivered'). Retrait optimiste.
  const handleServe = async (orderId) => {
    setServingId(orderId);
    setReadyOrders(prev => prev.filter(o => o._id !== orderId));
    try {
      await updateOrderStatus(orderId, 'delivered');
    } catch (err) {
      console.error('Marquage "servi" échoué:', err);
    } finally {
      setServingId(null);
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (searchQ.length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const res = await searchUsers(searchQ);
        const data = res.data?.data;
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('searchUsers error:', err);
        const status = err.response?.status;
        const msg = err.response?.data?.message || err.message || '';
        setSearchError(`Erreur ${status || ''} : ${msg || 'Impossible de rechercher'}`);
        setSearchResults([]);
      }
      finally { setSearching(false); }
    }, 350);
  }, [searchQ]);

  // Recherche client à l'encaissement (debounce dédié, n'affecte pas la recherche de l'étape 0).
  useEffect(() => {
    if (pickDebounceRef.current) clearTimeout(pickDebounceRef.current);
    if (clientPickQ.length < 2) { setClientPickResults([]); return; }
    pickDebounceRef.current = setTimeout(async () => {
      setClientPickSearching(true);
      try {
        const res = await searchUsers(clientPickQ);
        const data = res.data?.data;
        setClientPickResults(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('searchUsers (encaissement) error:', err);
        setClientPickResults([]);
      } finally { setClientPickSearching(false); }
    }, 350);
  }, [clientPickQ]);

  // Rattache un client à l'encaissement : la fidélité s'active sans réinitialiser la commande.
  const handleAttachClient = (client) => {
    setSelectedClient(client);
    setClientPickQ('');
    setClientPickResults([]);
  };

  const cartTotal = cart.reduce((s, item) => s + item.price, 0);
  const groupedCart = groupCartItems(cart);

  // Mémorise l'étape la plus avancée atteinte → le stepper autorise d'y revenir vers l'avant.
  useEffect(() => { setMaxStep(m => Math.max(m, step)); }, [step]);

  // Conditions pour quitter une étape vers la suivante.
  const isStepValid = (s) =>
    s === 0 ? !!selectedClient   // client identifié ; l'anonyme avance via son bouton dédié
    : s === 1 ? cart.length > 0
    : true;

  // Navigation stepper : reculer librement ; avancer vers une étape déjà atteinte ou la suivante immédiate si valide.
  const canGoToStep = (idx) => {
    if (idx === step) return false;
    // Un règlement encaissé interdit le retour à l'étape client : en changer viderait le panier.
    if (idx === 0 && paymentLocked) return false;
    if (idx < step) return true;
    if (idx === 2 && cart.length === 0) return false; // encaissement impossible sans panier
    if (idx <= maxStep) return true;
    return idx === step + 1 && isStepValid(step);
  };

  // Remise commerciale (avant points) : % borné à 100, montant plafonné au total.
  const discountRaw = Math.max(0, parseFloat(discountInput) || 0);
  const discountValue = discountType === 'percent'
    ? round2(cartTotal * Math.min(discountRaw, 100) / 100)
    : Math.min(round2(discountRaw), round2(cartTotal));
  const discountedTotal = round2(Math.max(0, cartTotal - discountValue));

  // Fidélité : remise = points/POINTS_PER_EURO ; net = ce qu'il reste après remise commerciale PUIS points.
  const availablePoints = selectedClient?.loyaltyPoints || 0;
  const maxRedeemablePoints = Math.min(availablePoints, maxPointsForEuros(discountedTotal)); // plafonné au montant remisé
  const pointsDiscount = round2(pointsToEuros(pointsToRedeem));
  const netTotal = round2(Math.max(0, discountedTotal - pointsDiscount));
  // Déjà encaissé auprès des convives partis. `splitBase` est ce qu'il reste à répartir : sans
  // acompte il EST `netTotal` (même valeur, pas un recalcul) — le split ordinaire est inchangé.
  const prepaidTotal = round2(prepaidParts.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const splitBase = prepaidTotal > 0 ? round2(Math.max(0, netTotal - prepaidTotal)) : netTotal;

  // TVA (affichage indicatif ; le backend recalcule et fige la ventilation à l'encaissement).
  const categoriesById = React.useMemo(
    () => Object.fromEntries((productCategories || []).map(c => [c._id || c.id, c])),
    [productCategories]
  );
  const taxView = taxConfig ? buildCartTax(cart, cartTotal, netTotal, consumptionMode, taxConfig, categoriesById) : { breakdown: [], totalHT: 0, totalTVA: 0 };

  // Réductions globales actives → incompatibles avec le split « par article ».
  const hasGlobalReduction = pointsToRedeem > 0 || discountValue > 0;

  // Si la remise abaisse le plafond sous les points déjà saisis, on les re-clampe.
  useEffect(() => {
    if (pointsToRedeem > maxRedeemablePoints) setPointsToRedeem(maxRedeemablePoints);
  }, [maxRedeemablePoints, pointsToRedeem]);
  const cashGivenNum = parseFloat(cashGiven) || 0;
  const change = cashGivenNum - netTotal;
  // Mode mixte simple : lignes réglées l'une après l'autre (cf. CardPassages) ; espèces avec
  // rendu, tickets papier sans rendu. Les totaux persistés restent ceux d'avant.
  const mixedSum = mixedSummary(mixedPassages, netTotal);
  const mixedCardNum = terminalFields(mixedPassages).cardAmount;
  // Au moins une ligne réglée : la note ne peut plus être abandonnée ni reposée en l'état.
  const mixedCardStarted = passagesStarted(mixedPassages);
  const mixedCardPending = mixedSum.pending;
  const mixedTicketNum = mixedSum.ticketAmount;
  const mixedCashNum = mixedSum.cashAmount;
  const mixedChange = mixedSum.change;
  const mixedComplete = mixedSum.rest <= 0.001 && !mixedSum.pending;
  // Carte, ou carte titre-restaurant : le bouton « Encaisser » du bloc remplace « Valider ».
  const simpleTerminal = payMode === 'card' || (payMode === 'ticket' && ticketKind === 'card');
  const terminalBusyNow = terminalStatus === 'collecting' || terminalStatus === 'processing';
  const encaisserButton = (tone) => (
    <button onClick={handleSubmitOrder} disabled={submitting || terminalBusyNow}
      className={`w-full py-4 ${tone} text-white rounded-xl font-bold text-lg transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg`}>
      {terminalBusyNow ? 'Terminal en cours…' : submitting ? 'Validation…' : `Encaisser ${netTotal.toFixed(2)} €`}
    </button>
  );

  // (Ré)initialise les parts tant que l'encaissement n'a pas commencé (config verrouillée ensuite).
  const splitStarted = encaissementStarted;
  // De l'argent est déjà entré en caisse sur cette note : part réglée en split, ou volet carte
  // d'un paiement mixte déjà capturé. On ne peut plus retirer d'article.
  const paymentLocked = encaissementStarted || mixedCardStarted || prepaidTotal > 0;
  // Le serveur n'accepte plus de clôture simple une fois des parts encaissées : « Régler le
  // reste » est donc, en coulisse, une addition séparée à une seule part, sans répartition
  // ni numéro de part à l'écran. Tant que rien n'est choisi (ou qu'il ne reste rien), le
  // détail des parts est masqué au profit du décompte.
  const settleRest = prepaidTotal > 0 && restChoice === 'all';
  const restPending = prepaidTotal > 0 && (splitBase <= 0 || restChoice === null);
  // Argent encaissé pendant CETTE saisie et pas encore enregistré sur le ticket (une part du
  // solde, ou le volet carte d'un mixte). Reprendre une autre table depuis « Tickets ouverts »
  // remet l'encaissement à zéro et l'oublierait ; « Mettre en attente » et « Envoyer en
  // cuisine », eux, l'enregistrent sur le ticket (cf. persistTicketAndLeave).
  // Les parts « Encaisser une part » ne comptent pas ici : elles sont déjà enregistrées.
  const unsavedPayment = encaissementStarted || mixedCardStarted;
  const UNSAVED_PAYMENT_HINT = "Un règlement vient d'être encaissé sur cette note : mettez-la en attente ou terminez l'encaissement avant d'en reprendre une autre.";
  // Carte débitée sans que le paiement soit complet (volet carte d'un mixte, part mixte dont la
  // carte est passée) : rien d'enregistrable en l'état, la note ne peut être reposée qu'une
  // fois ce paiement terminé.
  const cardInFlight = splitEnabled ? parts.some(p => passagesStarted(p.passages)) : mixedCardStarted;
  const CARD_IN_FLIGHT_HINT = 'Un paiement carte est en cours sur cette note : terminez-le avant de la mettre de côté.';

  // Règlements réellement encaissés à cet instant, un par transaction, avec de quoi les rendre :
  // moyen, PaymentIntent (sans lui aucun remboursement carte n'est possible) et payeur.
  // Trois sources : parts d'une addition séparée, volet carte d'un mixte, paiement capturé
  // depuis la fenêtre de décision.
  const buildCancelPayments = () => {
    const out = [];
    // Règlements encaissés AVANT cette session (convives partis plus tôt) : ils ont bien été
    // encaissés, donc ils sont à rendre si la table est annulée.
    for (const p of prepaidParts) {
      out.push({
        partIndex: p.index ?? null,
        method: p.method || null,
        amount: round2(Number(p.amount) || 0),
        paymentIntentId: p.paymentIntentId || null,
        userName: p.userName || null,
      });
    }
    if (splitEnabled) {
      parts.forEach((p, i) => {
        (p.settled || []).forEach(t => {
          // Un règlement absorbé par les points n'a rien fait entrer en caisse : les points ne
          // sont débités qu'à la finalisation, il n'y a donc rien à rendre.
          const cashedIn = round2(Math.max(0, (t.covered || 0) - pointsToEuros(t.pointsRedeemed || 0)));
          if (cashedIn <= 0) return;
          out.push({
            partIndex: i + 1,
            amount: cashedIn,
            method: t.method,
            paymentIntentId: t.paymentIntentId || null,
            cardAmount: t.cardAmount ?? null,
            ...(t.cardPayments?.length ? { cardPayments: t.cardPayments } : {}),
            cashAmount: t.cashAmount ?? null,
            ticketAmount: t.ticketAmount ?? null,
            cashGiven: t.cashGiven ?? null,
            change: t.change ?? null,
            // Payeur de la part : sans lui on ne saurait pas à qui rendre l'argent quand il
            // diffère du client global de la vente.
            user: p.client?._id || null,
            userName: p.client?.name || null,
          });
        });
      });
    }
    // Mixte : une entrée par carte déjà passée au terminal, chacune avec son PaymentIntent.
    if (!splitEnabled && payMode === 'mixed') {
      for (const c of toCardPayments(mixedPassages)) {
        out.push({
          partIndex: null, amount: c.amount, method: 'card', kind: c.kind,
          paymentIntentId: c.paymentIntentId, cardAmount: c.amount,
          user: selectedClient?._id || null, userName: selectedClient?.name || null,
        });
      }
    }
    const prepaid = prepaidRef.current;
    if (prepaid?.amount > 0) {
      out.push({
        partIndex: null, amount: round2(prepaid.amount), method: 'card',
        paymentIntentId: prepaid.paymentIntentId || null, cardAmount: round2(prepaid.amount),
        user: selectedClient?._id || null, userName: selectedClient?.name || null,
      });
    }
    return out;
  };

  // Montant à rendre = somme des règlements encaissés. Dérivé de la même source que les
  // références, donc le badge et ce qu'on peut effectivement rembourser concordent toujours.
  const settledSoFar = () => round2(buildCancelPayments().reduce((s, p) => s + p.amount, 0));
  useEffect(() => {
    if (!splitEnabled || splitStarted) return;
    if (splitMode === 'item') {
      setParts([emptyPart()]); // mode 'item' : flux dynamique, une part active à la fois
      setCurrentPartIdx(0);
      setSplitError('');
      return;
    }
    const amounts = splitMode === 'equal'
      ? buildEqualAmounts(splitBase, splitCount)
      : Array(splitCount).fill(0);
    setParts(amounts.map(amount => ({ ...emptyPart(), amount })));
    setCurrentPartIdx(0);
    setSplitError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitEnabled, splitCount, splitMode, splitBase]);

  // Pool sélectionnable du mode « par article ». Un article en sort dès qu'il appartient à
  // quelqu'un d'autre que la part en cours de composition : une part déjà entamée (il est réglé,
  // et le rester même si la part se ré-ouvre pour un complément), une autre part, ou l'ensemble
  // des parts s'il a été partagé.
  const lockedItemIds = new Set([
    ...parts.flatMap((p, i) => (partStarted(p) || i !== currentPartIdx) ? (p.items || []).map(it => it.id) : []),
    ...spreadIds,
  ]);
  const availableItems = cart.filter(it => !lockedItemIds.has(it.id));

  const partPayItems = (() => {
    if (!prepaidParts.length) return cart;
    const taken = [];
    for (const p of prepaidParts) for (const it of (p.items || [])) taken.push(`${it.label}|${round2(it.price)}`);
    return cart.filter(it => {
      const k = `${it.label}|${round2(it.price)}`;
      const i = taken.indexOf(k);
      if (i === -1) return true;
      taken.splice(i, 1); // une seule occurrence consommée par exemplaire déjà réglé
      return false;
    });
  })();

  const partsSum = round2(parts.reduce((s, p) => s + (p.amount || 0), 0));
  const splitBalanced = Math.abs(partsSum - round2(splitBase)) < 0.001;
  const allPartsPaid = parts.length > 0 && parts.every(p => p.amount === 0 || isPartPaid(p));
  // Finalisation possible : plus rien à attribuer, et toutes les parts soldées.
  // Mode 'item' → tous les articles placés ; sinon → répartition équilibrée sur le net.
  const canFinalizeSplit = pendingAssign.length === 0 && (splitMode === 'item'
    ? (cart.length > 0 && availableItems.length === 0 && allPartsPaid)
    : (allPartsPaid && splitBalanced));

  // Handlers client
  const handleSelectClient = async (client) => {
    setSelectedClient(client);
    setClientMode(null);
    setSearchQ('');
    setSearchResults([]);
    setCart([]);
    setOnlineOrderId(null);
    setOpenTicketMode(false);
    setOpenTicketId(null);
    setOpenTicketInKitchen(false);
    setCustomerLabel('');
    setStep(1);

    // Récupère une éventuelle commande en ligne non réglée → préchargée (articles verrouillés).
    if (!client?._id) return;
    setLoadingOnline(true);
    try {
      const res = await fetchUnpaidOnlineOrders(client._id);
      const list = res.data?.data || res.data || [];
      const online = Array.isArray(list) ? list[0] : null; // la plus récente (tri desc backend)
      if (online) {
        setOnlineOrderId(online._id);
        setCart(buildLockedCartFromOnline(online));
      }
    } catch (err) {
      console.error('Récupération commande en ligne échouée:', err);
    } finally {
      setLoadingOnline(false);
    }
  };

  const handleAnonymous = () => {
    setSelectedClient(null);
    setCart([]);
    setOnlineOrderId(null);
    setOpenTicketMode(false);
    setOpenTicketId(null);
    setOpenTicketInKitchen(false);
    setCustomerLabel('');
    setStep(1);
  };

  const handleCreateClient = async () => {
    setClientError('');
    const { name, phone, email } = newForm;
    if (!name.trim() || (!phone.trim() && !email.trim())) {
      setClientError('Nom et (téléphone ou email) requis');
      return;
    }
    setCreatingClient(true);
    try {
      const res = await registerQuick(newForm);
      const client = res.data?.data?.user || res.data?.user;
      setSelectedClient(client);
      setOpenTicketMode(false);
      setOpenTicketId(null);
      setCustomerLabel('');
      setStep(1);
    } catch (err) {
      setClientError(err.response?.data?.message || 'Erreur création client');
    } finally {
      setCreatingClient(false);
    }
  };

  // Handlers wizard salade
  const openSaladWizard = (formula) => {
    setWizardFormula(formula);
    setWizardIngredients([]);
    setWizardStepIdx(0);
    setWizardMenu(menus.find(m => m.name === 'Solo') || null);
    setWizardMenuProducts([]);
    setWizardOpen(true);
  };

  const WIZARD_TOTAL_STEPS = SALADE_STEPS.length + 1; // étapes ingrédients + étape Menu finale
  const isWizardMenuStep = wizardStepIdx === SALADE_STEPS.length;
  const wizardStep = SALADE_STEPS[wizardStepIdx];
  const wizardFiltered = allIngredients.filter(ing =>
    Array.isArray(wizardStep?.category)
      ? wizardStep.category.includes(ing.category)
      : ing.category === wizardStep?.category
  );
  const wizardLimitKey = wizardStep?.limitKey;
  const wizardLimitMax = wizardFormula?.limits?.[wizardLimitKey] || 0;
  const wizardCount = wizardIngredients.filter(i => CAT_TO_LIMIT[i.category] === wizardLimitKey).length;

  const toggleWizardIngredient = (ing) => {
    const already = wizardIngredients.some(i => i._id === ing._id);
    if (already) {
      setWizardIngredients(prev => prev.filter(i => i._id !== ing._id));
    } else {
      setWizardIngredients(prev => [...prev, ing]);
    }
  };

  // Choix du menu dans le wizard : repart d'une sélection produit vierge.
  const selectWizardMenu = (menu) => {
    setWizardMenu(menu);
    setWizardMenuProducts([]);
  };

  // (Dé)sélection d'un produit inclus — règles : mode 'or' = 1 produit (boisson OU dessert),
  // mode 'and' = 1 boisson ET 1 dessert (max 1 par catégorie).
  const toggleWizardMenuProduct = (product) => {
    setWizardMenuProducts(prev => {
      const isSelected = prev.some(p => p._id === product._id);
      if (wizardMenu?.selectionMode === 'or') {
        return isSelected ? [] : [product];
      }
      if (isSelected) return prev.filter(p => p._id !== product._id);
      const canAdd = product.category === 'drink' ? wizardMenu?.includes?.drink : wizardMenu?.includes?.dessert;
      if (!canAdd) return prev;
      // Remplace l'éventuel produit existant de la même catégorie (max 1 par catégorie).
      return [...prev.filter(p => p.category !== product.category), product];
    });
  };

  const wizardAddToCart = () => {
    if (!wizardIngredients.some(i => i.category === 'base_salade')) return;
    const menu = isUpgradeMenu(wizardMenu) ? wizardMenu : (wizardMenu || null);
    const menuProducts = isUpgradeMenu(wizardMenu) ? wizardMenuProducts : [];
    const price = calcSaladTotal(wizardFormula, wizardIngredients, menu, menuProducts);
    const menuLabel = isUpgradeMenu(menu) ? ` — ${menu.name}` : '';
    pushToCart({
      id: `salade-${Date.now()}`,
      type: 'formula',
      label: `${wizardFormula.name} (${wizardIngredients.length} ing.)${menuLabel}`,
      price,
      formula: wizardFormula,
      ingredients: wizardIngredients,
      menu,
      menuProducts,
    });
    setWizardOpen(false);
  };

  // Handlers plat chaud — la modale s'ouvre toujours (accompagnements éventuels + menu)
  const openDishModal = (dish) => {
    setDishModalItem(dish);
    setDishModalSides([]);
    setDishModalMenu(menus.find(m => m.name === 'Solo') || null);
    setDishModalMenuProducts([]);
    setDishModalOpen(true);
  };

  const toggleDishSide = (side) => {
    const already = dishModalSides.some(s => s.name === side.name);
    if (already) {
      setDishModalSides(prev => prev.filter(s => s.name !== side.name));
    } else {
      if (dishModalItem && dishModalSides.length >= (dishModalItem.maxSides || 999)) return;
      setDishModalSides(prev => [...prev, side]);
    }
  };

  const selectDishMenu = (m) => { setDishModalMenu(m); setDishModalMenuProducts([]); };

  const toggleDishMenuProduct = (product) => {
    setDishModalMenuProducts(prev => {
      const sel = prev.some(p => p._id === product._id);
      if (dishModalMenu?.selectionMode === 'or') return sel ? [] : [product];
      if (sel) return prev.filter(p => p._id !== product._id);
      const canAdd = product.category === 'drink' ? dishModalMenu?.includes?.drink : dishModalMenu?.includes?.dessert;
      if (!canAdd) return prev;
      return [...prev.filter(p => p.category !== product.category), product];
    });
  };

  const dishAddToCart = () => {
    const sidesPrice = dishModalSides.reduce((s, side) => s + (side.priceAddition || 0), 0);
    const menu = isUpgradeMenu(dishModalMenu) ? dishModalMenu : null;
    const mProducts = menu ? dishModalMenuProducts : [];
    const menuExtra = menu ? (menu.price_addition || 0) + mProducts.reduce((s, p) => s + (p.menu_surcharge || 0), 0) : 0;
    const subtotal = dishModalItem.price + sidesPrice + menuExtra;
    const menuLabel = menu ? ` — ${menu.name}` : '';
    pushToCart({
      id: `dish-${Date.now()}`,
      type: 'dish',
      label: `${dishModalItem.name}${menuLabel}`,
      price: subtotal,
      dish: dishModalItem,
      selectedSides: dishModalSides,
      menu,
      menuProducts: mProducts,
      subtotal,
    });
    setDishModalOpen(false);
  };

  // Handlers bubble tea — la modale s'ouvre toujours (composition facultative par catégorie)
  const openBubbleTeaModal = (tea) => {
    setBtModalItem(tea);
    setBtModalSelected([]);
    setBtModalOpen(true);
  };

  const isBtPicked = (categoryName, ing) => btModalSelected.some(s => s.category === categoryName && s.name === ing.name);

  const chooseBtIngredient = (categoryName, ing) => {
    setBtModalSelected(prev => {
      if (prev.some(s => s.category === categoryName && s.name === ing.name)) {
        return prev.filter(s => !(s.category === categoryName && s.name === ing.name));
      }
      return [...prev, { category: categoryName, name: ing.name, supplementPrice: ing.isSupplement ? (ing.supplementPrice || 0) : 0 }];
    });
  };

  const bubbleTeaAddToCart = () => {
    const selections = btModalSelected;
    const supplementsTotal = selections.reduce((s, sel) => s + sel.supplementPrice, 0);
    const subtotal = round2((btModalItem.price || 0) + supplementsTotal);
    pushToCart({
      id: `bubbletea-${Date.now()}`,
      type: 'bubbletea',
      label: btModalItem.name,
      price: subtotal,
      bubbleTea: btModalItem,
      selections,
      subtotal,
    });
    setBtModalOpen(false);
  };

  // Handlers milkshake — la modale s'ouvre toujours (composition facultative par catégorie)
  const openMilkshakeModal = (ms) => {
    setMsModalItem(ms);
    setMsModalSelected([]);
    setMsModalOpen(true);
  };

  const isMsPicked = (categoryName, ing) => msModalSelected.some(s => s.category === categoryName && s.name === ing.name);

  const chooseMsIngredient = (categoryName, ing) => {
    setMsModalSelected(prev => {
      if (prev.some(s => s.category === categoryName && s.name === ing.name)) {
        return prev.filter(s => !(s.category === categoryName && s.name === ing.name));
      }
      return [...prev, { category: categoryName, name: ing.name, supplementPrice: ing.isSupplement ? (ing.supplementPrice || 0) : 0 }];
    });
  };

  const milkshakeAddToCart = () => {
    const selections = msModalSelected;
    const supplementsTotal = selections.reduce((s, sel) => s + sel.supplementPrice, 0);
    const subtotal = round2((msModalItem.price || 0) + supplementsTotal);
    pushToCart({
      id: `milkshake-${Date.now()}`,
      type: 'milkshake',
      label: msModalItem.name,
      price: subtotal,
      milkshake: msModalItem,
      selections,
      subtotal,
    });
    setMsModalOpen(false);
  };

  // Ajout au panier. Si une part a déjà été encaissée en split, l'article rejoint la file
  // d'attribution : il devra être rattaché à une part (qui redevient à encaisser) avant de finaliser.
  const pushToCart = (item) => {
    setCart(prev => [...prev, item]);
    if (splitEnabled && encaissementStarted) {
      setPendingAssign(prev => [...prev, item]);
      setAssignOpen(true);
    }
  };

  // Stepper de la note : + clone un exemplaire, − retire le dernier exemplaire, croix retire toute la ligne.
  const incrementGroup = (group) => {
    pushToCart({ ...group.item, id: `${group.item.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  };

  // Retraits interdits dès qu'un encaissement a commencé : on ne reprend pas de l'argent déjà encaissé.
  const decrementGroup = (group) => {
    if (paymentLocked) return;
    const idToRemove = group.itemIds[group.itemIds.length - 1];
    setCart(prev => prev.filter(it => it.id !== idToRemove));
  };

  const removeGroup = (group) => {
    if (paymentLocked) return;
    const ids = new Set(group.itemIds);
    setCart(prev => prev.filter(it => !ids.has(it.id)));
  };

  const addProductToCart = (product, selectedExtras = []) => {
    const extrasTotal = (selectedExtras || []).reduce((s, e) => s + (e.price || 0), 0);
    const unit = round2((product.price || 0) + extrasTotal);
    pushToCart({
      id: `product-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'product',
      label: product.name,
      price: unit,
      selectedExtras,
      product: { ...product, selectedExtras, basePrice: product.price || 0, price: unit },
    });
  };

  // Clic sur un produit du catalogue : ouvre la modale de suppléments s'il en a, sinon ajout direct.
  const handleAddProduct = (product) => {
    if (product.extras?.length) {
      setExtrasProduct(product);
      return;
    }
    addProductToCart(product);
  };

  const toggleCat = (id) => setOpenCats(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Contexte attaché au PaymentIntent : sans lui, un paiement retrouvé chez Stripe n'est
  // rattachable à aucune commande (rapprochement compta, capture tardive).
  const terminalMetadata = (context) => ({
    context,
    customer: selectedClient?.name || customerLabel || 'Anonyme',
    ticketId: openTicketId || '',
    // Lu par la réintégration Stripe de l'Espace DEV pour retrouver le bon taux de TVA.
    consumptionMode,
  });

  // Sortie d'échec : ne jamais lâcher un PaymentIntent sans tenter de l'annuler, sinon
  // l'autorisation reste ouverte chez Stripe et il faut la capturer ou l'annuler à la main.
  // Si le client a payé entre-temps, on remonte la décision à la caissière.
  const abandonTerminal = async (paymentIntentId, message) => {
    currentIntentRef.current = null;
    setTerminalStatus('error');
    try {
      const { data } = await api.post('/payment/terminal/cancel', { paymentIntentId });
      if (data?.outcome === 'already_paid') {
        setPendingAuth({ paymentIntentId, amount: data.amount });
        return { error: 'Le client a déjà payé sur le terminal — voir la fenêtre de décision' };
      }
    } catch { /* best-effort : le message d'échec prime */ }
    return { error: message };
  };

  // Transaction terminal Stripe (server-driven) : envoie le montant au S710, poll le statut
  // jusqu'au paiement (requires_capture) puis capture. Retourne { paymentIntentId } ou { error }.
  const runTerminalPayment = async (amount, context = 'encaissement') => {
    // Paiement déjà capturé depuis la fenêtre de décision : on le consomme tel quel.
    const prepaid = prepaidRef.current;
    if (prepaid && Math.abs(prepaid.amount - amount) < 0.01) {
      prepaidRef.current = null;
      setTerminalStatus('done');
      setTerminalHint('');
      return { paymentIntentId: prepaid.paymentIntentId };
    }
    try {
      cancelRequestedRef.current = false;
      setTerminalAmount(amount);
      setTerminalStatus('collecting');
      setTerminalHint('');
      const { data } = await api.post('/payment/terminal/collect', {
        amount,
        metadata: terminalMetadata(context),
      });
      const paymentIntentId = data.paymentIntentId;
      if (cancelRequestedRef.current) {
        cancelRequestedRef.current = false;
        try { await api.post('/payment/terminal/cancel', { paymentIntentId }); } catch { /* lecteur libéré côté serveur */ }
        return { error: 'Paiement annulé' };
      }
      currentIntentRef.current = paymentIntentId;
      // 3 min : une carte refusée en sans contact est souvent représentée avec saisie du code.
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        if (currentIntentRef.current !== paymentIntentId) return { error: 'Paiement annulé' }; // annulé entre-temps
        let st;
        try {
          st = (await api.get('/payment/terminal/status', { params: { paymentIntentId } })).data;
        } catch {
          continue; // aléa réseau transitoire → on retente
        }
        if (st.status === 'requires_capture') { // client a payé
          setTerminalStatus('processing');
          setTerminalHint('');
          await api.post('/payment/terminal/capture', { paymentIntentId });
          currentIntentRef.current = null;
          // ⚠️ Sans ce retour à un état terminal, `terminalStatus` reste à 'processing' : le bouton
          // carte de la part SUIVANTE d'une addition séparée reste désactivé et plus aucun montant
          // n'est envoyé au lecteur. Le paiement simple n'était pas touché (son bouton n'en dépend pas).
          setTerminalStatus('done');
          return { paymentIntentId };
        }
        if (st.status === 'canceled') {
          currentIntentRef.current = null;
          setTerminalStatus('idle');
          setTerminalHint('');
          return { error: 'Paiement annulé' };
        }
        if (st.readerStatus === 'failed') { // le lecteur a rendu la main : échec définitif
          // `aborted` : on annule la transaction juste après, la carte ne peut plus être
          // représentée sur le lecteur — la consigne doit dire de relancer, pas de réessayer.
          return await abandonTerminal(paymentIntentId, declineLabel(st.errorCode, st.failureMessage || st.error, true));
        }
        // ⚠️ Refus intermédiaire (sans contact refusé, « PIN requis »…) : le lecteur redemande
        // la carte et le client va souvent réussir. On informe la caissière et on continue —
        // sortir ici laisserait une autorisation orpheline à capturer à la main.
        if (st.error) setTerminalHint(declineLabel(st.errorCode, st.error));
      }
      return await abandonTerminal(paymentIntentId, 'Délai dépassé, paiement non confirmé');
    } catch (err) {
      currentIntentRef.current = null;
      setTerminalStatus('error');
      return { error: err.response?.data?.message || 'Erreur terminal' };
    }
  };

  // Annulation manuelle de la transaction en cours (le caissier abandonne).
  const cancelTerminalNow = async () => {
    const paymentIntentId = currentIntentRef.current;
    currentIntentRef.current = null;
    setTerminalStatus('idle');
    setTerminalHint('');
    if (!paymentIntentId) { cancelRequestedRef.current = true; return; }
    try {
      const { data } = await api.post('/payment/terminal/cancel', { paymentIntentId });
      if (data?.outcome === 'already_paid') setPendingAuth({ paymentIntentId, amount: data.amount });
    } catch { /* le lecteur est libéré côté serveur ; rien à faire de plus ici */ }
  };

  // Décision de la caissière sur un paiement autorisé mais non encaissé.
  const capturePendingAuth = async () => {
    if (!pendingAuth) return;
    try {
      await api.post('/payment/terminal/capture', { paymentIntentId: pendingAuth.paymentIntentId });
      prepaidRef.current = { paymentIntentId: pendingAuth.paymentIntentId, amount: pendingAuth.amount };
      setPendingAuth(null);
      setTerminalStatus('idle');
      setTerminalHint(`Paiement de ${pendingAuth.amount.toFixed(2)} € encaissé — relancez « Encaisser » pour valider la commande`);
    } catch (err) {
      setOrderError(err.response?.data?.message || 'Capture impossible');
    }
  };

  const releasePendingAuth = async () => {
    if (!pendingAuth) return;
    try {
      await api.post('/payment/terminal/cancel', { paymentIntentId: pendingAuth.paymentIntentId, force: true });
    } catch { /* best-effort */ }
    setPendingAuth(null);
    setTerminalStatus('idle');
    setTerminalHint('');
  };

  // Panier → champs articles d'une commande (salades/plats/produits + legacy 1re salade).
  // Le nom libre d'un ticket ouvert (customerLabel) prime sur "Anonyme" mais pas sur un client choisi.
  const buildItemsPayload = () => {
    // Chaque salade distincte (formule + ingrédients) devient une entrée salads[] avec sa quantité.
    const salads = groupCartItems(cart)
      .filter(g => g.item.type === 'formula')
      .map(g => ({
        formula: g.item.formula,
        ingredients: g.item.ingredients || [],
        menu: isUpgradeMenu(g.item.menu) ? g.item.menu : null,
        menuProducts: isUpgradeMenu(g.item.menu) ? (g.item.menuProducts || []) : [],
        quantity: g.qty,
        subtotal: round2(g.lineTotal),
      }));
    const primary = salads[0] || null;
    const dishItems = cart.filter(i => i.type === 'dish');
    const productItems = cart.filter(i => i.type === 'product');
    const bubbleTeaItems = cart.filter(i => i.type === 'bubbletea');
    const milkshakeItems = cart.filter(i => i.type === 'milkshake');
    return {
      customerName: selectedClient?.name || customerLabel || 'Client Anonyme',
      totalPrice: cartTotal,
      consumptionMode, // sur place / à emporter → taux de TVA appliqué côté backend
      // Champs legacy (1re salade) pour rétrocompat des écrans qui lisent un seul `formula`.
      formula: primary?.formula || null,
      formulaQuantity: primary?.quantity || 1,
      ingredients: primary?.ingredients || [],
      salads,
      menu: salads.find(s => s.menu)?.menu || null,
      products: productItems.map(i => i.product),
      dishes: dishItems.map(i => ({ ...i.dish, selectedSides: i.selectedSides, menu: i.menu || null, menuProducts: i.menuProducts || [], subtotal: i.subtotal })),
      bubbleTeas: bubbleTeaItems.map(i => ({
        bubbleTeaId: i.bubbleTea?._id,
        name: i.bubbleTea?.name,
        price: i.bubbleTea?.price || 0,
        selections: i.selections || [],
        subtotal: i.subtotal,
        quantity: 1,
      })),
      milkshakes: milkshakeItems.map(i => ({
        milkshakeId: i.milkshake?._id,
        name: i.milkshake?.name,
        price: i.milkshake?.price || 0,
        selections: i.selections || [],
        subtotal: i.subtotal,
        quantity: 1,
      })),
    };
  };

  // Construit le payload commun et crée/encaisse la commande (panier → champs Order).
  const submitOrder = async (extra) => {
    const payload = {
      ...buildItemsPayload(),
      user: selectedClient?._id || null,
      pointsToRedeem,
      manualDiscount: round2(discountValue),
      discount: discountValue > 0
        ? { type: discountType, value: discountType === 'percent' ? Math.min(discountRaw, 100) : round2(discountValue), amount: round2(discountValue) }
        : null,
      source: 'caisse',
      ...extra,
    };
    // Commande récupérée (en ligne OU ticket ouvert) → on l'encaisse (update) au lieu d'en créer une nouvelle.
    const resumeId = onlineOrderId || openTicketId;
    const res = resumeId
      ? await settleOrder(resumeId, payload)
      : await createOrder(payload);
    return res?.data?.data || null; // commande persistée (id réel) pour un éventuel remboursement à chaud
  };

  // --- Tickets ouverts : chargement, ouverture, reprise, envoi cuisine ---
  const loadOpenTickets = async () => {
    setLoadingOpenTickets(true);
    try {
      const res = await fetchOpenTickets();
      setOpenTickets(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Chargement tickets ouverts échoué:', err);
    } finally {
      setLoadingOpenTickets(false);
    }
  };

  // Recharge la liste des tickets ouverts chaque fois qu'on revient à l'accueil caisse.
  useEffect(() => { if (step === 0) loadOpenTickets(); }, [step]);

  // Ouvre un nouveau ticket (nom libre) → compose la commande, encore en cuisine ni payée.
  const handleOpenNewTicket = () => {
    const label = ticketNameInput.trim();
    if (!label) return;
    setCustomerLabel(label);
    setTicketNameInput('');
    setOpenTicketMode(true);
    setOpenTicketId(null);
    setOpenTicketInKitchen(false);
    setSelectedClient(null);
    setOnlineOrderId(null);
    setCart([]);
    setClientMode(null);
    setTicketsPanelOpen(false);
    setStep(1);
  };

  // Reprend un ticket : 'open' → panier éditable ; déjà en cuisine → articles verrouillés + ajouts possibles.
  const handleResumeTicket = (o) => {
    if (unsavedPayment) return;
    const inKitchen = o.status !== 'open';
    // On repart d'un encaissement vierge : sans ça, reprendre une table depuis une autre note
    // lui faisait hériter des parts, de la remise et des points de la précédente. Le justificatif
    // de la dernière part reste disponible (il ne s'affiche que sur son propre ticket).
    const slip = partSlip;
    handleBackToHome();
    setPartSlip(slip);
    // Parts déjà encaissées (convives partis avant la fin). Elles pilotent le reste à payer et
    // verrouillent le mode de paiement : le solde ne peut se régler qu'en addition séparée,
    // le backend refusant une clôture simple qui les effacerait.
    const prepaid = (o.splitPayments || []).filter(p => p && Number(p.amount) > 0);
    setPrepaidParts(prepaid);
    if (prepaid.length) {
      setSplitEnabled(true);
      // « Par article » répartirait TOUS les articles du ticket alors qu'une partie est déjà
      // réglée : les articles ne quittent pas le ticket, seul le reste à payer diminue.
      setSplitMode('equal');
    }
    setOpenTicketMode(true);
    setOpenTicketId(o._id);
    setOpenTicketInKitchen(inKitchen);
    setCustomerLabel(o.customerName || 'Ticket');
    setSelectedClient(null);
    setOnlineOrderId(null);
    setCart(buildCartFromTicket(o, inKitchen));
    setClientMode(null);
    setTicketsPanelOpen(false);
    setStep(1);
  };

  // --- Commandes en ligne : reprise depuis le panneau ---

  // Rattache le client de la commande (fidélité), sinon retombe sur son nom comme libellé.
  const attachOnlineCustomer = async (o) => {
    setCustomerLabel(o.customerName || '');
    if (!o.user) return;
    try {
      const res = await getUserById(o.user);
      const client = res.data?.data || res.data || null;
      if (client?._id) setSelectedClient(client);
    } catch (err) {
      console.error('Client de la commande en ligne introuvable:', err);
    }
  };

  // Commande à régler sur place → panier verrouillé, encaissement via settleOrder (comme un ticket repris).
  const handleSettleOnlineOrder = async (o) => {
    setOnlinePanelOpen(false);
    setOpenTicketMode(false);
    setOpenTicketId(null);
    setOpenTicketInKitchen(false);
    setSelectedClient(null);
    setClientMode(null);
    setOnlineOrderId(o._id);
    setCart(buildLockedCartFromOnline(o));
    setStep(1);
    await attachOnlineCustomer(o);
  };

  // Commande déjà payée en ligne → nouveau ticket au nom du client (le supplément s'encaisse à part).
  const handleAddToOnlineOrder = async (o) => {
    setOnlinePanelOpen(false);
    setOpenTicketMode(false);
    setOpenTicketId(null);
    setOpenTicketInKitchen(false);
    setSelectedClient(null);
    setClientMode(null);
    setOnlineOrderId(null);
    setCart([]);
    setStep(1);
    await attachOnlineCustomer(o);
  };

  // Annule une commande en ligne depuis le panneau (la liste se met à jour via l'event socket).
  const handleCancelOnlineOrder = async (o) => {
    const id = o._id || o.id;
    setOnlineCancelTarget(null);
    try {
      await api.patch(`/orders/${id}/cancel`);
      if (onlineOrderId === id) handleBackToHome();   // commande en cours d'édition → on nettoie l'écran
    } catch (err) {
      console.error('Annulation commande en ligne échouée:', err);
    }
  };

  // Annule un ticket directement depuis le panneau « Tickets ouverts » (sans le reprendre).
  const handleCancelTicketFromPanel = async (o) => {
    setTicketCancelTarget(null);
    try {
      await api.patch(`/orders/${o._id}/cancel`);
      if (openTicketId === o._id) handleBackToHome(); // ticket en cours d'édition → on nettoie l'écran
      await loadOpenTickets();
    } catch (err) {
      console.error('Annulation ticket échouée:', err);
    }
  };

  // Paiements faits avec « Séparer l'addition » : gardés à l'écran, ils ne sont enregistrés
  // qu'à la clôture de la table. Reposer la table sans les enregistrer les perdait — le 26/09,
  // les 8,20 € d'un convive de la Table 5 ont dû être ressaisis à la main. On les écrit donc
  // sur le ticket comme des parts réglées d'avance, exactement comme « Encaisser une part ».
  // Une part sans client propre relève du client de la note, comme à la clôture (createOrder).
  const buildSettledPartPayloads = () => {
    if (!splitEnabled) return [];
    const out = [];
    parts.forEach(p => {
      const items = [...(p.items || []), ...(p.extraItems || [])]
        .map(it => ({ label: it.label, price: round2(it.price) }));
      const payer = p.client || selectedClient || null;
      (p.settled || []).forEach((t, k) => {
        out.push({
          tx: t,
          payload: {
            amount: round2(t.covered), method: t.method, splitMode,
            ...(k === 0 && splitMode === 'item' && items.length ? { items } : {}),
            ...(t.pointsRedeemed > 0 ? { pointsRedeemed: t.pointsRedeemed } : {}),
            ...(payer?._id ? { user: payer._id, userName: payer.name || null } : {}),
            cashGiven: t.cashGiven || 0, change: t.change || 0,
            paymentIntentId: t.paymentIntentId || null,
            cardAmount: t.cardAmount || 0, ticketAmount: t.ticketAmount || 0, cashAmount: t.cashAmount || 0,
            ...(t.cardPayments?.length ? { cardPayments: t.cardPayments } : {}),
          },
        });
      });
    });
    return out;
  };

  // Enregistre la note (articles puis paiements déjà faits) et revient à l'accueil.
  // Les articles d'abord : le serveur plafonne une part sur le total qu'il connaît. Un paiement
  // enregistré est mémorisé, pour qu'un nouvel essai après une erreur ne l'écrive pas deux fois.
  const persistTicketAndLeave = async (status, errorMessage) => {
    if (cardInFlight || prepaidRef.current) {
      setOrderError(CARD_IN_FLIGHT_HINT);
      return;
    }
    setSubmitting(true);
    setOrderError('');
    try {
      const items = buildItemsPayload();
      let ticketId = openTicketId;
      if (ticketId) {
        await updateOpenTicketItems(ticketId, { ...items, status });
      } else {
        const res = await createOrder({ ...items, user: null, source: 'caisse', paymentMethod: 'onsite', status });
        const created = res.data?.data || res.data;
        ticketId = created?._id || created?.id;
        setOpenTicketId(ticketId);
      }
      for (const { tx, payload } of buildSettledPartPayloads()) {
        if (recordedTxRef.current.has(tx)) continue;
        await recordPartPayment(ticketId, payload);
        recordedTxRef.current.add(tx);
      }
      handleBackToHome();
    } catch (err) {
      setOrderError(err.response?.data?.message || errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // Met le ticket de côté (persiste) sans l'encaisser : reste 'open' s'il n'est pas en cuisine.
  // Un ticket 'open' peut être vide (réserver une table/un nom et garnir plus tard).
  // En cuisine → on garde 'pending' (les ajouts éventuels y sont poussés).
  const handleHoldTicket = () =>
    persistTicketAndLeave(openTicketInKitchen ? 'pending' : 'open', 'Erreur lors de la mise en attente');

  // Envoie le ticket en cuisine (lance la prépa) sans encaisser : 'open' → 'pending'.
  const handleSendToKitchen = () => {
    if (cart.length === 0) return;
    return persistTicketAndLeave('pending', "Erreur lors de l'envoi en cuisine");
  };

  // Retour à l'accueil caisse en repartant d'un état propre (sans naviguer hors de la caisse).
  // L'encaissement est remis à zéro lui aussi : les parts déjà réglées d'une table reposée
  // resteraient sinon chargées, et la vente suivante hériterait de son « Déjà réglé ».
  const handleBackToHome = () => {
    setStep(0);
    setMaxStep(0);
    setCart([]);
    setSelectedClient(null);
    setClientMode(null);
    setOnlineOrderId(null);
    setOpenTicketMode(false);
    setOpenTicketId(null);
    setOpenTicketInKitchen(false);
    setCustomerLabel('');
    setClientPickQ('');
    setClientPickResults([]);
    setPayMode('cash');
    setCashGiven('');
    setTicketKind('paper');
    setMixedPassages([newPassage()]);
    setTicketGiven('');
    setPointsToRedeem(0);
    setDiscountInput('');
    setDiscountType('percent');
    setOrderError('');
    setTerminalStatus('idle');
    resetSplit();
  };

  // Articles du panier formatés pour le ticket (label, prix, détail accompagnements/ingrédients).
  const buildCartItems = () => groupCartItems(cart).map(({ item: it, qty, lineTotal }) => ({
    label: qty > 1 ? `${qty}× ${it.label}` : it.label,
    price: round2(lineTotal),
    details: it.type === 'dish'
      ? [
          it.selectedSides?.length ? it.selectedSides.map(s => s.name).join(', ') : '',
          isUpgradeMenu(it.menu) ? `${it.menu.name}${it.menuProducts?.length ? ' : ' + it.menuProducts.map(p => p.name).join(', ') : ''}` : '',
        ].filter(Boolean).join(' — ')
      : it.type === 'formula'
        ? [
            it.ingredients?.length ? it.ingredients.map(i => i.name).join(', ') : '',
            isUpgradeMenu(it.menu) ? `${it.menu.name}${it.menuProducts?.length ? ' : ' + it.menuProducts.map(p => p.name).join(', ') : ''}` : '',
          ].filter(Boolean).join(' — ')
        : it.type === 'bubbletea'
          ? Object.entries((it.selections || []).reduce((acc, s) => {
              const c = s.category || 'Options'; (acc[c] = acc[c] || []).push(s.name); return acc;
            }, {})).map(([c, names]) => `${c}: ${names.join(', ')}`).join(' · ')
          : it.type === 'product' && (it.selectedExtras || it.product?.selectedExtras || []).length
            ? '+ ' + (it.selectedExtras || it.product?.selectedExtras || []).map(e => e.name).join(', ')
            : '',
  }));

  // Regroupement par type/nature (avec quantité) pour le ticket « sans détail ».
  const buildTypeSummary = () => {
    const PRODUCT_TYPE = { drink: 'Boisson', coffee: 'Boisson', dessert: 'Dessert', side: 'Accompagnement' };
    const counts = {};
    const order = [];
    const add = (label, qty) => {
      if (!(label in counts)) order.push(label);
      counts[label] = (counts[label] || 0) + qty;
    };
    groupCartItems(cart).forEach(({ item: it, qty }) => {
      const label = it.type === 'formula' ? 'Salade'
        : it.type === 'dish' ? 'Plat chaud'
        : it.type === 'bubbletea' ? 'Bubble tea'
        : it.type === 'milkshake' ? 'Milkshake'
        : it.type === 'product' ? (PRODUCT_TYPE[it.product?.category] || 'Produit')
        : 'Article';
      add(label, qty);
      // Produits inclus dans un menu (salade/plat en menu L/XL) → comptés par nature.
      if (it.type === 'formula' || it.type === 'dish') {
        (it.menuProducts || []).forEach(mp => add(PRODUCT_TYPE[mp.category] || 'Produit', qty));
      }
    });
    return order.map(label => ({ label: `${counts[label]}× ${label}` }));
  };

  // Lignes normalisées { key, label, price } pour la sélection au remboursement (mêmes regroupements que le ticket).
  const buildRefundLines = () => groupCartItems(cart).map(({ item: it, qty, lineTotal }, i) => ({
    key: `it-${i}`,
    label: qty > 1 ? `${qty}× ${it.label}` : it.label,
    price: round2(lineTotal),
  }));

  // Remboursement à chaud de la commande qu'on vient d'encaisser.
  const handleRefundCaisse = async (payload) => {
    if (!lastOrder?._id) return;
    setRefundSubmitting(true);
    try {
      const res = await refundOrder(lastOrder._id, payload);
      // Le serveur peut avoir remboursé un montant différent (Stripe interrompu) → il fait foi.
      const applied = res?.data?.data?.refunds?.slice(-1)[0]?.amount;
      setRefundedInfo({ amount: applied != null ? applied : payload.amount });
      setRefundOpen(false);
    } catch (err) {
      setOrderError(err.response?.data?.message || 'Erreur lors du remboursement');
      setRefundOpen(false);
    } finally {
      setRefundSubmitting(false);
    }
  };

  // Saisie des points à utiliser : clampée à [0, max], le mode "par article" est incompatible (remise globale).
  const setPoints = (value) => {
    let n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    n = Math.min(n, maxRedeemablePoints);
    if (n > 0 && splitEnabled && splitMode === 'item') setSplitMode('equal');
    setPointsToRedeem(n);
  };

  // Saisie de la remise commerciale : le mode "par article" (remise globale) est incompatible.
  const setDiscount = (value) => {
    setDiscountInput(value);
    const v = Math.max(0, parseFloat(value) || 0);
    if (v > 0 && splitEnabled && splitMode === 'item') setSplitMode('equal');
  };
  const clearDiscount = () => setDiscountInput('');

  // Mode mixte simple : passe UNE des cartes au terminal (le lecteur n'en traite qu'une à la fois).
  const payMixedPassage = async (id) => {
    const passage = mixedPassages.find(p => p.id === id);
    const amount = passageAmount(passage);
    if (!passage || amount <= 0) return;
    setOrderError('');
    setSubmitting(true);
    const res = await runTerminalPayment(amount, passage.kind === 'meal_card' ? 'paiement mixte — titre-restaurant' : 'paiement mixte — carte');
    setSubmitting(false);
    if (res.error) { setOrderError(res.error); return; }
    setMixedPassages(prev => prev.map(p => (p.id === id ? { ...p, paymentIntentId: res.paymentIntentId } : p)));
  };

  const handleSubmitOrder = async () => {
    if (cart.length === 0) return;
    // net = 0 → réglé intégralement en points, aucun encaissement requis.
    if (netTotal > 0) {
      if (payMode === 'cash' && (cashGiven === '' || cashGivenNum < netTotal)) {
        setOrderError('Montant insuffisant ou non renseigné');
        return;
      }
      if (payMode === 'ticket' && ticketKind === 'paper' && !paperTicketOk(ticketGiven, netTotal)) {
        setOrderError('Montant des tickets insuffisant ou non renseigné');
        return;
      }
      if (payMode === 'mixed') {
        if (mixedCardPending) { setOrderError('Encaissez chaque ligne avant de valider'); return; }
        if (mixedSum.rest > 0.001) { setOrderError(`Reste ${mixedSum.rest.toFixed(2)} € à régler`); return; }
      }
    }
    setOrderError('');
    setSubmitting(true);
    try {
      let cardIntentId = null;
      // Carte bancaire, ou titre-restaurant sur carte : les deux passent au terminal.
      const mealCard = payMode === 'ticket' && ticketKind === 'card';
      if (netTotal > 0 && (payMode === 'card' || mealCard)) {
        const res = await runTerminalPayment(netTotal, mealCard ? 'titre-restaurant' : 'encaissement carte');
        if (res.error) { setOrderError(res.error); setSubmitting(false); return; }
        cardIntentId = res.paymentIntentId;
        setTerminalStatus('done');
      }
      const effectiveMethod = netTotal === 0 ? 'points' : payMode;
      // Carte simple comme mixte : on persiste le paymentIntentId — sans lui, aucun remboursement
      // Stripe possible depuis l'Espace Gérant (seule une trace locale resterait).
      const mealCardPayments = mealCard ? [{ amount: round2(netTotal), kind: 'meal_card', paymentIntentId: cardIntentId }] : null;
      const paymentDetails = netTotal <= 0 ? undefined
        : payMode === 'mixed'
          ? {
              ...terminalFields(mixedPassages), cashAmount: mixedCashNum, cashGiven: mixedSum.cashGiven, change: mixedChange,
              ticketAmount: mixedTicketNum, ...(mixedSum.ticketGiven > mixedTicketNum ? { ticketGiven: mixedSum.ticketGiven } : {}),
            }
          : payMode === 'card'
            ? { cardAmount: round2(netTotal), paymentIntentId: cardIntentId }
            : mealCard
              ? { cardPayments: mealCardPayments, mealCardAmount: round2(netTotal), ticketAmount: 0, paymentIntentId: cardIntentId }
              : payMode === 'ticket'
                // ticketAmount = l'addition (c'est lui que la compta additionne) ; ticketGiven = remis.
                ? { ticketAmount: round2(netTotal), ticketGiven: round2(parseFloat(ticketGiven) || 0) }
                : undefined;
      const created = await submitOrder({ paymentMethod: effectiveMethod, ...(paymentDetails ? { paymentDetails } : {}) });
      setLastOrder(created);
      setReceipt({
        customerName: selectedClient?.name || customerLabel || 'Client Anonyme',
        createdAt: new Date(),
        total: round2(cartTotal),
        discountValue: round2(discountValue),
        discountLabel: discountType === 'percent' && discountValue > 0 ? `${Math.min(discountRaw, 100)} %` : null,
        pointsRedeemed: pointsToRedeem,
        pointsDiscount,
        netTotal: round2(netTotal),
        isSplit: false,
        splitMode: null,
        cartItems: buildCartItems(),
        itemCount: cart.length,
        typeSummary: buildTypeSummary(),
        tax: taxView,
        serviceRate: taxConfig?.serviceRate || 0,
        parts: [],
        payment: {
          method: effectiveMethod,
          cashGiven: effectiveMethod === 'cash' ? cashGivenNum : effectiveMethod === 'mixed' ? mixedSum.cashGiven : null,
          change: effectiveMethod === 'cash' ? round2(change) : effectiveMethod === 'mixed' ? mixedChange : null,
          cardAmount: effectiveMethod === 'mixed' ? mixedCardNum : null,
          cardPayments: effectiveMethod === 'mixed' ? toCardPayments(mixedPassages) : mealCardPayments,
          cashAmount: effectiveMethod === 'mixed' ? mixedCashNum : null,
          ticketAmount: effectiveMethod === 'mixed' ? mixedTicketNum : effectiveMethod === 'ticket' && !mealCard ? round2(netTotal) : null,
        },
      });
      setOrderDone(true);
    } catch (err) {
      setOrderError(err.response?.data?.message || 'Erreur lors de la validation');
    } finally {
      setSubmitting(false);
    }
  };

  // ===== SPLIT (séparation d'addition) =====

  // Après paiement de la part active, active la première part non réglée restante (modes 'equal'/'free').
  // On n'avance QUE sur une part réellement payée : ne jamais sauter une part à 0 € (montant pas encore saisi en mode libre).
  useEffect(() => {
    if (!splitEnabled || splitMode === 'item') return;
    const cur = parts[currentPartIdx];
    if (cur && isPartPaid(cur)) {
      const nextUnpaid = parts.findIndex(p => !isPartPaid(p) && p.amount > 0);
      if (nextUnpaid !== -1 && nextUnpaid !== currentPartIdx) setCurrentPartIdx(nextUnpaid);
    }
  }, [parts, currentPartIdx, splitEnabled, splitMode]);

  // Mode 'item' : après paiement d'une part, ouvre une nouvelle part active s'il reste des articles.
  useEffect(() => {
    if (!splitEnabled || splitMode !== 'item' || parts.length === 0) return;
    const last = parts[parts.length - 1];
    if (isPartPaid(last) && availableItems.length > 0) {
      setParts(prev => [...prev, emptyPart()]);
      setCurrentPartIdx(parts.length);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, splitEnabled, splitMode]);

  // --- Ajout d'articles après un premier encaissement ---

  // Attribue un article en attente à une part : son dû augmente, elle se ré-ouvre si elle était soldée.
  const assignPendingToPart = (partIdx) => {
    const item = pendingAssign[0];
    if (!item) return;
    setParts(prev => prev.map((p, i) => i === partIdx
      ? {
          ...p,
          amount: round2((p.amount || 0) + item.price),
          items: [...(p.items || []), { id: item.id, label: item.label, price: round2(item.price) }],
        }
      : p));
    setPendingAssign(prev => prev.slice(1));
    if (pendingAssign.length <= 1) setAssignOpen(false);
    setCurrentPartIdx(partIdx);
    setSplitError('');
  };

  // Étale l'article sur TOUTES les parts, y compris celles déjà réglées — chacune redevient
  // redevable de son complément. La quote-part est tracée dans `extraItems` : en mode « par
  // article », le dû d'une part se recalcule depuis ses articles, elle serait sinon perdue.
  const spreadPendingEqually = () => {
    const item = pendingAssign[0];
    if (!item || parts.length === 0) return;
    const adds = buildEqualAmounts(round2(item.price), parts.length);
    setParts(prev => prev.map((p, i) => ({
      ...p,
      amount: round2((p.amount || 0) + adds[i]),
      extraItems: [...(p.extraItems || []), { label: `${item.label} (partagé)`, price: adds[i] }],
    })));
    setSpreadIds(prev => [...prev, item.id]);
    setPendingAssign(prev => prev.slice(1));
    if (pendingAssign.length <= 1) setAssignOpen(false);
    setSplitError('');
  };

  // Attribue l'article en attente à une part neuve (créée à la volée).
  const assignPendingToNewPart = () => {
    const item = pendingAssign[0];
    if (!item) return;
    setParts(prev => [...prev, {
      ...emptyPart(),
      amount: round2(item.price),
      items: [{ id: item.id, label: item.label, price: round2(item.price) }],
    }]);
    setSplitCount(c => c + 1);
    setCurrentPartIdx(parts.length);
    setPendingAssign(prev => prev.slice(1));
    if (pendingAssign.length <= 1) setAssignOpen(false);
    setSplitError('');
  };

  // Ajoute une part, même après le début de l'encaissement.
  // En 'equal', le reste (total − dû des parts déjà entamées) est re-réparti sur les parts
  // encore vierges + la nouvelle ; les parts entamées gardent leur dû tel quel.
  const addPart = () => {
    setParts(prev => {
      const next = [...prev, emptyPart()];
      if (splitMode !== 'equal') return next;
      const frozenSum = round2(next.filter(partStarted).reduce((s, p) => s + (p.amount || 0), 0));
      const openCount = next.filter(p => !partStarted(p)).length;
      if (openCount === 0) return next;
      // Les articles encore en attente d'attribution comptent déjà dans netTotal : les inclure
      // ici les ferait payer deux fois (une fois réparti, une fois attribué).
      const pendingSum = round2(pendingAssign.reduce((s, it) => s + it.price, 0));
      const amounts = buildEqualAmounts(round2(Math.max(0, splitBase - pendingSum - frozenSum)), openCount);
      let k = 0;
      return next.map(p => (partStarted(p) ? p : { ...p, amount: amounts[k++] }));
    });
    setSplitCount(c => c + 1);
    setSplitError('');
  };

  const setPartAmount = (i, value) => {
    setParts(prev => prev.map((p, idx) => idx === i ? { ...p, amount: round2(parseFloat(value) || 0) } : p));
  };

  // --- Identification client par part (fidélité par part) ---
  const setPartClient = (i, client) => {
    setParts(prev => prev.map((p, idx) => idx === i ? { ...p, client } : p));
  };
  const clearPartClient = (i) => setPartClient(i, null);
  const openNewClientForPart = (i) => { setQuickClientPartIdx(i); setQuickClientOpen(true); };

  // Points utilisés par la part : plafonnés au solde du client ET à la valeur du montant de la part.
  // Modifier les points réinitialise le paiement en cours (le net à encaisser change).
  // Saisie de paiement remise à zéro (méthode, cartes, tickets, espèces).
  const PART_PAYMENT_RESET = { method: null, passages: [newPassage()], ticketAmount: 0, ticketKind: 'paper', ticketGiven: '', cashGiven: '', paymentIntentId: null };
  // Une carte déjà passée sur le règlement en cours : en changer le montant ou la méthode
  // effacerait un débit réel sans trace.
  const PART_CARD_LOCK_HINT = 'Une carte a déjà été passée sur cette part : terminez son règlement.';

  const setPartPoints = (i, value) => {
    if (passagesStarted(parts[i]?.passages)) { setSplitError(PART_CARD_LOCK_HINT); return; }
    setParts(prev => prev.map((p, idx) => {
      if (idx !== i) return p;
      const cap = Math.min(p.client?.loyaltyPoints || 0, maxPointsForEuros(partRemaining(p)));
      const pts = Math.max(0, Math.min(Math.floor(parseFloat(value) || 0), cap));
      return { ...p, ...PART_PAYMENT_RESET, pointsRedeemed: pts };
    }));
    setSplitError('');
  };

  // Enregistre le règlement en cours d'une part dans son historique, puis remet à zéro la
  // saisie : la part peut ainsi recevoir un complément si son dû augmente plus tard.
  const settlePart = (idx, extra = {}) => {
    setEncaissementStarted(true);
    setParts(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const covered = partRemaining(p);
      const pts = p.pointsRedeemed || 0;
      const net = round2(Math.max(0, covered - pointsToEuros(pts)));
      const method = extra.method || p.method;
      const given = parseFloat(p.cashGiven) || 0;
      let tx = { covered, pointsRedeemed: pts, method };
      if (method === 'cash') {
        tx = { ...tx, cashGiven: given, change: round2(given - net) };
      } else if (method === 'card') {
        tx = { ...tx, paymentIntentId: extra.paymentIntentId || p.paymentIntentId || null };
      } else if (method === 'ticket') {
        // Carte titre-restaurant : passée au terminal, à rembourser et rapprocher comme une carte.
        tx = p.ticketKind === 'card'
          ? {
              ...tx, ticketAmount: 0, mealCardAmount: net,
              cardPayments: [{ amount: net, kind: 'meal_card', paymentIntentId: extra.paymentIntentId || null }],
              paymentIntentId: extra.paymentIntentId || null,
            }
          : { ...tx, ticketAmount: net, ticketGiven: round2(parseFloat(p.ticketGiven) || 0) };
      } else if (method === 'mixed') {
        const m = mixedSummary(p.passages, net);
        tx = {
          ...tx,
          ...terminalFields(p.passages),
          ticketAmount: m.ticketAmount,
          cashAmount: m.cashAmount, cashGiven: m.cashGiven, change: m.change,
        };
      }
      return {
        ...p,
        settled: [...(p.settled || []), tx],
        ...PART_PAYMENT_RESET,
        pointsRedeemed: 0,
      };
    }));
    setSplitError('');
  };

  // Part entièrement réglée par les points (net = 0) : validée sans encaissement.
  const payPartWithPoints = () => settlePart(currentPartIdx, { method: 'points' });

  // Mode 'item' : (dé)sélection d'un article dans la part active. Changer la sélection réinitialise le paiement en cours.
  const toggleItemInActivePart = (item) => {
    if (passagesStarted(parts[currentPartIdx]?.passages)) { setSplitError(PART_CARD_LOCK_HINT); return; }
    setParts(prev => prev.map((p, idx) => {
      if (idx !== currentPartIdx) return p;
      const has = (p.items || []).some(it => it.id === item.id);
      const items = has
        ? p.items.filter(it => it.id !== item.id)
        : [...(p.items || []), { id: item.id, label: item.label, price: round2(item.price) }];
      // Le dû = articles cochés + quotes-parts déjà reçues d'un article partagé.
      return { ...p, ...PART_PAYMENT_RESET, items, amount: round2(items.reduce((s, it) => s + it.price, 0) + partExtra(p)) };
    }));
    setSplitError('');
  };

  const selectAllRemainingInActivePart = () => {
    if (passagesStarted(parts[currentPartIdx]?.passages)) { setSplitError(PART_CARD_LOCK_HINT); return; }
    const items = availableItems.map(it => ({ id: it.id, label: it.label, price: round2(it.price) }));
    setParts(prev => prev.map((p, idx) => idx === currentPartIdx
      ? { ...p, ...PART_PAYMENT_RESET, items, amount: round2(items.reduce((s, it) => s + it.price, 0) + partExtra(p)) }
      : p));
    setSplitError('');
  };

  const choosePartMethod = (method) => {
    if (passagesStarted(parts[currentPartIdx]?.passages)) { setSplitError(PART_CARD_LOCK_HINT); return; }
    setParts(prev => prev.map((p, idx) => (idx === currentPartIdx ? { ...p, ...PART_PAYMENT_RESET, method } : p)));
    setSplitError('');
  };

  // Part mixte : cartes passées au terminal (une ou plusieurs).
  const setPartPassages = (passages) => {
    setParts(prev => prev.map((p, idx) => (idx === currentPartIdx ? { ...p, passages } : p)));
  };

  // Part « Tickets resto » : papier ou carte titre-restaurant.
  const setPartTicketKind = (ticketKind) => {
    setParts(prev => prev.map((p, idx) => (idx === currentPartIdx ? { ...p, ticketKind } : p)));
  };

  const setPartTicketGiven = (ticketGiven) => {
    setParts(prev => prev.map((p, idx) => (idx === currentPartIdx ? { ...p, ticketGiven } : p)));
  };

  const setPartCashGiven = (value) => {
    setParts(prev => prev.map((p, idx) => idx === currentPartIdx ? { ...p, cashGiven: value } : p));
  };

  // Carte seule, ou titre-restaurant sur carte : tout le net de la part passe au terminal.
  const payPartCard = async () => {
    const p = parts[currentPartIdx];
    const amount = partNetOf(p);
    if (amount <= 0) return;
    setEncaissementStarted(true);
    setSplitError('');
    setSubmitting(true);
    const res = await runTerminalPayment(amount, `addition séparée — part ${currentPartIdx + 1}`);
    setSubmitting(false);
    if (res.error) { setSplitError(res.error); return; }
    settlePart(currentPartIdx, { paymentIntentId: res.paymentIntentId });
  };

  // Mixte : une des cartes de la part. Le règlement se clôt à l'étape espèces, une fois toutes
  // les cartes passées.
  const payPartPassage = async (id) => {
    const passage = parts[currentPartIdx]?.passages.find(c => c.id === id);
    const amount = passageAmount(passage);
    if (!passage || amount <= 0) return;
    setSplitError('');
    setSubmitting(true);
    const res = await runTerminalPayment(amount, `addition séparée — part ${currentPartIdx + 1}`);
    setSubmitting(false);
    if (res.error) { setSplitError(res.error); return; }
    setParts(prev => prev.map((pp, idx) => idx === currentPartIdx
      ? { ...pp, passages: pp.passages.map(c => (c.id === id ? { ...c, paymentIntentId: res.paymentIntentId } : c)) }
      : pp));
  };

  const payPartCash = () => {
    const p = parts[currentPartIdx];
    if (p.method === 'mixed') {
      const m = mixedSummary(p.passages, partNetOf(p));
      if (m.pending) { setSplitError('Encaissez chaque ligne avant de valider'); return; }
      if (m.rest > 0.001) { setSplitError(`Reste ${m.rest.toFixed(2)} € à régler sur cette part`); return; }
      settlePart(currentPartIdx);
      return;
    }
    const due = partNetOf(p);
    const given = parseFloat(p.cashGiven) || 0;
    if (given < due - 0.001) { setSplitError('Montant insuffisant'); return; }
    settlePart(currentPartIdx);
  };

  // Part réglée intégralement en tickets restaurant (sans rendu).
  const payPartTicket = () => settlePart(currentPartIdx);

  // Un ticket composé mais jamais enregistré n'existe pas côté serveur : il ne peut donc pas
  // recevoir de règlement. On le crée ici, au premier encaissement de part, plutôt que d'exiger
  // un « Mettre en attente » ou un envoi en cuisine préalable que rien à l'écran n'annonce.
  // Un ticket repris est d'abord réenregistré avec les articles ajoutés depuis : le serveur
  // plafonne la part sur le total qu'il connaît (sinon une part couvrant un ajout est refusée
  // APRÈS le débit de la carte), et la caisse revient à l'accueil une fois la part encaissée.
  const openPartPayment = async () => {
    setSubmitting(true);
    setOrderError('');
    try {
      if (openTicketId) {
        await updateOpenTicketItems(openTicketId, {
          ...buildItemsPayload(), status: openTicketInKitchen ? 'pending' : 'open',
        });
      } else {
        const res = await createOrder({
          ...buildItemsPayload(), user: null, source: 'caisse', paymentMethod: 'onsite', status: 'open',
        });
        const created = res.data?.data || res.data;
        setOpenTicketId(created?._id || created?.id);
      }
      setPartPayOpen(true);
    } catch (err) {
      setOrderError(err.response?.data?.message || "Erreur lors de l'enregistrement du ticket");
    } finally {
      setSubmitting(false);
    }
  };

  // Un convive s'en va et règle sa part : le règlement est persisté sur le ticket, qui reste
  // ouvert pour le reste de la table. Le solde ne pourra plus être réglé en paiement simple —
  // le backend refuse une clôture qui effacerait les parts déjà encaissées.
  // La caisse revient ensuite à l'accueil : rester sur la table invitait à y saisir la vente
  // du client suivant, qui se retrouvait sur la note de la table. On la rouvre par « Reprendre ».
  const handlePartPaid = async (payload) => {
    setOrderError('');
    setSubmitting(true);
    try {
      const ticketId = openTicketId;
      const ticketLabel = customerLabel;
      const res = await recordPartPayment(ticketId, payload);
      const updated = res.data?.data || res.data;
      // Justificatif construit depuis la part PERSISTÉE (et non depuis le payload) : c'est
      // exactement ce que l'email, le SMS et l'historique rendront — aucune divergence possible.
      const entries = updated?.splitPayments || [];
      const last = entries[entries.length - 1];
      handleBackToHome();
      if (last) {
        // Posé APRÈS handleBackToHome, qui efface le justificatif : il reste consultable depuis
        // l'accueil, rattaché à son ticket par `orderId` (la caisse n'a plus de ticket ouvert).
        setPartSlip({
          orderId: ticketId,
          label: ticketLabel,
          index: last.index ?? entries.length,
          amount: round2(Math.max(0, (Number(last.amount) || 0) - pointsToEuros(last.pointsRedeemed || 0))),
          email: partPayClient?.email || null,
          phone: partPayClient?.phone || null,
          ticket: partToTicket(updated, last),
        });
        // L'impression n'est plus automatique : la caissière décide ticket par ticket. Un refus
        // ne perd rien — le bandeau garde Imprimer / Email / SMS sur la part encaissée.
        setAskPrintSlip(true);
      }
    } catch (err) {
      setOrderError(err.response?.data?.message || "Erreur lors de l'encaissement de la part");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitSplit = async () => {
    if (!canFinalizeSplit) return;
    setOrderError('');
    setSubmitting(true);
    try {
      // Une part réglée en plusieurs fois (article attribué après un premier encaissement) est
      // APLATIE en autant d'entrées `splitPayments` que de règlements, toutes portant le même
      // numéro de part. Le backend n'a ainsi rien à connaître du multi-règlements : la compta,
      // la fidélité par client et les remboursements Stripe raisonnent par entrée.
      const splitPayments = [];
      const receiptParts = []; // vue FUSIONNÉE (une entrée par part) pour les tickets
      parts.forEach((p, i) => {
        if (!(p.amount > 0) || !(p.settled || []).length) return; // part vide ou jamais encaissée
        const index = i + 1;
        // Les quotes-parts d'articles partagés comptent dans le dû : sans elles, les lignes du
        // ticket de part ne totaliseraient pas son montant.
        const allItems = [
          ...(p.items || []).map(it => ({ label: it.label, price: round2(it.price) })),
          ...(p.extraItems || []).map(it => ({ label: it.label, price: round2(it.price) })),
        ];
        const items = allItems.length ? allItems : undefined;
        // Client de la part (null → le backend rattache la part au client global de la commande).
        const partUser = p.client?._id || null;
        p.settled.forEach((t, k) => {
          const net = round2(Math.max(0, t.covered - pointsToEuros(t.pointsRedeemed || 0)));
          const base = {
            index, amount: round2(t.covered), method: t.method,
            // Les articles ne sont portés que par la 1re entrée de la part : ils décrivent la
            // part entière, les répéter les compterait plusieurs fois à la lecture.
            ...(k === 0 && splitMode === 'item' && items ? { items } : {}),
            ...(partUser ? { user: partUser, userName: p.client?.name || null } : {}),
            ...(t.pointsRedeemed > 0 ? { pointsRedeemed: t.pointsRedeemed } : {}),
          };
          if (t.method === 'points') {           // règlement intégralement absorbé par les points
            splitPayments.push(base);
          } else if (t.method === 'cash') {
            splitPayments.push({ ...base, cashGiven: t.cashGiven || 0, change: round2(t.change || 0) });
          } else if (t.method === 'card') {
            splitPayments.push({ ...base, paymentIntentId: t.paymentIntentId || null });
          } else if (t.method === 'ticket') {
            splitPayments.push(t.cardPayments?.length
              ? { ...base, ticketAmount: 0, mealCardAmount: round2(net), cardPayments: t.cardPayments, paymentIntentId: t.paymentIntentId || null }
              : { ...base, ticketAmount: round2(net), ...(t.ticketGiven > 0 ? { ticketGiven: t.ticketGiven } : {}) });
          } else {
            splitPayments.push({
              ...base,
              cardAmount: round2(t.cardAmount || 0),
              ...(t.cardPayments?.length ? { cardPayments: t.cardPayments, mealCardAmount: round2(t.mealCardAmount || 0) } : {}),
              ticketAmount: round2(t.ticketAmount || 0),
              paymentIntentId: t.paymentIntentId || null,
              cashAmount: round2(t.cashAmount || 0),
              cashGiven: t.cashGiven || 0,
              change: round2(t.change || 0),
            });
          }
        });
        receiptParts.push({
          index,
          amount: round2(p.amount),
          // Hors mode « par article », une part paie un montant, pas une liste d'articles :
          // n'y faire figurer que l'ajout attribué donnerait un ticket incohérent avec son total.
          items: splitMode === 'item' ? (items || []) : [],
          payments: p.settled,
          pointsRedeemed: partPointsTotal(p),
          client: p.client || null,
        });
      });
      // Parts encaissées avant cette session (convives partis) : elles ne sont PAS renvoyées au
      // backend — il les conserve lui-même (mergeSplitPayments) — mais elles doivent figurer sur
      // le ticket de la table, sinon la note affiche moins que ce qui a été payé. Les numéros
      // suivent la renumérotation du backend : acomptes d'abord, solde ensuite.
      const offset = prepaidParts.length;
      if (offset) {
        for (const rp of receiptParts) rp.index += offset;
        receiptParts.unshift(...prepaidParts.map((p, i) => ({
          index: i + 1,
          amount: round2(Number(p.amount) || 0),
          items: (p.items || []).map(it => ({ label: it.label, price: round2(it.price) })),
          payments: [{
            method: p.method, covered: round2(Number(p.amount) || 0),
            pointsRedeemed: p.pointsRedeemed || 0,
            cashGiven: p.cashGiven || 0, change: p.change || 0,
            cardAmount: p.cardAmount || 0, ticketAmount: p.ticketAmount || 0, cashAmount: p.cashAmount || 0,
            ...(p.cardPayments?.length ? { cardPayments: p.cardPayments } : {}),
          }],
          pointsRedeemed: p.pointsRedeemed || 0,
          client: p.userName ? { name: p.userName } : null,
        })));
      }
      const effectiveCount = receiptParts.length;
      const created = await submitOrder({ paymentMethod: 'split', isSplit: true, splitMode, splitCount: effectiveCount, splitPayments });
      // Points utilisés par part → réduisent le net réellement encaissé du split.
      // Points des acomptes inclus : ils ont réduit ce que la table a réellement versé.
      const splitPointsRedeemed = parts.reduce((s, p) => s + partPointsTotal(p), 0)
        + prepaidParts.reduce((s, p) => s + (Number(p.pointsRedeemed) || 0), 0);
      const splitPointsDiscount = round2(pointsToEuros(splitPointsRedeemed));
      setLastOrder(created);
      setReceipt({
        customerName: selectedClient?.name || customerLabel || 'Client Anonyme',
        createdAt: new Date(),
        total: round2(cartTotal),
        discountValue: round2(discountValue),
        discountLabel: discountType === 'percent' && discountValue > 0 ? `${Math.min(discountRaw, 100)} %` : null,
        pointsRedeemed: splitPointsRedeemed,
        pointsDiscount: splitPointsDiscount,
        netTotal: round2(netTotal - splitPointsDiscount),
        isSplit: true,
        splitMode,
        splitCount: effectiveCount,
        cartItems: buildCartItems(),
        itemCount: cart.length,
        typeSummary: buildTypeSummary(),
        tax: taxView,
        serviceRate: taxConfig?.serviceRate || 0,
        parts: receiptParts,
        payment: null,
      });
      setOrderDone(true);
    } catch (err) {
      setOrderError(err.response?.data?.message || 'Erreur lors de la validation');
    } finally {
      setSubmitting(false);
    }
  };


  // Nature de l'annulation : ce qu'il reste à faire, déduit de l'état des encaissements —
  // elle se calcule, elle ne se choisit pas.
  const buildCancelTrace = () => {
    const cancelPayments = buildCancelPayments();
    const cancelledAmount = round2(cancelPayments.reduce((s, p) => s + p.amount, 0));
    const paymentRunning = !!currentIntentRef.current
      || terminalStatus === 'collecting' || terminalStatus === 'processing';
    const cancelType = cancelledAmount > 0 ? 'refund_due'
      : paymentRunning ? 'interrupted'
      : 'no_payment';
    const cancelReason = cancelType === 'refund_due'
      ? `Annulée après encaissement de ${cancelledAmount.toFixed(2)} €`
      : cancelType === 'interrupted'
        ? 'Annulée pendant un paiement en cours'
        : 'Annulée avant tout encaissement';
    return { cancelType, cancelReason, cancelledAmount, cancelPayments };
  };

  // Une vente abandonnée ne laissait aucune trace : la commande n'ayant jamais été créée, il ne
  // restait rien de ce qui avait été composé ni de ce qui avait déjà été encaissé.
  const traceCancelledOrder = async (trace) => {
    if (cart.length === 0) return; // rien de composé : rien à tracer
    try {
      await createOrder({
        ...buildItemsPayload(),
        user: selectedClient?._id || null,
        // Remise commerciale transmise pour que la trace porte le montant réel de la note.
        // `pointsToRedeem` est volontairement omis : les points n'ont pas été consommés
        // (la fidélité ne s'applique qu'à la finalisation) — les inscrire ferait croire
        // le contraire et bloquerait un remboursement partiel.
        manualDiscount: round2(discountValue),
        discount: discountValue > 0
          ? { type: discountType, value: discountType === 'percent' ? Math.min(discountRaw, 100) : round2(discountValue), amount: round2(discountValue) }
          : null,
        source: 'caisse',
        status: 'cancelled',
        reachedKitchen: false, // jamais envoyée en cuisine : n'a rien à faire sur le KDS
        ...trace,
      });
    } catch { /* la trace ne doit jamais empêcher la caissière de reprendre la main */ }
  };

  const handleCancelOrder = async () => {
    setCancelConfirmOpen(false);
    const trace = buildCancelTrace();
    // Mode ticket : on annule réellement la commande en base (si déjà persistée) puis on revient
    // à l'accueil caisse. Sans ça, le ticket 'open' resterait listé dans « Tickets ouverts ».
    if (openTicketMode) {
      if (openTicketId) {
        try {
          await api.patch(`/orders/${openTicketId}/cancel`, trace);
        } catch (err) {
          setOrderError(err.response?.data?.message || "Erreur lors de l'annulation");
          return;
        }
      } else {
        await traceCancelledOrder(trace); // ticket jamais persisté : on trace la vente abandonnée
      }
      handleBackToHome();
      return;
    }
    // Commande en ligne reprise : elle existe déjà en base, on l'annule au lieu d'en créer une.
    if (onlineOrderId) {
      try {
        await api.patch(`/orders/${onlineOrderId}/cancel`, trace);
      } catch (err) {
        setOrderError(err.response?.data?.message || "Erreur lors de l'annulation");
        return;
      }
    } else {
      await traceCancelledOrder(trace);
    }
    // Vente classique : on quitte vers l'admin (comportement d'origine).
    setCart([]);
    setOnlineOrderId(null);
    setOpenTicketMode(false);
    setOpenTicketId(null);
    setOpenTicketInKitchen(false);
    setCustomerLabel('');
    setSelectedClient(null);
    setStep(0);
    setMaxStep(0);
    setClientMode(null);
    resetSplit();
    navigate('/admin');
  };

  const resetSplit = () => {
    setSplitEnabled(false);
    setSplitCount(2);
    setRestChoice(null);
    setSplitMode('equal');
    setParts([]);
    setCurrentPartIdx(0);
    setSplitError('');
    setEncaissementStarted(false);
    setPendingAssign([]);
    setAssignOpen(false);
    setSpreadIds([]);
    setPrepaidParts([]);
    setPartPayOpen(false);
    setPartPayClient(null);
    setPartSlip(null);
    setPrintingSlip(false);
    setSlipSendChannel(null);
    // Un résidu 'processing'/'error' d'une vente précédente désactiverait le bouton carte
    // de la première part de la vente suivante.
    setTerminalStatus('idle');
    setTerminalHint('');
  };

  // ----- Impression des tickets -----
  const methodLabel = (m) => (m === 'cash' ? 'Espèces' : m === 'card' ? 'Carte' : m === 'ticket' ? 'Tickets resto' : m === 'points' ? 'Points' : 'Mixte');

  const eur = (n) => `${n.toFixed(2)} €`;

  // Lignes de paiement d'UN règlement.
  const paymentLinesForTx = (t) => {
    if (t.method === 'points') return [`Réglé en points (${t.pointsRedeemed || 0} pts)`];
    if (t.method === 'cash') return [`Espèces — donné ${(t.cashGiven || 0).toFixed(2)} €, rendu ${(t.change || 0).toFixed(2)} €`];
    if (t.method === 'card') return ['Réglé par carte'];
    if (t.method === 'ticket') {
      const lines = terminalLines(t, eur);
      return lines.length ? lines : ['Réglé en tickets restaurant'];
    }
    return [
      ...terminalLines(t, eur),
      ...(t.cashAmount > 0 ? [`Espèces : ${t.cashAmount.toFixed(2)} € — donné ${(t.cashGiven || 0).toFixed(2)} €, rendu ${(t.change || 0).toFixed(2)} €`] : []),
      ...(t.ticketAmount > 0 ? [`Tickets resto : ${t.ticketAmount.toFixed(2)} €`] : []),
    ];
  };

  // Une part règle parfois en plusieurs fois (article ajouté après un premier encaissement) :
  // le ticket reste UNE part, les règlements y sont numérotés.
  const paymentLinesFor = (p) => {
    const txs = p.payments || [];
    if (txs.length <= 1) return txs.flatMap(paymentLinesForTx);
    return txs.flatMap((t, i) => [
      `Règlement ${i + 1} — ${t.covered.toFixed(2)} €`,
      ...paymentLinesForTx(t).map(l => `  ${l}`),
    ]);
  };

  // Libellé compact des moyens de paiement d'une part, pour le ticket récapitulatif.
  const partMethodsLabel = (p) => {
    const txs = p.payments || [];
    if (!txs.length) return '—';
    if (txs.length === 1) return methodLabel(txs[0].method);
    return `${txs.length} règlements`;
  };

  // Descripteur du ticket correspondant à la cible d'impression courante.
  const currentTicket = (() => {
    if (!receipt || printTarget === null) return null;
    // Cibles « -nodetail » : ticket synthétique (nombre d'articles, sans la liste).
    const noDetail = typeof printTarget === 'string' && printTarget.endsWith('-nodetail');
    const base = noDetail ? printTarget.slice(0, -'-nodetail'.length) : printTarget;
    const summaryLines = (receipt.typeSummary?.length ? receipt.typeSummary : [{ label: `${receipt.itemCount} article${receipt.itemCount > 1 ? 's' : ''}` }]);
    // Décomposition de la remise : insérée dans le bloc articles (avant le total),
    // pour que le TOTAL en gras affiche le net réellement payé.
    const hasReduction = receipt.discountValue > 0 || receipt.pointsRedeemed > 0;
    const breakdownLines = hasReduction
      ? [
          { label: 'Sous-total', price: receipt.total },
          ...(receipt.discountValue > 0
            ? [{ label: `Remise${receipt.discountLabel ? ` (${receipt.discountLabel})` : ''}`, price: -receipt.discountValue }]
            : []),
          ...(receipt.pointsRedeemed > 0
            ? [{ label: `Points (${receipt.pointsRedeemed} pts)`, price: -receipt.pointsDiscount }]
            : []),
        ]
      : [];
    const ticketTotal = hasReduction ? receipt.netTotal : receipt.total;
    if (base === 'simple') {
      const pay = receipt.payment;
      const methodLines = pay?.method === 'points'
        ? ['Réglé intégralement en points']
        : pay?.method === 'ticket'
          ? (terminalLines(pay, eur).length ? terminalLines(pay, eur) : ['Réglé en tickets restaurant'])
          : pay?.method === 'cash'
            ? [`Espèces — donné ${(pay.cashGiven || 0).toFixed(2)} €, rendu ${(pay.change || 0).toFixed(2)} €`]
            : pay?.method === 'mixed'
              ? [
                  ...terminalLines(pay, eur),
                  ...(pay.cashAmount > 0 ? [`Espèces : ${pay.cashAmount.toFixed(2)} € — donné ${(pay.cashGiven || 0).toFixed(2)} €, rendu ${(pay.change || 0).toFixed(2)} €`] : []),
                  ...(pay.ticketAmount > 0 ? [`Tickets resto : ${pay.ticketAmount.toFixed(2)} €`] : []),
                ]
              : ['Réglé par carte'];
      return { subheading: 'Ticket', lines: [...(noDetail ? summaryLines : receipt.cartItems), ...breakdownLines], total: ticketTotal, totalLabel: 'Total', paymentLines: methodLines, tax: receipt.tax };
    }
    if (base === 'recap') {
      return {
        subheading: 'Ticket récapitulatif',
        lines: [...(noDetail ? summaryLines : receipt.cartItems), ...breakdownLines],
        total: ticketTotal,
        totalLabel: 'Total',
        paymentLines: [],
        tax: receipt.tax,
        extraTitle: 'Répartition',
        extraLines: receipt.parts.map(p => ({ label: `Part ${p.index}`, value: `${p.amount.toFixed(2)} € · ${partMethodsLabel(p)}` })),
      };
    }
    const p = receipt.parts[printTarget];
    if (!p) return null;
    return {
      subheading: `Part ${p.index}${receipt.splitCount ? ` / ${receipt.splitCount}` : ''}`,
      lines: p.items || [],
      total: p.amount,
      totalLabel: 'À payer',
      paymentLines: paymentLinesFor(p),
    };
  })();

  useEffect(() => {
    if (!printingSlip) return;
    const done = () => setPrintingSlip(false);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 60);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printingSlip]);

  useEffect(() => {
    if (printTarget === null) return;
    const done = () => setPrintTarget(null);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 60);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printTarget]);

  const handleNewOrder = () => {
    handleBackToHome();
    setOrderDone(false);
    setReceipt(null);
    setPrintTarget(null);
    setLastOrder(null);
    setRefundOpen(false);
    setRefundedInfo(null);
    setSendChannel(null);
    setInvoiceOpen(false);
  };

  if (orderDone) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center p-8 bg-white rounded-2xl shadow-xl max-w-md w-full">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-green-700 mb-2">Commande encaissée !</h2>
          <p className="text-gray-600 mb-1">
            {selectedClient ? `Client : ${selectedClient.name}` : 'Client anonyme'}
          </p>
          <p className="text-3xl font-extrabold text-gray-800 mb-1">{(receipt ? receipt.netTotal : netTotal).toFixed(2)} €</p>
          {(receipt ? receipt.discountValue : discountValue) > 0 && (
            <p className="text-sm font-semibold text-rose-600 mb-1">Remise −{(receipt ? receipt.discountValue : discountValue).toFixed(2)} € (sur {(receipt ? receipt.total : cartTotal).toFixed(2)} €)</p>
          )}
          {pointsToRedeem > 0 && (
            <p className="text-sm font-semibold text-amber-600 mb-2">{pointsToRedeem} pts utilisés (−{pointsDiscount.toFixed(2)} €)</p>
          )}
          {netTotal === 0 ? (
            <p className="text-lg font-bold text-emerald-600 mb-4">Réglé intégralement en points</p>
          ) : splitEnabled ? (
            <p className="text-lg font-bold text-emerald-600 mb-4">Addition séparée en {receipt ? receipt.parts.length : parts.length} parts</p>
          ) : payMode === 'ticket' ? (
            <p className="text-lg font-bold text-orange-600 mb-4">{ticketKind === 'card' ? 'Réglé par carte titre-restaurant' : 'Réglé en tickets restaurant'}</p>
          ) : payMode === 'cash' && change >= 0 ? (
            <p className="text-lg font-bold text-emerald-600 mb-4">Rendu : {change.toFixed(2)} €</p>
          ) : payMode === 'mixed' && (
            <p className="text-sm font-bold text-emerald-600 mb-4">
              {[
                ...terminalLines({ cardPayments: toCardPayments(mixedPassages) }, (n) => `${n.toFixed(2)} €`),
                ...(mixedCashNum > 0 ? [`Espèces ${mixedCashNum.toFixed(2)} € (rendu ${mixedChange.toFixed(2)} €)`] : []),
                ...(mixedTicketNum > 0 ? [`Tickets ${mixedTicketNum.toFixed(2)} €`] : []),
              ].join(' · ')}
            </p>
          )}

          {/* Impression des tickets */}
          {receipt && (
            <div className="mb-5 space-y-2 text-left">
              <p className="text-xs font-semibold text-gray-400 text-center uppercase tracking-wider">Tickets</p>
              {receipt.isSplit ? (
                <>
                  <button onClick={() => setPrintTarget('recap')}
                    className="w-full py-2 border-2 border-emerald-600 text-emerald-700 rounded-lg font-bold hover:bg-emerald-50 transition inline-flex items-center justify-center gap-1.5">
                    <Icon name="receipt" /> Ticket récapitulatif
                  </button>
                  <button onClick={() => setPrintTarget('recap-nodetail')}
                    className="w-full py-2 border-2 border-gray-200 text-gray-600 rounded-lg font-semibold hover:bg-gray-50 transition inline-flex items-center justify-center gap-1.5">
                    <Icon name="receipt" /> Récapitulatif sans détail
                  </button>
                  {receipt.parts.map((p, i) => (
                    <button key={i} onClick={() => setPrintTarget(i)}
                      className="w-full py-2 border-2 border-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition inline-flex items-center justify-center gap-1.5">
                      <Icon name="receipt" /> Ticket part {p.index} — {p.amount.toFixed(2)} €
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <button onClick={() => setPrintTarget('simple')}
                    className="w-full py-2 border-2 border-emerald-600 text-emerald-700 rounded-lg font-bold hover:bg-emerald-50 transition inline-flex items-center justify-center gap-1.5">
                    <Icon name="receipt" /> Imprimer le ticket
                  </button>
                  <button onClick={() => setPrintTarget('simple-nodetail')}
                    className="w-full py-2 border-2 border-gray-200 text-gray-600 rounded-lg font-semibold hover:bg-gray-50 transition inline-flex items-center justify-center gap-1.5">
                    <Icon name="receipt" /> Imprimer sans détail
                  </button>
                </>
              )}
            </div>
          )}

          {/* Facture — sur la commande entière : une addition séparée ne se facture pas
              part par part (la TVA n'est pas ventilée à ce niveau). */}
          {lastOrder?._id && (
            <div className="mb-5">
              <button onClick={() => setInvoiceOpen(true)}
                className="w-full py-2 border-2 border-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition inline-flex items-center justify-center gap-1.5">
                <Icon name="invoice" /> Éditer une facture
              </button>
            </div>
          )}

          {/* Envoi du ticket par email / SMS — fonctionne aussi pour un client anonyme */}
          {lastOrder?._id && (
            <div className="mb-5 grid grid-cols-2 gap-2">
              <button onClick={() => setSendChannel('email')}
                className="py-2 border-2 border-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition inline-flex items-center justify-center gap-1.5">
                <Icon name="mail" /> Envoyer par email
              </button>
              <button onClick={() => setSendChannel('sms')}
                className="py-2 border-2 border-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition inline-flex items-center justify-center gap-1.5">
                <Icon name="sms" /> Envoyer par SMS
              </button>
            </div>
          )}

          {/* Remboursement à chaud */}
          {refundedInfo ? (
            <div className="mb-4 py-2 px-4 rounded-lg bg-purple-50 text-purple-700 font-semibold inline-flex items-center justify-center gap-1.5">
              <Icon name="refund" /> Remboursé {refundedInfo.amount.toFixed(2)} €
            </div>
          ) : lastOrder?._id && (
            <button onClick={() => setRefundOpen(true)}
              className="mb-4 w-full py-2 border-2 border-purple-300 text-purple-700 rounded-lg font-bold hover:bg-purple-50 transition inline-flex items-center justify-center gap-1.5">
              <Icon name="refund" /> Annuler / Rembourser
            </button>
          )}

          <div className="flex gap-3 justify-center">
            <button onClick={handleNewOrder}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition">
              Nouvelle commande
            </button>
            <button onClick={() => navigate('/admin')}
              className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-bold hover:bg-gray-200 transition">
              Retour Admin
            </button>
          </div>
        </div>

        {/* Zone d'impression : portal hors #root, visible seulement à l'impression */}
        {currentTicket && (
          <PrintArea>
            <Ticket {...currentTicket} createdAt={receipt.createdAt} customerName={receipt.customerName} serviceRate={receipt.serviceRate} />
          </PrintArea>
        )}

        {/* Modale de remboursement à chaud */}
        {refundOpen && lastOrder && (
          <RefundModal
            order={lastOrder}
            lines={buildRefundLines()}
            submitting={refundSubmitting}
            onConfirm={handleRefundCaisse}
            onClose={() => setRefundOpen(false)}
          />
        )}

        {/* Modale facture */}
        {invoiceOpen && lastOrder && (
          <InvoiceModal order={lastOrder} onClose={() => setInvoiceOpen(false)} />
        )}

        {/* Modale d'envoi du ticket (email / SMS) */}
        {sendChannel && lastOrder?._id && (
          <SendReceiptModal
            orderId={lastOrder._id}
            channel={sendChannel}
            defaultTo={sendChannel === 'email' ? (selectedClient?.email || '') : (selectedClient?.phone || '')}
            onClose={() => setSendChannel(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TerminalSimulator terminalStatus={terminalStatus} amount={terminalAmount} />
      {/* Header */}
      <div className="bg-emerald-700 text-white px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 shadow-md">
        <button onClick={() => navigate('/admin')}
          className="text-white/80 hover:text-white text-sm font-medium">
          ← Admin
        </button>
        <h1 className="text-base sm:text-xl font-bold order-first w-full sm:order-none sm:w-auto">Caisse — Café Verdé</h1>
        <div className="flex items-center gap-2 sm:gap-4">
          {cart.length > 0 && <span className="text-sm font-bold">{cartTotal.toFixed(2)} €</span>}
          <button onClick={() => setOnlinePanelOpen(true)}
            className={`relative flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
              onlineAlert.ringingCount > 0
                ? 'bg-amber-300 hover:bg-amber-400 text-amber-950 animate-pulse'
                : 'bg-white/15 hover:bg-white/25'
            }`}>
            <Icon name={onlineAlert.enabled && !onlineAlert.needsUnlock ? 'bell' : 'bell_off'} /> Commandes en ligne
            {onlineAlert.orders.length > 0 && (
              <span className={`absolute -top-2 -right-2 text-xs font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center ${
                onlineAlert.ringingCount > 0 ? 'bg-emerald-900 text-amber-300' : 'bg-amber-400 text-emerald-900'
              }`}>
                {onlineAlert.orders.length}
              </span>
            )}
          </button>
          <button onClick={() => setTicketsPanelOpen(true)}
            className="relative flex items-center gap-2 bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg text-sm font-semibold transition">
            <Icon name="receipt" /> Tickets ouverts
            {openTickets.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-amber-400 text-emerald-900 text-xs font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center">
                {openTickets.length}
              </span>
            )}
          </button>
          <button onClick={() => setServiceOpen(true)}
            className="relative flex items-center gap-2 bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-lg text-sm font-semibold transition">
            <Icon name="bell" /> Service
            {readyOrders.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-amber-400 text-emerald-900 text-xs font-bold min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center">
                {readyOrders.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="bg-white border-b px-6 py-3">
        <div className="flex items-center max-w-2xl mx-auto">
          {['Client', 'Commande', 'Encaissement'].map((label, idx) => (
            <React.Fragment key={idx}>
              <button
                onClick={() => { if (canGoToStep(idx)) setStep(idx); }}
                disabled={!canGoToStep(idx)}
                className={`flex items-center gap-2 text-sm font-semibold transition ${
                  step === idx ? 'text-emerald-700'
                  : canGoToStep(idx) ? 'text-gray-500 hover:text-emerald-600 cursor-pointer'
                  : 'text-gray-300 cursor-default'
                }`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  step > idx ? 'bg-emerald-600 text-white' : step === idx ? 'bg-emerald-700 text-white' : 'bg-gray-200 text-gray-400'
                }`}>
                  {step > idx ? <Icon name="check" /> : idx + 1}
                </div>
                {label}
              </button>
              {idx < 2 && <div className={`flex-1 h-px mx-3 ${step > idx ? 'bg-emerald-500' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* ===== ÉTAPE 1 : CLIENT ===== */}
        {/* Part encaissée juste avant le retour à l'accueil : le justificatif reste à portée de main
            (le client attend souvent son ticket), la table, elle, est dans « Tickets ouverts ». */}
        {step === 0 && partSlip && (
          <div className="max-w-lg mx-auto mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-emerald-800">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <Icon name="check" /> Part de {partSlip.amount.toFixed(2)} € encaissée
                </span>
                {partSlip.label && <> — {partSlip.label}</>}
                <span className="block text-xs text-emerald-700">Le ticket reste ouvert pour le reste de la table.</span>
              </p>
              <button onClick={() => setPartSlip(null)} aria-label="Fermer"
                className="text-emerald-700/60 hover:text-emerald-800 flex-shrink-0">
                <Icon name="close" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-4">
              <button onClick={() => setPrintingSlip(true)}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                <Icon name="receipt" /> Imprimer
              </button>
              <button onClick={() => setSlipSendChannel('email')}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                <Icon name="mail" /> Email
              </button>
              <button onClick={() => setSlipSendChannel('sms')}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                <Icon name="sms" /> SMS
              </button>
            </div>
          </div>
        )}

        {step === 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6 max-w-lg mx-auto">
            <h2 className="text-xl font-bold text-gray-800 mb-6">Identifier le client</h2>

            {clientMode === null && (
              <div className="space-y-3">
                <button onClick={() => setClientMode('ticket')}
                  className="w-full p-4 border-2 border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 rounded-xl text-left flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-2xl flex-shrink-0"><Icon name="receipt" /></div>
                  <div>
                    <p className="font-bold text-gray-800">Ouvrir un ticket</p>
                    <p className="text-sm text-gray-500">Addition à régler plus tard (table, comptoir…)</p>
                  </div>
                </button>
                <button onClick={() => setClientMode('search')}
                  className="w-full p-4 border-2 border-gray-200 hover:border-emerald-500 rounded-xl text-left flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-2xl flex-shrink-0"><Icon name="search" /></div>
                  <div>
                    <p className="font-bold text-gray-800">Client existant</p>
                    <p className="text-sm text-gray-500">Rechercher par nom, email ou téléphone</p>
                  </div>
                </button>
                <button onClick={() => setClientMode('new')}
                  className="w-full p-4 border-2 border-gray-200 hover:border-emerald-500 rounded-xl text-left flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-2xl flex-shrink-0"><Icon name="add" /></div>
                  <div>
                    <p className="font-bold text-gray-800">Nouveau client</p>
                    <p className="text-sm text-gray-500">Créer un compte fidélité rapidement</p>
                  </div>
                </button>
                <button onClick={handleAnonymous}
                  className="w-full p-4 border-2 border-gray-200 hover:border-gray-400 rounded-xl text-left flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-2xl flex-shrink-0"><Icon name="account" /></div>
                  <div>
                    <p className="font-bold text-gray-800">Anonyme</p>
                    <p className="text-sm text-gray-500">Continuer sans compte</p>
                  </div>
                </button>
              </div>
            )}

            {clientMode === 'search' && (
              <div>
                <button onClick={() => { setClientMode(null); setSearchQ(''); setSearchResults([]); }}
                  className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1">
                  ← Retour
                </button>
                <input
                  type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  placeholder="Nom, email ou téléphone..." autoFocus
                  className="w-full border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none mb-3"
                />
                {searching && <p className="text-sm text-gray-400 text-center">Recherche...</p>}
                {searchError && (
                  <p className="text-sm text-red-500 text-center bg-red-50 rounded-lg px-3 py-2">{searchError}</p>
                )}
                {!searching && !searchError && searchQ.length >= 2 && searchResults.length === 0 && (
                  <p className="text-sm text-gray-400 text-center">Aucun résultat.</p>
                )}
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {searchResults.map(client => (
                    <button key={client._id} onClick={() => handleSelectClient(client)}
                      className="w-full p-3 border rounded-lg text-left hover:bg-emerald-50 hover:border-emerald-300 transition-all">
                      <p className="font-semibold text-gray-800">{client.name}</p>
                      <p className="text-xs text-gray-500">{client.phone || client.email} · {client.loyaltyPoints || 0} pts</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {clientMode === 'new' && (
              <div>
                <button onClick={() => { setClientMode(null); setNewForm({ name: '', phone: '', email: '' }); setClientError(''); }}
                  className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1">
                  ← Retour
                </button>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Nom *</label>
                    <input type="text" value={newForm.name}
                      onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Prénom Nom" autoFocus
                      className="w-full border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Téléphone</label>
                    <PhoneInput
                      international
                      defaultCountry="GP"
                      value={newForm.phone || undefined}
                      onChange={value => setNewForm(f => ({ ...f, phone: value || '' }))}
                      placeholder="Numéro (tous pays)"
                      className="w-full border rounded-lg px-4 py-2 text-sm focus-within:ring-2 focus-within:ring-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                    <input type="email" value={newForm.email}
                      onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="client@mail.com"
                      className="w-full border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                  {clientError && <p className="text-sm text-red-600">{clientError}</p>}
                  <button onClick={handleCreateClient} disabled={creatingClient}
                    className="w-full py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition disabled:opacity-60">
                    {creatingClient ? 'Création...' : 'Créer le compte'}
                  </button>
                </div>
              </div>
            )}

            {clientMode === 'ticket' && (
              <div>
                <button onClick={() => { setClientMode(null); setTicketNameInput(''); }}
                  className="text-sm text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1">
                  ← Retour
                </button>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Nom du ticket *</label>
                <input
                  type="text" value={ticketNameInput} autoFocus
                  onChange={e => setTicketNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleOpenNewTicket(); }}
                  placeholder="Table 4, comptoir, prénom…"
                  className="w-full border rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none mb-2" />
                <p className="text-xs text-gray-500 mb-4">Le ticket part en cuisine dès l'envoi ; vous l'encaisserez plus tard.</p>
                <button onClick={handleOpenNewTicket} disabled={!ticketNameInput.trim()}
                  className="w-full py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  Composer le ticket →
                </button>
              </div>
            )}
            <div className="mt-6 pt-4 border-t text-center">
              <button onClick={() => navigate('/admin')}
                className="text-sm text-gray-400 hover:text-red-500 transition inline-flex items-center gap-1">
                <Icon name="close" /> Annuler et retourner à l'admin
              </button>
            </div>
          </div>
        )}

        {/* ===== ÉTAPE 2 : COMMANDE ===== */}
        {step === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">

            {/* Catalogue */}
            <div className="lg:col-span-2 space-y-4">

              {/* Client sélectionné */}
              <div className="bg-white rounded-xl shadow-sm p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-lg">
                    {selectedClient ? <Icon name="account" /> : <Icon name="ghost" />}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">
                      {openTicketMode ? `Ticket : ${customerLabel}` : (selectedClient?.name || customerLabel || 'Client anonyme')}
                    </p>
                    {!openTicketMode && selectedClient?.loyaltyPoints !== undefined && (
                      <p className="text-xs text-gray-500">{selectedClient.loyaltyPoints} pts de fidélité</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!paymentLocked && (
                    <>
                      <button onClick={() => setStep(0)}
                        className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                        ← Étape précédente
                      </button>
                      <button onClick={() => { setStep(0); setSelectedClient(null); setClientMode(null); setCart([]); setOnlineOrderId(null); }}
                        className="text-xs text-gray-400 hover:text-gray-600">Changer</button>
                    </>
                  )}
                </div>
              </div>

              {/* Commande en ligne récupérée */}
              {loadingOnline && (
                <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 text-sm text-sky-700">
                  Recherche d'une commande en ligne…
                </div>
              )}
              {onlineOrderId && !loadingOnline && (
                <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 flex items-start gap-2">
                  <span className="text-sky-600 mt-0.5"><Icon name="globe" /></span>
                  <p className="text-sm text-sky-800">
                    <span className="font-bold">Commande en ligne récupérée.</span> Les articles déjà commandés sont verrouillés ; vous pouvez en ajouter d'autres avant d'encaisser.
                  </p>
                </div>
              )}
              {openTicketMode && !openTicketId && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2">
                  <span className="text-emerald-600 mt-0.5"><Icon name="receipt" /></span>
                  <p className="text-sm text-emerald-800">
                    <span className="font-bold">Nouveau ticket.</span> Composez la commande puis « Envoyer en cuisine » : elle part au KDS sans être réglée.
                  </p>
                </div>
              )}

              {/* Formules salades */}
              {formulas.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm p-4">
                  <h3 className="font-bold text-gray-800 mb-3 inline-flex items-center gap-1.5"><Icon name="salad" /> Salades à composer</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {formulas.map(f => (
                      <button key={f._id} onClick={() => openSaladWizard(f)}
                        className="p-3 border-2 border-dashed border-emerald-300 hover:border-emerald-600 hover:bg-emerald-50 rounded-lg text-left transition-all">
                        <p className="font-semibold text-gray-800 text-sm">{f.name}</p>
                        <p className="text-emerald-700 font-bold text-sm">{f.base_price.toFixed(2)} €</p>
                        {f.extra_cost_per_component > 0 && (
                          <p className="text-xs text-amber-600 mt-0.5">+{f.extra_cost_per_component.toFixed(2)}€/suppl.</p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Plats chauds */}
              {dishes.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm p-4">
                  <h3 className="font-bold text-gray-800 mb-3 inline-flex items-center gap-1.5"><Icon name="dish" /> Plats chauds</h3>
                  <div className="space-y-2">
                    {[...dishes].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })).map(d => (
                      <button key={d._id}
                        onClick={() => openDishModal(d)}
                        className="w-full p-3 border rounded-lg text-left hover:bg-amber-50 hover:border-amber-300 flex justify-between items-center transition-all">
                        <p className="font-semibold text-gray-800 text-sm">{d.name}</p>
                        <span className="font-bold text-amber-700 text-sm">{d.price.toFixed(2)} €</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Produits + Bubble Teas */}
              {(products.length > 0 || bubbleTeas.length > 0 || milkshakes.length > 0) && (
                <div className="bg-white rounded-xl shadow-sm p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="font-bold text-gray-800 inline-flex items-center gap-1.5"><Icon name="products" /> Boissons & Desserts</h3>
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Rechercher…"
                      className="w-32 sm:w-40 text-sm px-2.5 py-1 border border-gray-200 rounded-md text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200" />
                  </div>
                  {/* Bubble teas & Milkshakes (configurateurs) — toujours en tête */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[...bubbleTeas]
                      .filter(b => b.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
                      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
                      .map(b => (
                      <button key={b._id} onClick={() => openBubbleTeaModal(b)}
                        className="p-3 border rounded-lg text-left hover:bg-brand-50 hover:border-brand-300 flex justify-between items-center transition-all">
                        <p className="text-sm font-semibold text-gray-800 truncate pr-2 inline-flex items-center gap-1.5"><Icon name="cocktail" className="text-brand-600 shrink-0" /> {b.name}</p>
                        <span className="font-bold text-brand-700 text-sm whitespace-nowrap">{(b.price || 0).toFixed(2)} €</span>
                      </button>
                    ))}
                    {[...milkshakes]
                      .filter(m => m.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
                      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
                      .map(m => (
                      <button key={m._id} onClick={() => openMilkshakeModal(m)}
                        className="p-3 border rounded-lg text-left hover:bg-brand-50 hover:border-brand-300 flex justify-between items-center transition-all">
                        <p className="text-sm font-semibold text-gray-800 truncate pr-2 inline-flex items-center gap-1.5"><Icon name="milkshake" className="text-brand-600 shrink-0" /> {m.name}</p>
                        <span className="font-bold text-brand-700 text-sm whitespace-nowrap">{(m.price || 0).toFixed(2)} €</span>
                      </button>
                    ))}
                  </div>

                  {/* Produits : recherche → liste à plat ; sinon → accordéon par catégorie */}
                  {(() => {
                    const q = productSearch.trim().toLowerCase();
                    if (q) {
                      const matches = products
                        .filter(p => p.name.toLowerCase().includes(q))
                        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
                      return matches.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {matches.map(p => <CaisseProductButton key={p._id} product={p} onClick={handleAddProduct} />)}
                        </div>
                      ) : null;
                    }
                    // Index de l'arbre.
                    const childrenByParent = {};
                    productCategories.forEach(c => {
                      const k = c.parentId || 'root';
                      (childrenByParent[k] = childrenByParent[k] || []).push(c);
                    });
                    const productsByCatId = {};
                    products.forEach(p => {
                      if (p.categoryId) (productsByCatId[p.categoryId] = productsByCatId[p.categoryId] || []).push(p);
                    });
                    const unclassified = products
                      .filter(p => !p.categoryId)
                      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
                    return (
                      <div>
                        {['drink', 'coffee', 'dessert', 'side'].map(fixed => {
                          const roots = sortCatNodes((childrenByParent['root'] || []).filter(n => n.rootCategory === fixed && n.isAvailable !== false));
                          if (roots.length === 0) return null;
                          return (
                            <div key={fixed}>
                              {roots.map(node => (
                                <CaisseCatNode key={node.id} node={node} depth={0}
                                  childrenByParent={childrenByParent} productsByCatId={productsByCatId}
                                  openCats={openCats} toggle={toggleCat} onAddProduct={handleAddProduct} />
                              ))}
                            </div>
                          );
                        })}
                        {unclassified.length > 0 && (
                          <div className="grid grid-cols-2 gap-2">
                            {unclassified.map(p => <CaisseProductButton key={p._id} product={p} onClick={handleAddProduct} />)}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Panier sidebar */}
            <div className="bg-white rounded-xl shadow-sm p-4 h-fit lg:sticky lg:top-4">
              <h3 className="font-bold text-gray-800 mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5"><Icon name="receipt" /> Panier</span>
                {cart.some(it => !it.locked) && !paymentLocked && (
                  <button onClick={() => setCart(prev => prev.filter(it => it.locked))} className="text-xs text-red-400 hover:text-red-600">Vider</button>
                )}
              </h3>

              {paymentLocked && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                  Un règlement a déjà été encaissé : vous pouvez encore <strong>ajouter</strong> des articles,
                  mais plus en retirer.
                  {splitEnabled && " Chaque ajout devra être attribué à une part."}
                </p>
              )}

              {cart.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">Aucun article</p>
              ) : (
                <div className="space-y-2 mb-4">
                  {groupedCart.map((g) => {
                    const item = g.item;
                    return (
                      <div key={g.sig} className="flex justify-between items-start text-sm">
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="font-medium text-gray-800 text-xs leading-tight truncate">{item.label}</p>
                          {item.type === 'dish' && item.selectedSides?.length > 0 && (
                            <p className="text-xs text-gray-400 truncate">{item.selectedSides.map(s => s.name).join(', ')}</p>
                          )}
                          {item.type === 'formula' && item.ingredients?.length > 0 && (
                            <p className="text-xs text-gray-400 truncate">{item.ingredients.slice(0, 3).map(i => i.name).join(', ')}{item.ingredients.length > 3 ? '…' : ''}</p>
                          )}
                          {item.type === 'bubbletea' && item.selections?.length > 0 && (
                            <p className="text-xs text-gray-400 truncate">{item.selections.map(s => s.name).join(', ')}</p>
                          )}
                          {item.type === 'milkshake' && item.selections?.length > 0 && (
                            <p className="text-xs text-gray-400 truncate">{item.selections.map(s => s.name).join(', ')}</p>
                          )}
                          {item.type === 'product' && (item.selectedExtras || item.product?.selectedExtras || []).length > 0 && (
                            <p className="text-xs text-gray-400 truncate">+ {(item.selectedExtras || item.product?.selectedExtras || []).map(e => e.name).join(', ')}</p>
                          )}
                          {isUpgradeMenu(item.menu) && (
                            <p className="text-xs text-emerald-600 truncate font-medium">{item.menu.name}{item.menuProducts?.length ? ` · ${item.menuProducts.map(p => p.name).join(', ')}` : ''}</p>
                          )}
                          {item.locked ? (
                            <div className="flex items-center gap-1.5 mt-1">
                              {openTicketMode ? (
                                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                  <Icon name="dish" /> En cuisine
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                  <Icon name="globe" /> En ligne
                                </span>
                              )}
                              <span className="text-xs font-bold text-gray-700">×{g.qty}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 mt-1">
                              <button onClick={() => decrementGroup(g)} disabled={paymentLocked}
                                title={paymentLocked ? 'Un règlement a déjà été encaissé' : undefined}
                                className="w-6 h-6 rounded border border-gray-200 text-gray-600 font-bold leading-none hover:bg-gray-100 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed">−</button>
                              <span className="text-xs font-bold text-gray-700 w-5 text-center">{g.qty}</span>
                              <button onClick={() => incrementGroup(g)}
                                className="w-6 h-6 rounded border border-gray-200 text-gray-600 font-bold leading-none hover:bg-gray-100 flex items-center justify-center">+</button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="font-bold text-gray-800 text-xs whitespace-nowrap">{g.lineTotal.toFixed(2)}€</span>
                          {!item.locked && !paymentLocked && (
                            <button onClick={() => removeGroup(g)}
                              className="text-red-400 hover:text-red-600 text-xs ml-1"><Icon name="close" /></button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t pt-2 flex justify-between font-bold text-base">
                    <span>Total</span>
                    <span className="text-emerald-700">{cartTotal.toFixed(2)} €</span>
                  </div>
                </div>
              )}

              {openTicketMode && (
                <>
                  <button onClick={handleHoldTicket} disabled={submitting || cardInFlight}
                    title={cardInFlight ? CARD_IN_FLIGHT_HINT : undefined}
                    className="w-full mb-2 py-3 border-2 border-emerald-500 text-emerald-700 rounded-lg font-bold hover:bg-emerald-50 transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
                    <Icon name="receipt" /> {submitting ? 'Patientez…' : 'Mettre en attente'}
                  </button>
                  <button onClick={handleSendToKitchen} disabled={submitting || cardInFlight || !cart.some(it => !it.locked)}
                    title={cardInFlight ? CARD_IN_FLIGHT_HINT : undefined}
                    className="w-full mb-2 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
                    <Icon name="dish" /> {submitting ? 'Envoi…' : openTicketInKitchen ? 'Envoyer les ajouts en cuisine' : 'Envoyer en cuisine'}
                  </button>
                </>
              )}
              <button onClick={() => setStep(2)} disabled={cart.length === 0}
                className="w-full py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed">
                Encaisser →
              </button>
              {orderError && openTicketMode && (
                <p className="text-sm text-red-600 text-center mt-2">{orderError}</p>
              )}
              <button onClick={() => setCancelConfirmOpen(true)}
                className="w-full mt-2 py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition inline-flex items-center justify-center gap-2">
                <Icon name="close" /> Annuler la commande
              </button>
            </div>
          </div>
        )}

        {/* ===== ÉTAPE 3 : ENCAISSEMENT ===== */}
        {step === 2 && (
          <div className="max-w-lg mx-auto space-y-4">

            {/* Résumé */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-gray-800">Récapitulatif</h3>
                <button onClick={() => setStep(1)} className="text-sm text-gray-400 hover:text-gray-600">← Modifier</button>
              </div>
              <div className="space-y-2 mb-3">
                {groupedCart.map(g => (
                  <div key={g.sig} className="flex justify-between text-sm">
                    <span className="text-gray-700">{g.qty > 1 ? `${g.qty}× ` : ''}{g.item.label}</span>
                    <span className="font-medium">{g.lineTotal.toFixed(2)} €</span>
                  </div>
                ))}
              </div>
              <div className="border-t pt-3 space-y-1">
                {hasGlobalReduction && (
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Sous-total</span><span>{cartTotal.toFixed(2)} €</span>
                  </div>
                )}
                {discountValue > 0 && (
                  <div className="flex justify-between text-sm text-rose-600 font-semibold">
                    <span>Remise{discountType === 'percent' ? ` (${Math.min(discountRaw, 100)} %)` : ''}</span><span>−{discountValue.toFixed(2)} €</span>
                  </div>
                )}
                {pointsToRedeem > 0 && (
                  <div className="flex justify-between text-sm text-amber-600 font-semibold">
                    <span>Points ({pointsToRedeem} pts)</span><span>−{pointsDiscount.toFixed(2)} €</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-lg">
                  <span>{hasGlobalReduction ? 'Reste à encaisser' : 'Total à encaisser'}</span>
                  <span className="text-emerald-700">{netTotal.toFixed(2)} €</span>
                </div>
                {taxView.totalTVA > 0 && (
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>dont TVA{taxView.breakdown.length === 1 ? ` (${taxView.breakdown[0].rate} %)` : ''}</span>
                    <span>{taxView.totalTVA.toFixed(2)} €</span>
                  </div>
                )}
              </div>
            </div>

            {/* Remise commerciale (avant points) — accessible à tout opérateur caisse */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-gray-800 inline-flex items-center gap-1.5"><Icon name="tags" /> Remise</h3>
                {discountValue > 0 && <span className="text-sm font-semibold text-rose-600">−{discountValue.toFixed(2)} €</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border-2 border-gray-200 overflow-hidden">
                  <button onClick={() => setDiscountType('percent')} disabled={encaissementStarted}
                    className={`px-3 py-2 text-sm font-bold transition disabled:opacity-40 ${discountType === 'percent' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>%</button>
                  <button onClick={() => setDiscountType('amount')} disabled={encaissementStarted}
                    className={`px-3 py-2 text-sm font-bold transition disabled:opacity-40 ${discountType === 'amount' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>€</button>
                </div>
                <input type="number" min="0" max={discountType === 'percent' ? 100 : undefined} step={discountType === 'percent' ? '1' : '0.01'}
                  value={discountInput} disabled={encaissementStarted}
                  onChange={e => setDiscount(e.target.value)}
                  placeholder={discountType === 'percent' ? '0 %' : '0,00 €'}
                  className="flex-1 border rounded-lg px-3 py-2 font-bold focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-gray-100" />
                {discountValue > 0 && (
                  <button onClick={clearDiscount} disabled={encaissementStarted}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-40"><Icon name="close" /></button>
                )}
              </div>
            </div>

            {/* Identifier un client à l'encaissement (rattache la fidélité sans réinitialiser la commande) */}
            {!selectedClient && (
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h3 className="font-bold text-gray-800 mb-1 inline-flex items-center gap-1.5"><Icon name="account" /> Identifier un client</h3>
                <p className="text-xs text-gray-500 mb-3">Facultatif — pour créditer / utiliser des points de fidélité.</p>
                <input
                  type="text" value={clientPickQ}
                  onChange={e => setClientPickQ(e.target.value)}
                  placeholder="Nom, email ou téléphone…"
                  className="w-full border rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
                {clientPickSearching && <p className="text-sm text-gray-400 mt-2">Recherche…</p>}
                {!clientPickSearching && clientPickQ.length >= 2 && clientPickResults.length === 0 && (
                  <p className="text-sm text-gray-400 mt-2">Aucun résultat.</p>
                )}
                {clientPickResults.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto mt-2">
                    {clientPickResults.map(client => (
                      <button key={client._id} onClick={() => handleAttachClient(client)}
                        className="w-full p-3 border rounded-lg text-left hover:bg-emerald-50 hover:border-emerald-300 transition-all">
                        <p className="font-semibold text-gray-800">{client.name}</p>
                        <p className="text-xs text-gray-500">{client.phone || client.email} · {client.loyaltyPoints || 0} pts</p>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setQuickClientOpen(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                  <Icon name="add" /> Nouveau client
                </button>
              </div>
            )}

            {/* Client rattaché à l'encaissement : possibilité de le retirer */}
            {selectedClient && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
                <p className="text-sm text-emerald-800 inline-flex items-center gap-1.5">
                  <Icon name="account" /> <span className="font-semibold">{selectedClient.name}</span>
                  <span className="text-emerald-600">· {availablePoints} pts</span>
                </p>
                <button onClick={() => { setSelectedClient(null); setPointsToRedeem(0); }}
                  className="text-xs text-gray-400 hover:text-red-500">Retirer</button>
              </div>
            )}

            {/* Fidélité : utiliser ses points (client identifié) — réduit la note, simple comme séparé.
                En mode « séparer l'addition », le redeem se fait PAR PART → carte globale masquée. */}
            {selectedClient && availablePoints > 0 && !splitEnabled && (
              <div className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-gray-800 inline-flex items-center gap-1.5"><Icon name="star" /> Utiliser ses points</h3>
                  <span className="text-sm text-gray-500">{availablePoints} pts dispo = {pointsToEuros(availablePoints).toFixed(2)} €</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max={maxRedeemablePoints} step="100"
                    value={pointsToRedeem || ''} disabled={encaissementStarted}
                    onChange={e => setPoints(e.target.value)}
                    placeholder="0"
                    className="flex-1 border rounded-lg px-3 py-2 font-bold focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-gray-100" />
                  <span className="text-sm font-semibold text-gray-600 whitespace-nowrap">pts (−{pointsDiscount.toFixed(2)} €)</span>
                  <button onClick={() => setPoints(maxRedeemablePoints)} disabled={encaissementStarted}
                    className="px-3 py-2 rounded-lg text-sm font-bold border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-40 whitespace-nowrap">
                    Tout payer
                  </button>
                  {pointsToRedeem > 0 && (
                    <button onClick={() => setPoints(0)} disabled={encaissementStarted}
                      className="text-gray-400 hover:text-red-500 disabled:opacity-40"><Icon name="close" /></button>
                  )}
                </div>
                {netTotal === 0 && (
                  <p className="text-sm text-emerald-600 font-semibold mt-2 inline-flex items-center gap-1"><Icon name="check" /> Note réglée intégralement en points</p>
                )}
              </div>
            )}

            {/* Mode de consommation → pilote le taux de TVA appliqué */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <h3 className="font-bold text-gray-800 text-sm mb-3">Consommation</h3>
              <div className="flex gap-2">
                {[
                  { key: 'dineIn',   label: 'Sur place' },
                  { key: 'takeaway', label: 'À emporter' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setConsumptionMode(key)}
                    className={`flex-1 py-3 rounded-lg font-bold border-2 transition-all ${
                      consumptionMode === key
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Un convive quitte la table avant les autres : on encaisse sa part, le ticket reste
                ouvert. Un ticket pas encore enregistré l'est à la volée (cf. openPartPayment) ;
                en revanche on n'y touche plus une fois le solde entamé, encaisser une part alors
                que des parts du solde sont réglées laisserait une répartition incohérente. */}
            {openTicketMode && cartTotal > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                {prepaidTotal > 0 ? (
                  <div className="mb-3">
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Total de la table</span>
                      <span className="font-semibold">{cartTotal.toFixed(2)} €</span>
                    </div>
                    {round2(cartTotal - netTotal) > 0 && (
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>Remise</span>
                        <span className="font-semibold">−{round2(cartTotal - netTotal).toFixed(2)} €</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm text-gray-600 mt-1">
                      <span>Déjà payé</span>
                      <span className="font-semibold">−{prepaidTotal.toFixed(2)} €</span>
                    </div>
                    <ul className="mt-1 ml-3 space-y-0.5">
                      {prepaidParts.map((p, i) => {
                        const at = tsToDate(p.paidAt);
                        return (
                          <li key={p.partId || i} className="flex justify-between text-xs text-gray-500">
                            <span className="truncate pr-2">
                              {p.userName || `Part ${p.index ?? i + 1}`} · {methodLabel(p.method)}
                              {at && ` · ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Guadeloupe' })}`}
                            </span>
                            <span className="whitespace-nowrap">{(Number(p.amount) || 0).toFixed(2)} €</span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between items-baseline">
                      <span className="font-bold text-gray-800">Reste à payer</span>
                      <span className="text-2xl font-extrabold text-emerald-700">{splitBase.toFixed(2)} €</span>
                    </div>
                    {splitBase > 0 && restChoice === null && (
                      <div className="mt-3 space-y-2">
                        <button onClick={() => { setRestChoice('all'); setSplitMode('equal'); setSplitCount(1); }}
                          className="w-full py-3 rounded-lg font-bold bg-brand-600 hover:bg-brand-700 text-white transition">
                          Régler le reste — {splitBase.toFixed(2)} €
                        </button>
                        <button onClick={() => { setRestChoice('split'); setSplitMode('equal'); setSplitCount(2); }}
                          className="w-full py-1 text-sm font-semibold text-emerald-700 hover:underline">
                          Encore plusieurs à payer ? Répartir le reste
                        </button>
                      </div>
                    )}
                    {splitBase > 0 && restChoice !== null && !splitStarted && (
                      <button onClick={() => setRestChoice(null)}
                        className="mt-2 text-xs text-gray-500 hover:text-gray-700">
                        ← {restChoice === 'all' ? 'Régler le reste' : 'Répartir le reste'} · changer
                      </button>
                    )}
                    {splitBase <= 0 && (
                      <p className="mt-2 text-sm text-emerald-700 font-semibold inline-flex items-center gap-1">
                        <Icon name="check" /> Tout est réglé — il ne reste qu'à clôturer la table.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">Reste à payer</span>
                    <span className="font-extrabold text-gray-800">{splitBase.toFixed(2)} €</span>
                  </div>
                )}
                {partSlip && partSlip.orderId === openTicketId && (
                  <div className="mb-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between">
                    <p className="text-sm text-emerald-800 inline-flex items-center gap-1.5">
                      <Icon name="check" /> Part de {partSlip.amount.toFixed(2)} € encaissée
                    </p>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setPrintingSlip(true)}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                        <Icon name="receipt" /> Imprimer
                      </button>
                      <button onClick={() => setSlipSendChannel('email')}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                        <Icon name="mail" /> Email
                      </button>
                      <button onClick={() => setSlipSendChannel('sms')}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1">
                        <Icon name="sms" /> SMS
                      </button>
                    </div>
                  </div>
                )}
                <button onClick={openPartPayment}
                  disabled={submitting || encaissementStarted || mixedCardStarted || splitBase <= 0}
                  title={encaissementStarted || mixedCardStarted ? "Le solde de la table est déjà entamé" : undefined}
                  className="w-full py-3 rounded-lg font-bold border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="inline-flex flex-col items-center leading-tight">
                    <span className="inline-flex items-center gap-1.5"><Icon name="account" /> Encaisser une part</span>
                    <span className="text-xs font-normal text-gray-500">le ticket reste ouvert</span>
                  </span>
                </button>
              </div>
            )}

            {/* Choix : paiement simple ou séparé — figé dès qu'un règlement est encaissé. Sans objet
                quand des convives ont déjà payé : le décompte de la table propose alors les choix. */}
            {prepaidTotal <= 0 && (
            <div className="bg-white rounded-xl shadow-sm p-2">
              <div className="flex gap-2">
                <button onClick={() => { setSplitEnabled(false); setSplitError(''); }} disabled={paymentLocked}
                  title={paymentLocked ? 'Un règlement a déjà été encaissé' : undefined}
                  className={`flex-1 py-3 rounded-lg font-bold border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${!splitEnabled ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  Paiement simple
                </button>
                <button onClick={() => { setSplitEnabled(true); setPointsToRedeem(0); }} disabled={paymentLocked}
                  title={paymentLocked ? 'Un règlement a déjà été encaissé' : undefined}
                  className={`flex-1 py-3 rounded-lg font-bold border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${splitEnabled ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <span className="inline-flex items-center justify-center gap-1.5"><Icon name="user-group" /> Séparer l'addition</span>
                </button>
              </div>
              {paymentLocked && (
                <p className="text-xs text-amber-600 text-center mt-2">
                  {settledSoFar().toFixed(2)} € déjà encaissés — le mode de paiement ne peut plus être changé.
                </p>
              )}
            </div>
            )}

            {/* ===== PAIEMENT SIMPLE ===== (masqué si tout est réglé en points) */}
            {!splitEnabled && netTotal > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="font-bold text-gray-800 mb-3">Mode de paiement</h3>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button onClick={() => setPayMode('cash')} disabled={mixedCardStarted}
                  className={`py-3 rounded-lg font-bold border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${payMode === 'cash' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <span className="inline-flex items-center justify-center gap-1.5"><Icon name="cash" /> Espèces</span>
                </button>
                <button onClick={() => setPayMode('card')} disabled={mixedCardStarted}
                  className={`py-3 rounded-lg font-bold border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${payMode === 'card' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <span className="inline-flex items-center justify-center gap-1.5"><Icon name="card" /> Carte</span>
                </button>
                <button onClick={() => setPayMode('ticket')} disabled={mixedCardStarted}
                  className={`py-3 rounded-lg font-bold border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${payMode === 'ticket' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  <span className="inline-flex items-center justify-center gap-1.5"><Icon name="restaurant" /> Tickets resto</span>
                </button>
                <button onClick={() => setPayMode('mixed')}
                  className={`py-3 rounded-lg font-bold border-2 transition-all ${payMode === 'mixed' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  Mixte
                </button>
              </div>
              {/* Changer de moyen après un débit carte enregistrerait la vente sans ces cartes :
                  compta fausse, remboursement impossible. */}
              {mixedCardStarted && (
                <p className="-mt-2 mb-3 text-xs text-gray-500">Cartes déjà passées : réglez le reste ci-dessous — carte, tickets ou espèces.</p>
              )}

              {payMode === 'cash' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Montant donné par le client (€)</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={cashGiven} onChange={e => setCashGiven(e.target.value)}
                      placeholder={netTotal.toFixed(2)} autoFocus
                      className="w-full border rounded-lg px-4 py-3 text-lg font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  {cashGivenNum > 0 && cashGivenNum >= netTotal && (
                    <div className="bg-emerald-50 border-2 border-emerald-400 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-600">Monnaie à rendre</p>
                      <p className="text-4xl font-extrabold text-emerald-700">{change.toFixed(2)} €</p>
                    </div>
                  )}
                  {cashGivenNum > 0 && cashGivenNum < netTotal && (
                    <p className="text-sm text-red-600 font-semibold">
                      Manque {(netTotal - cashGivenNum).toFixed(2)} €
                    </p>
                  )}
                </div>
              )}

              {payMode === 'card' && (
                <div className="space-y-3">
                <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-600">À régler par carte</p>
                  <p className="text-3xl font-extrabold text-blue-700">{netTotal.toFixed(2)} €</p>
                </div>
                {encaisserButton('bg-blue-600 hover:bg-blue-700')}
                <div className="text-sm text-center space-y-1">
                  {terminalStatus === 'idle' && <p className="text-gray-500">« Encaisser » envoie le montant au terminal</p>}
                  {terminalStatus === 'collecting' && <p className="text-blue-600 font-bold animate-pulse">Montant affiché sur le terminal — en attente de la carte…</p>}
                  {terminalStatus === 'processing' && <p className="text-blue-600 font-bold animate-pulse">Traitement en cours…</p>}
                  {terminalStatus === 'done' && <p className="text-green-600 font-bold inline-flex items-center gap-1"><Icon name="check" /> Paiement confirmé</p>}
                  {terminalStatus === 'error' && <p className="text-red-600">Échec du paiement — réessayez</p>}
                  {terminalHint && <p className="text-amber-600 font-semibold">{terminalHint}</p>}
                  <TerminalCancelButton terminalStatus={terminalStatus} onCancel={cancelTerminalNow} />
                </div>
                </div>
              )}

              {payMode === 'ticket' && (
                <div className="space-y-3">
                  {/* Papier : rien ne passe au terminal. Carte (Swile, Edenred…) : le montant part au terminal. */}
                  <div className="grid grid-cols-2 gap-2">
                    {[['paper', 'Tickets papier'], ['card', 'Carte titre-resto']].map(([k, label]) => (
                      <button key={k} onClick={() => setTicketKind(k)}
                        disabled={terminalStatus === 'collecting' || terminalStatus === 'processing'}
                        className={`py-2 rounded-lg text-sm font-bold border-2 transition-all disabled:opacity-40 ${ticketKind === k ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {ticketKind === 'card' ? (
                    <>
                    <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4 text-center">
                      <p className="text-sm text-gray-600">Carte titre-restaurant (terminal)</p>
                      <p className="text-3xl font-extrabold text-blue-700">{netTotal.toFixed(2)} €</p>
                      <p className="text-xs text-gray-400 mt-1">« Encaisser » envoie le montant au terminal</p>
                    </div>
                    {encaisserButton('bg-blue-600 hover:bg-blue-700')}
                    </>
                  ) : (
                    <PaperTicketInput value={ticketGiven} onChange={setTicketGiven} due={netTotal} autoFocus />
                  )}
                  {ticketKind === 'card' && (
                    <div className="text-sm text-center space-y-1">
                      {terminalStatus === 'collecting' && <p className="text-blue-600 font-bold animate-pulse">Montant affiché sur le terminal — en attente de la carte…</p>}
                      {terminalStatus === 'processing' && <p className="text-blue-600 font-bold animate-pulse">Traitement en cours…</p>}
                      {terminalStatus === 'error' && <p className="text-red-600">Échec du paiement — réessayez</p>}
                      {terminalHint && <p className="text-amber-600 font-semibold">{terminalHint}</p>}
                      <TerminalCancelButton terminalStatus={terminalStatus} onCancel={cancelTerminalNow} />
                    </div>
                  )}
                </div>
              )}

              {payMode === 'mixed' && (
                <CardPassages
                  passages={mixedPassages}
                  onChange={setMixedPassages}
                  limit={netTotal}
                  onCollect={payMixedPassage}
                  busy={submitting}
                  terminalStatus={terminalStatus}
                  terminalHint={terminalHint}
                  onCancelTerminal={cancelTerminalNow}
                />
              )}
            </div>
            )}

            {/* ===== SÉPARER L'ADDITION ===== */}
            {splitEnabled && !restPending && (
              <div className="space-y-4">

                {/* Configuration (verrouillée une fois l'encaissement commencé) */}
                {!settleRest && (
                <div className="bg-white rounded-xl shadow-sm p-5">
                  <h3 className="font-bold text-gray-800 mb-3">Répartition</h3>
                  {splitStarted && (
                    <p className="text-xs text-amber-600 mb-3">Encaissement commencé — configuration verrouillée.</p>
                  )}
                  {splitMode !== 'item' && (
                    <>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre de convives</label>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {[2, 3, 4, 5, 6].map(n => (
                          <button key={n} disabled={splitStarted} onClick={() => setSplitCount(n)}
                            className={`w-11 h-11 rounded-lg font-bold border-2 transition-all disabled:opacity-40 ${splitCount === n ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                            {n}
                          </button>
                        ))}
                        <button disabled={splitStarted} onClick={() => setSplitCount(c => c + 1)}
                          className="w-11 h-11 rounded-lg font-bold border-2 border-gray-200 text-gray-500 hover:border-gray-300 disabled:opacity-40">+</button>
                      </div>
                    </>
                  )}

                  <label className="block text-sm font-semibold text-gray-700 mb-1">Mode</label>
                  <div className="flex gap-2">
                    <button disabled={splitStarted} onClick={() => setSplitMode('equal')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all disabled:opacity-40 ${splitMode === 'equal' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      Parts égales
                    </button>
                    <button disabled={splitStarted} onClick={() => setSplitMode('free')}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all disabled:opacity-40 ${splitMode === 'free' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      Montant libre
                    </button>
                    <button disabled={splitStarted || hasGlobalReduction || prepaidTotal > 0} onClick={() => setSplitMode('item')}
                      title={prepaidTotal > 0 ? 'Indisponible : une part a déjà été encaissée' : hasGlobalReduction ? 'Indisponible avec une remise globale' : undefined}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-all disabled:opacity-40 ${splitMode === 'item' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      Par article
                    </button>
                  </div>
                  {prepaidTotal > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      Mode « par article » indisponible : les articles du ticket totalisent {netTotal.toFixed(2)} € alors
                      qu'il ne reste que {splitBase.toFixed(2)} € à répartir. Utilisez les parts égales ou le montant libre.
                    </p>
                  )}
                  {hasGlobalReduction && (
                    <p className="text-xs text-gray-400 mt-1">Mode « par article » indisponible quand une remise ou des points sont appliqués.</p>
                  )}

                  {/* Comparé au reste à répartir (splitBase), pas au total : sur une table dont un
                      convive a déjà payé, « 13 € / 25 € » faisait croire qu'il manquait 12 €. */}
                  {splitMode === 'free' && (
                    <p className={`text-sm font-semibold mt-3 ${splitBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
                      Réparti : {partsSum.toFixed(2)} € / {splitBase.toFixed(2)} €
                      {!splitBalanced && ` (écart ${(splitBase - partsSum).toFixed(2)} €)`}
                    </p>
                  )}

                  {splitMode === 'item' && (
                    <p className="text-sm text-gray-500 mt-3">
                      Sélectionnez les articles de chaque convive, l'un après l'autre. La dernière personne peut régler tout le reste d'un seul geste.
                    </p>
                  )}
                </div>
                )}

                {/* Liste des parts */}
                <div className="space-y-3">
                  {parts.map((p, idx) => {
                    const paid = isPartPaid(p);
                    const started = partStarted(p);          // au moins un règlement encaissé
                    const remaining = partRemaining(p);      // reste dû (brut)
                    const isActive = idx === currentPartIdx && !paid;
                    const partNet = partNetOf(p); // net à encaisser (reste dû − points saisis)
                    // Mixte : le reste à couvrir par les lignes ; espèces seules : le net de la part.
                    const cashDue = p.method === 'mixed' ? mixedSummary(p.passages, partNet).rest : partNet;
                    const partGiven = parseFloat(p.cashGiven) || 0;
                    const partPointsCap = Math.min(p.client?.loyaltyPoints || 0, maxPointsForEuros(remaining));
                    // Part déjà entamée qu'un ajout d'article a ré-ouverte : un complément reste à encaisser.
                    const reopened = started && !paid;
                    return (
                      <div key={idx}
                        className={`bg-white rounded-xl shadow-sm p-4 border-2 ${reopened ? 'border-amber-400' : paid ? 'border-emerald-300' : isActive ? 'border-emerald-500' : 'border-transparent'}`}>
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${paid ? 'bg-emerald-600 text-white' : isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                              {paid ? <Icon name="check" /> : idx + 1}
                            </div>
                            <span className="font-semibold text-gray-800">
                              {settleRest ? "Reste de l'addition" : `Part ${idx + 1 + prepaidParts.length}`}
                            </span>
                          </div>
                          {/* Montant libre : éditable tant que CETTE part n'a rien encaissé. */}
                          {splitMode === 'free' && !started ? (
                            <div className="flex items-center gap-1">
                              <input type="number" step="0.01" min="0" value={p.amount || ''}
                                onChange={e => setPartAmount(idx, e.target.value)}
                                className="w-24 border rounded-lg px-2 py-1 text-right font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                              <span className="font-bold text-gray-700">€</span>
                            </div>
                          ) : (
                            <div className="text-right">
                              <span className={`font-bold ${reopened ? 'text-amber-600' : 'text-emerald-700'}`}>{p.amount.toFixed(2)} €</span>
                              {started && (
                                <p className="text-xs text-gray-500">
                                  {partCovered(p).toFixed(2)} € réglés
                                  {reopened && <span className="text-amber-600 font-bold"> · reste {remaining.toFixed(2)} €</span>}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {reopened && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2">
                            Article ajouté après le règlement — complément de {remaining.toFixed(2)} € à encaisser.
                          </p>
                        )}

                        {/* Part non réglée mais pas active : permettre de l'encaisser dans n'importe quel ordre. */}
                        {!paid && !isActive && p.amount > 0 && (
                          <button onClick={() => setCurrentPartIdx(idx)}
                            className="mt-2 w-full py-2 rounded-lg text-sm font-bold border-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50 transition">
                            {reopened ? `Encaisser le complément (${remaining.toFixed(2)} €)` : 'Encaisser cette part'}
                          </button>
                        )}

                        {/* Client de la part (fidélité par part). Figé dès le 1er règlement : la
                            fidélité de TOUS les règlements de la part est rattachée à ce client. */}
                        {!paid && !started && (
                          <PartClientPicker
                            client={p.client}
                            globalClient={p.client ? null : selectedClient}
                            onSelect={(c) => setPartClient(idx, c)}
                            onClear={() => clearPartClient(idx)}
                            onNewClient={() => openNewClientForPart(idx)}
                            disabled={false}
                          />
                        )}
                        {started && p.client && (
                          <p className="text-xs text-gray-500 mt-2 ml-10 inline-flex items-center gap-1">
                            <Icon name="account" /> {p.client.name}
                          </p>
                        )}

                        {/* Utiliser les points du client de la part (réduit le net à encaisser) */}
                        {isActive && p.client && partPointsCap > 0 && (
                          <div className="mt-2 ml-10">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-gray-600 inline-flex items-center gap-1"><Icon name="star" /> Utiliser ses points</span>
                              <span className="text-xs text-gray-400">{p.client.loyaltyPoints} pts dispo</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <input type="number" min="0" max={partPointsCap} step="100"
                                value={p.pointsRedeemed || ''}
                                onChange={e => setPartPoints(idx, e.target.value)}
                                placeholder="0"
                                className="flex-1 border rounded-lg px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                              <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">pts (−{pointsToEuros(p.pointsRedeemed || 0).toFixed(2)} €)</span>
                              <button onClick={() => setPartPoints(idx, partPointsCap)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 transition whitespace-nowrap">
                                Max
                              </button>
                              {p.pointsRedeemed > 0 && (
                                <button onClick={() => setPartPoints(idx, 0)}
                                  className="text-gray-400 hover:text-red-500"><Icon name="close" /></button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Rappel net après points (part non réglée) */}
                        {!paid && p.pointsRedeemed > 0 && (
                          <p className="text-xs text-gray-500 mt-2 ml-10">
                            Reste {remaining.toFixed(2)} € − {p.pointsRedeemed} pts → <span className="font-bold text-emerald-700">net {partNet.toFixed(2)} €</span>
                          </p>
                        )}

                        {/* Articles de la part (mode 'item') + quotes-parts d'articles partagés */}
                        {splitMode === 'item' && (p.items?.length > 0 || p.extraItems?.length > 0) && (
                          <ul className="text-xs text-gray-500 mt-2 ml-10 space-y-0.5">
                            {(p.items || []).map((it, k) => (
                              <li key={`i${k}`} className="flex justify-between">
                                <span className="truncate pr-2">{it.label}</span>
                                <span>{it.price.toFixed(2)} €</span>
                              </li>
                            ))}
                            {(p.extraItems || []).map((it, k) => (
                              <li key={`e${k}`} className="flex justify-between italic">
                                <span className="truncate pr-2">{it.label}</span>
                                <span>{it.price.toFixed(2)} €</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {paid && (p.client || selectedClient) && (
                          <p className="text-xs text-emerald-700 mt-2 ml-10 inline-flex items-center gap-1">
                            <Icon name="account" /> Points crédités à {(p.client || selectedClient).name}
                          </p>
                        )}

                        {/* Historique des règlements de la part (plusieurs si un article a été ajouté après coup) */}
                        {started && (
                          <div className="text-xs text-gray-500 mt-2 ml-10 space-y-0.5">
                            {p.settled.map((t, k) => (
                              <p key={k}>
                                {p.settled.length > 1 && <span className="font-semibold text-gray-600">Règlement {k + 1} · </span>}
                                {t.covered.toFixed(2)} € ·{' '}
                                {t.pointsRedeemed > 0 && `${t.pointsRedeemed} pts (−${pointsToEuros(t.pointsRedeemed).toFixed(2)} €) · `}
                                {t.method === 'points' && 'Réglé en points'}
                                {t.method === 'cash' && `Espèces — rendu ${round2(t.change || 0).toFixed(2)} €`}
                                {t.method === 'card' && 'Carte'}
                                {t.method === 'ticket' && (t.cardPayments?.length ? 'Carte titre-resto' : 'Tickets resto')}
                                {t.method === 'mixed' && [
                                  ...terminalLines(t, eur),
                                  t.cashAmount > 0 ? `Espèces ${t.cashAmount.toFixed(2)} €` : null,
                                  (t.ticketAmount || 0) > 0 ? `Tickets ${t.ticketAmount.toFixed(2)} €` : null,
                                ].filter(Boolean).join(' + ')}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Sélection des articles (mode 'item', part active PAS encore entamée).
                            Une part déjà réglée ne recompose plus sa sélection : ses articles sont
                            payés, elle n'encaisse plus qu'un complément. */}
                        {isActive && splitMode === 'item' && !started && (
                          <div className="mt-3 ml-10 space-y-2">
                            <div className="space-y-1">
                              {availableItems.map(item => {
                                const checked = (p.items || []).some(it => it.id === item.id);
                                return (
                                  <button key={item.id} onClick={() => toggleItemInActivePart(item)}
                                    className={`w-full flex items-center justify-between gap-2 border-2 rounded-lg px-3 py-2 text-sm transition-all ${checked ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}>
                                    <span className="flex items-center gap-2 min-w-0">
                                      <span className={`w-5 h-5 rounded flex items-center justify-center text-xs flex-shrink-0 ${checked ? 'bg-emerald-600 text-white' : 'border-2 border-gray-300'}`}>
                                        {checked && <Icon name="check" />}
                                      </span>
                                      <span className="truncate font-medium text-gray-800">{item.label}</span>
                                    </span>
                                    <span className="font-bold text-gray-700 flex-shrink-0">{item.price.toFixed(2)} €</span>
                                  </button>
                                );
                              })}
                            </div>
                            {availableItems.length > (p.items?.length || 0) && (
                              <button onClick={selectAllRemainingInActivePart}
                                className="w-full py-2 border-2 border-dashed border-emerald-400 text-emerald-700 rounded-lg text-sm font-bold hover:bg-emerald-50 transition">
                                Payer le reste ({round2(availableItems.reduce((s, it) => s + it.price, 0)).toFixed(2)} €)
                              </button>
                            )}
                          </div>
                        )}

                        {/* Part entièrement réglée en points (net = 0) : validation directe, sans paiement */}
                        {isActive && remaining > 0 && partNet <= 0 && (
                          <div className="mt-3 ml-10">
                            <button onClick={payPartWithPoints}
                              className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition">
                              Valider — réglé en points ({p.pointsRedeemed} pts)
                            </button>
                          </div>
                        )}

                        {/* Encaissement de la part active (net > 0) */}
                        {isActive && remaining > 0 && partNet > 0 && (
                          <div className="mt-3 ml-10 space-y-3">
                            {/* Choix méthode */}
                            <div className="grid grid-cols-2 gap-2">
                              {['cash', 'card', 'ticket', 'mixed'].map(m => (
                                <button key={m} onClick={() => choosePartMethod(m)}
                                  className={`py-2 rounded-lg text-sm font-bold border-2 transition-all ${p.method === m ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                  {m === 'cash' ? 'Espèces' : m === 'card' ? 'Carte' : m === 'ticket' ? 'Tickets resto' : 'Mixte'}
                                </button>
                              ))}
                            </div>

                            {/* Mixte : lignes réglées l'une après l'autre (cartes au terminal, tickets papier, espèces) */}
                            {p.method === 'mixed' && (
                              <CardPassages
                                passages={p.passages}
                                onChange={setPartPassages}
                                limit={partNet}
                                onCollect={payPartPassage}
                                busy={submitting}
                                terminalStatus={terminalStatus}
                                terminalHint={terminalHint}
                                onCancelTerminal={cancelTerminalNow}
                              />
                            )}

                            {/* Tickets resto seuls : papier (validation directe, sans rendu) ou carte titre-restaurant (terminal) */}
                            {p.method === 'ticket' && (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  {[['paper', 'Tickets papier'], ['card', 'Carte titre-resto']].map(([k, label]) => (
                                    <button key={k} onClick={() => setPartTicketKind(k)}
                                      disabled={terminalStatus === 'collecting' || terminalStatus === 'processing'}
                                      className={`py-1.5 rounded-lg text-xs font-bold border-2 transition-all disabled:opacity-40 ${p.ticketKind === k ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                                      {label}
                                    </button>
                                  ))}
                                </div>
                                {p.ticketKind !== 'card' && (
                                  <>
                                    <PaperTicketInput value={p.ticketGiven || ''} onChange={setPartTicketGiven} due={partNet} />
                                    <button onClick={payPartTicket} disabled={!paperTicketOk(p.ticketGiven || '', partNet)}
                                      className="w-full py-2 bg-orange-500 text-white rounded-lg text-sm font-bold hover:bg-orange-600 transition disabled:opacity-40 disabled:cursor-not-allowed">
                                      Valider {partNet.toFixed(2)} € en tickets resto
                                    </button>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Carte seule, ou carte titre-restaurant : tout le net de la part au terminal */}
                            {(p.method === 'card' || (p.method === 'ticket' && p.ticketKind === 'card')) && (
                              <div className="space-y-2">
                                <div className="text-xs text-center">
                                  {terminalStatus === 'collecting' && <span className="text-blue-600 font-bold animate-pulse">Montant sur le terminal — en attente de la carte…</span>}
                                  {terminalStatus === 'processing' && <span className="text-blue-600 font-bold animate-pulse">Traitement…</span>}
                                  {terminalStatus === 'error' && <span className="text-red-600">Échec — réessayez</span>}
                                  {terminalHint && <p className="text-amber-600 font-semibold">{terminalHint}</p>}
                                </div>
                                <button onClick={payPartCard}
                                  disabled={submitting || terminalStatus === 'collecting' || terminalStatus === 'processing'}
                                  className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition disabled:opacity-40">
                                  Encaisser {partNet.toFixed(2)} € {p.method === 'ticket' ? 'par carte titre-resto' : 'par carte'}
                                </button>
                                <TerminalCancelButton terminalStatus={terminalStatus} onCancel={cancelTerminalNow} />
                              </div>
                            )}

                            {/* Étape espèces / validation (espèces seules, ou fin du mixte une fois toutes les cartes passées) */}
                            {(p.method === 'cash' || (p.method === 'mixed' && !passagesPending(p.passages))) && (
                              <div className="space-y-2">
                                {p.method === 'cash' && cashDue > 0 && (
                                  <>
                                    <label className="block text-xs text-gray-500">Montant donné — à encaisser {cashDue.toFixed(2)} €</label>
                                    <input type="number" step="0.01" min="0" value={p.cashGiven}
                                      onChange={e => setPartCashGiven(e.target.value)}
                                      placeholder={cashDue.toFixed(2)}
                                      className="w-full border rounded-lg px-2 py-2 font-bold focus:ring-2 focus:ring-emerald-500 outline-none" />
                                    {partGiven > 0 && partGiven >= cashDue && (
                                      <p className="text-sm text-emerald-600 font-bold">Rendu : {round2(partGiven - cashDue).toFixed(2)} €</p>
                                    )}
                                  </>
                                )}
                                <button onClick={payPartCash}
                                  disabled={p.method === 'mixed' ? cashDue > 0.001 : partGiven < cashDue - 0.001}
                                  className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-40">
                                  {reopened ? 'Valider le complément' : 'Valider la part'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Une part peut être ajoutée à tout moment, y compris après un encaissement. */}
                <button onClick={addPart}
                  className="w-full py-2.5 border-2 border-dashed border-emerald-400 text-emerald-700 rounded-lg text-sm font-bold hover:bg-emerald-50 transition inline-flex items-center justify-center gap-1.5">
                  <Icon name="add" /> Ajouter une part
                </button>

                {/* Articles ajoutés après un encaissement, pas encore rattachés à une part. */}
                {pendingAssign.length > 0 && (
                  <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 text-center">
                    <p className="text-sm font-bold text-amber-800 mb-2">
                      {pendingAssign.length} article{pendingAssign.length > 1 ? 's' : ''} à attribuer avant de finaliser
                    </p>
                    <button onClick={() => setAssignOpen(true)}
                      className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold hover:bg-amber-600 transition">
                      Attribuer « {pendingAssign[0].label} »
                    </button>
                  </div>
                )}

                {splitError && <p className="text-sm text-red-600 font-semibold text-center">{splitError}</p>}

                {/* Progression */}
                <p className="text-sm text-center text-gray-500">
                  {splitMode === 'item'
                    ? (availableItems.length === 0
                        ? 'Tous les articles sont réglés'
                        : `${availableItems.length} article(s) restant(s) — ${round2(availableItems.reduce((s, it) => s + it.price, 0)).toFixed(2)} €`)
                    : `${parts.filter(isPartPaid).length} / ${parts.length} parts soldées`}
                </p>
              </div>
            )}

            {orderError && (
              <p className="text-sm text-red-600 font-semibold text-center">{orderError}</p>
            )}

            {/* Reposer la table sans la solder : un convive est parti, les autres mangent encore.
                Sans ce bouton il fallait remonter à l'étape Commande par « ← Modifier ». */}
            {openTicketMode && (
              <div>
                <button onClick={handleHoldTicket} disabled={submitting || cardInFlight}
                  className="w-full py-3 border-2 border-emerald-500 text-emerald-700 rounded-lg font-bold hover:bg-emerald-50 transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
                  <Icon name="receipt" /> {submitting ? 'Patientez…' : 'Mettre en attente'}
                </button>
                {cardInFlight && <p className="mt-1 text-xs text-gray-500 text-center">{CARD_IN_FLIGHT_HINT}</p>}
              </div>
            )}

            {!splitEnabled ? (netTotal > 0 && simpleTerminal ? null : (
              <button
                onClick={handleSubmitOrder}
                disabled={submitting || (netTotal > 0 && (
                  (payMode === 'cash' && (cashGiven === '' || cashGivenNum < netTotal))
                  || (payMode === 'ticket' && ticketKind === 'paper' && !paperTicketOk(ticketGiven, netTotal))
                  || (payMode === 'mixed' && !mixedComplete)))}
                className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold text-lg hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
              >
                {submitting ? 'Validation...' : netTotal === 0 ? 'Valider — réglé en points' : `Valider — ${netTotal.toFixed(2)} €`}
              </button>
            )) : (
              <button
                onClick={handleSubmitSplit}
                disabled={submitting || !canFinalizeSplit}
                className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold text-lg hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
              >
                {submitting ? 'Validation...'
                  : prepaidTotal > 0 ? `Clôturer la table — ${netTotal.toFixed(2)} €`
                  : `Finaliser — ${netTotal.toFixed(2)} €`}
              </button>
            )}
            <button onClick={() => setCancelConfirmOpen(true)}
              className="w-full mt-1 py-3 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition inline-flex items-center justify-center gap-2">
              <Icon name="close" /> Annuler la commande
            </button>
          </div>
        )}
      </div>

      {/* ===== MODAL WIZARD SALADE ===== */}
      {wizardOpen && wizardFormula && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:rounded-2xl sm:max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="bg-white text-gray-800 p-4 sm:rounded-t-2xl flex justify-between items-center flex-shrink-0 border-b border-gray-200">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Étape {wizardStepIdx + 1} / {WIZARD_TOTAL_STEPS} — {isWizardMenuStep ? 'Menu' : wizardStep?.label}
                </p>
                <p className="font-bold text-lg">{wizardFormula.name}</p>
              </div>
              <button onClick={() => setWizardOpen(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none"><Icon name="close" /></button>
            </div>

            <div className="h-1 bg-emerald-200 flex-shrink-0">
              <div className="h-full bg-emerald-600 transition-all"
                style={{ width: `${((wizardStepIdx + 1) / WIZARD_TOTAL_STEPS) * 100}%` }} />
            </div>

            <div className="px-4 py-2 text-sm text-gray-600 border-b flex-shrink-0">
              {isWizardMenuStep
                ? <span className="text-gray-400 italic">Transformer en menu (facultatif)</span>
                : wizardLimitMax === 0
                  ? <span className="text-gray-400 italic">Étape facultative</span>
                  : <span>{wizardCount} / {wizardLimitMax} sélectionné{wizardCount > 1 ? 's' : ''}</span>
              }
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {isWizardMenuStep ? (
                <div className="space-y-5">
                  {/* Choix du type de menu */}
                  <div className="grid grid-cols-3 gap-3">
                    {menus.map(m => {
                      const active = wizardMenu?._id === m._id;
                      return (
                        <button key={m._id} onClick={() => selectWizardMenu(m)}
                          className={`p-3 rounded-xl border-2 text-center transition-all ${active ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 hover:border-emerald-400'}`}>
                          <p className="font-bold text-gray-800 text-sm">{m.name}</p>
                          <p className="text-emerald-700 font-bold text-sm">{(m.price_addition || 0) > 0 ? `+${m.price_addition.toFixed(2)}€` : 'inclus'}</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Produits inclus si menu "upgrade" */}
                  {isUpgradeMenu(wizardMenu) && (
                    <>
                      <p className="text-sm font-semibold text-gray-700">
                        {wizardMenu.selectionMode === 'or' ? 'Une boisson OU un dessert' : 'Une boisson ET un dessert'}
                      </p>
                      {['drink', 'dessert'].filter(cat => wizardMenu.includes?.[cat]).map(cat => (
                        <div key={cat}>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">{cat === 'drink' ? 'Boissons' : 'Desserts'}</h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {products.filter(p => p.category === cat && (wizardMenu.allowedProductIds?.length ? wizardMenu.allowedProductIds.includes(p._id) : true)).map(p => {
                              const sel = wizardMenuProducts.some(mp => mp._id === p._id);
                              return (
                                <button key={p._id} onClick={() => toggleWizardMenuProduct(p)}
                                  className={`p-3 rounded-xl border-2 text-sm font-semibold transition-all ${sel ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 hover:border-emerald-400 text-gray-700'}`}>
                                  {p.name}
                                  {(p.menu_surcharge || 0) > 0 && <span className="block text-xs text-amber-600">+{p.menu_surcharge.toFixed(2)}€</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ) : wizardFiltered.length === 0 ? (
                <p className="text-center text-gray-400 py-8 italic">Aucun ingrédient disponible pour cette catégorie.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {wizardFiltered.map(ing => {
                    const selected = wizardIngredients.some(i => i._id === ing._id);
                    const over = !selected && wizardLimitMax > 0 && wizardCount >= wizardLimitMax;
                    return (
                      <button key={ing._id} onClick={() => toggleWizardIngredient(ing)}
                        className={`p-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                          selected ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                          : over ? 'border-orange-300 bg-orange-50 text-orange-700 hover:border-orange-500'
                          : 'border-gray-200 hover:border-emerald-400 text-gray-700'
                        }`}>
                        {ing.name}
                        {ing.extra_price > 0 && (
                          <span className="block text-xs text-amber-600">+{ing.extra_price.toFixed(2)}€</span>
                        )}
                        {over && (
                          <span className="block text-xs font-bold text-orange-600">
                            +{((wizardFormula.extra_cost_per_component || 0) + (ing.extra_price || 0)).toFixed(2)}€ suppl.
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t flex justify-between items-center flex-shrink-0 bg-gray-50 sm:rounded-b-2xl">
              <div className="text-sm font-bold text-emerald-700">
                {calcSaladTotal(wizardFormula, wizardIngredients, isUpgradeMenu(wizardMenu) ? wizardMenu : null, wizardMenuProducts).toFixed(2)} €
              </div>
              <div className="flex gap-2">
                {wizardStepIdx > 0 && (
                  <button onClick={() => setWizardStepIdx(i => i - 1)}
                    className="px-4 py-2 border rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100">
                    ← Précédent
                  </button>
                )}
                {wizardStepIdx < WIZARD_TOTAL_STEPS - 1 ? (
                  <button onClick={() => setWizardStepIdx(i => i + 1)}
                    className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-bold hover:bg-brand-700 transition">
                    Suivant →
                  </button>
                ) : (
                  <button onClick={wizardAddToCart}
                    disabled={!wizardIngredients.some(i => i.category === 'base_salade')}
                    className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-bold hover:bg-brand-700 transition disabled:opacity-40">
                    Ajouter au panier
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL CONFIRMATION ANNULATION ===== */}
      {/* ===== ATTRIBUTION D'UN ARTICLE AJOUTÉ APRÈS UN ENCAISSEMENT ===== */}
      {assignOpen && pendingAssign.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Attribuer cet article</h3>
            <p className="text-sm text-gray-500 mb-4">
              L'addition est déjà en cours d'encaissement : indiquez qui règle cet ajout.
              {pendingAssign.length > 1 && ` (${pendingAssign.length - 1} autre${pendingAssign.length > 2 ? 's' : ''} ensuite)`}
            </p>

            <div className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2 mb-4">
              <span className="font-semibold text-gray-800 text-sm truncate pr-2">{pendingAssign[0].label}</span>
              <span className="font-bold text-emerald-700 whitespace-nowrap">{pendingAssign[0].price.toFixed(2)} €</span>
            </div>

            <button onClick={spreadPendingEqually}
              className="w-full mb-3 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition">
              Répartir en parts égales
              <span className="block text-xs font-normal opacity-90">
                +{(pendingAssign[0].price / Math.max(1, parts.length)).toFixed(2)} € par part — les parts déjà réglées devront un complément
              </span>
            </button>

            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Attribuer à une part</p>
            <div className="space-y-2 mb-3">
              {parts.map((p, idx) => {
                const paid = isPartPaid(p);
                return (
                  <button key={idx} onClick={() => assignPendingToPart(idx)}
                    className="w-full flex justify-between items-center border-2 border-gray-200 rounded-lg px-3 py-2.5 text-sm hover:border-emerald-500 hover:bg-emerald-50 transition">
                    <span className="font-semibold text-gray-800">
                      Part {idx + 1 + prepaidParts.length}
                      {p.client && <span className="font-normal text-gray-500"> · {p.client.name}</span>}
                    </span>
                    <span className="text-xs text-gray-500">
                      {p.amount.toFixed(2)} €
                      {paid ? <span className="text-emerald-600 font-bold"> · soldée</span>
                            : partStarted(p) ? <span className="text-amber-600 font-bold"> · en cours</span> : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <button onClick={assignPendingToNewPart}
              className="w-full py-2.5 border-2 border-dashed border-emerald-400 text-emerald-700 rounded-lg text-sm font-bold hover:bg-emerald-50 transition mb-3 inline-flex items-center justify-center gap-1.5">
              <Icon name="add" /> Créer une nouvelle part pour cet article
            </button>

            <button onClick={() => setAssignOpen(false)}
              className="w-full py-2 border-2 border-gray-200 rounded-lg font-semibold text-gray-600 hover:bg-gray-50 transition">
              Plus tard
            </button>
          </div>
        </div>
      )}

      {cancelConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl text-red-500"><Icon name="trash" /></span>
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Annuler la commande ?</h3>
            {paymentLocked && (
              <p className="text-sm font-bold text-red-600 mb-2">
                {settledSoFar().toFixed(2)} € ont déjà été encaissés — ce montant devra être rendu au client
                et aucune trace ne sera conservée.
              </p>
            )}
            <p className="text-sm text-gray-500 mb-6">
              {openTicketMode
                ? (openTicketId
                    ? 'Le ticket sera annulé et retiré des tickets ouverts.'
                    : 'Le ticket en cours sera abandonné.')
                : "Le panier sera vidé et vous serez redirigé vers l'administration."}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setCancelConfirmOpen(false)}
                className="flex-1 py-2 border-2 border-gray-200 rounded-lg font-semibold text-gray-600 hover:bg-gray-50 transition">
                Continuer
              </button>
              <button
                onClick={handleCancelOrder}
                className="flex-1 py-2 bg-red-500 text-white rounded-lg font-bold hover:bg-red-600 transition">
                Oui, annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL PLAT CHAUD ===== */}
      {dishModalOpen && dishModalItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-gray-800 text-lg">{dishModalItem.name}</h3>
                <p className="text-emerald-700 font-bold">{dishModalItem.price.toFixed(2)} €</p>
              </div>
              <button onClick={() => setDishModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl"><Icon name="close" /></button>
            </div>

            {dishModalItem.sides?.length > 0 && dishModalItem.maxSides > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Accompagnements (max {dishModalItem.maxSides})
                </p>
                <div className="space-y-2">
                  {dishModalItem.sides.map((side, idx) => {
                    const sel = dishModalSides.some(s => s.name === side.name);
                    return (
                      <button key={idx} onClick={() => toggleDishSide(side)}
                        className={`w-full p-3 border-2 rounded-lg text-left flex justify-between text-sm font-medium transition-all ${
                          sel ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-amber-300'
                        }`}>
                        <span>{side.name}</span>
                        <span className={sel ? 'text-amber-700' : 'text-gray-500'}>
                          {side.priceAddition > 0 ? `+${side.priceAddition.toFixed(2)} €` : 'inclus'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Transformer en menu */}
            {menus.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Menu</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {menus.map(m => {
                    const active = dishModalMenu?._id === m._id;
                    return (
                      <button key={m._id} onClick={() => selectDishMenu(m)}
                        className={`p-2 rounded-lg border-2 text-center text-sm transition-all ${active ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 hover:border-emerald-400'}`}>
                        <p className="font-bold text-gray-800">{m.name}</p>
                        <p className="text-emerald-700 font-bold text-xs">{(m.price_addition || 0) > 0 ? `+${m.price_addition.toFixed(2)}€` : 'inclus'}</p>
                      </button>
                    );
                  })}
                </div>
                {isUpgradeMenu(dishModalMenu) && (
                  <>
                    <p className="text-xs text-gray-500 mb-2">{dishModalMenu.selectionMode === 'or' ? 'Une boisson OU un dessert' : 'Une boisson ET un dessert'}</p>
                    {['drink', 'dessert'].filter(cat => dishModalMenu.includes?.[cat]).map(cat => (
                      <div key={cat} className="mb-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">{cat === 'drink' ? 'Boissons' : 'Desserts'}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {products.filter(p => p.category === cat && (dishModalMenu.allowedProductIds?.length ? dishModalMenu.allowedProductIds.includes(p._id) : true)).map(p => {
                            const sel = dishModalMenuProducts.some(mp => mp._id === p._id);
                            return (
                              <button key={p._id} onClick={() => toggleDishMenuProduct(p)}
                                className={`p-2 rounded-lg border-2 text-xs font-semibold transition-all ${sel ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 hover:border-emerald-400 text-gray-700'}`}>
                                {p.name}
                                {(p.menu_surcharge || 0) > 0 && <span className="block text-amber-600">+{p.menu_surcharge.toFixed(2)}€</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t">
              <p className="font-bold text-gray-800">
                {(dishModalItem.price
                  + dishModalSides.reduce((s, x) => s + (x.priceAddition || 0), 0)
                  + (isUpgradeMenu(dishModalMenu) ? (dishModalMenu.price_addition || 0) + dishModalMenuProducts.reduce((s, p) => s + (p.menu_surcharge || 0), 0) : 0)
                ).toFixed(2)} €
              </p>
              <button onClick={dishAddToCart}
                className="px-6 py-2 bg-brand-600 text-white rounded-lg font-bold hover:bg-brand-700 transition">
                Ajouter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODALE BUBBLE TEA — composition (1 choix par catégorie, facultatif) ===== */}
      {btModalOpen && btModalItem && (() => {
        const cats = (btModalItem.categories || [])
          .filter(c => c.enabled !== false)
          .map(c => ({ ...c, ingredients: (c.ingredients || []).filter(i => i.enabled !== false) }))
          .filter(c => c.ingredients.length > 0);
        const supplements = btModalSelected.reduce((s, sel) => s + (sel.supplementPrice || 0), 0);
        const total = (btModalItem.price || 0) + supplements;
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-gray-800 text-lg">{btModalItem.name}</h3>
                  <p className="text-brand-700 font-bold">{(btModalItem.price || 0).toFixed(2)} €</p>
                </div>
                <button onClick={() => setBtModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl"><Icon name="close" /></button>
              </div>

              {cats.map((cat) => (
                <div key={cat.name} className="mb-4">
                  <p className="text-sm font-semibold text-gray-700 mb-2">{cat.name} <span className="text-xs font-normal text-gray-400">(une ou plusieurs, facultatif)</span></p>
                  <div className="grid grid-cols-2 gap-2">
                    {cat.ingredients.map((ing, idx) => {
                      const sel = isBtPicked(cat.name, ing);
                      return (
                        <button key={idx} onClick={() => chooseBtIngredient(cat.name, ing)}
                          className={`p-2.5 border-2 rounded-lg text-left flex justify-between items-center gap-1 text-sm font-medium transition-all ${
                            sel ? 'border-brand-600 bg-brand-50' : 'border-gray-200 hover:border-brand-300'
                          }`}>
                          <span className="truncate">{ing.name}</span>
                          {ing.isSupplement && (ing.supplementPrice || 0) > 0 && (
                            <span className="text-xs text-amber-600 whitespace-nowrap">+{ing.supplementPrice.toFixed(2)}€</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {cats.length === 0 && (
                <p className="text-sm text-gray-400 italic mb-4">Aucune option à composer.</p>
              )}

              <div className="flex justify-between items-center pt-3 border-t">
                <p className="font-bold text-gray-800">{total.toFixed(2)} €</p>
                <button onClick={bubbleTeaAddToCart}
                  className="px-6 py-2 bg-brand-600 text-white rounded-lg font-bold hover:bg-brand-700 transition">
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== MODALE MILKSHAKE — composition (1 choix par catégorie, facultatif) ===== */}
      {msModalOpen && msModalItem && (() => {
        const cats = (msModalItem.categories || [])
          .filter(c => c.enabled !== false)
          .map(c => ({ ...c, ingredients: (c.ingredients || []).filter(i => i.enabled !== false) }))
          .filter(c => c.ingredients.length > 0);
        const supplements = msModalSelected.reduce((s, sel) => s + (sel.supplementPrice || 0), 0);
        const total = (msModalItem.price || 0) + supplements;
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-gray-800 text-lg">{msModalItem.name}</h3>
                  <p className="text-brand-700 font-bold">{(msModalItem.price || 0).toFixed(2)} €</p>
                </div>
                <button onClick={() => setMsModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl"><Icon name="close" /></button>
              </div>

              {cats.map((cat) => (
                <div key={cat.name} className="mb-4">
                  <p className="text-sm font-semibold text-gray-700 mb-2">{cat.name} <span className="text-xs font-normal text-gray-400">(une ou plusieurs, facultatif)</span></p>
                  <div className="grid grid-cols-2 gap-2">
                    {cat.ingredients.map((ing, idx) => {
                      const sel = isMsPicked(cat.name, ing);
                      return (
                        <button key={idx} onClick={() => chooseMsIngredient(cat.name, ing)}
                          className={`p-2.5 border-2 rounded-lg text-left flex justify-between items-center gap-1 text-sm font-medium transition-all ${
                            sel ? 'border-brand-600 bg-brand-50' : 'border-gray-200 hover:border-brand-300'
                          }`}>
                          <span className="truncate">{ing.name}</span>
                          {ing.isSupplement && (ing.supplementPrice || 0) > 0 && (
                            <span className="text-xs text-amber-600 whitespace-nowrap">+{ing.supplementPrice.toFixed(2)}€</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {cats.length === 0 && (
                <p className="text-sm text-gray-400 italic mb-4">Aucune option à composer.</p>
              )}

              <div className="flex justify-between items-center pt-3 border-t">
                <p className="font-bold text-gray-800">{total.toFixed(2)} €</p>
                <button onClick={milkshakeAddToCart}
                  className="px-6 py-2 bg-brand-600 text-white rounded-lg font-bold hover:bg-brand-700 transition">
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== PANNEAU COMMANDES EN LIGNE — arrivées du site, par ordre d'arrivée ===== */}
      {onlinePanelOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOnlinePanelOpen(false)} />
          <div className="relative w-full max-w-sm bg-gray-50 h-full shadow-2xl flex flex-col">
            <div className="bg-emerald-700 text-white px-5 pt-4 pb-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-lg flex items-center gap-2 min-w-0">
                  <Icon name="bell" className="shrink-0" />
                  <span className="truncate">Commandes en ligne</span>
                  <span className="shrink-0 bg-white/20 text-sm px-2 py-0.5 rounded-full">{onlineAlert.orders.length}</span>
                </h2>
                <button onClick={() => setOnlinePanelOpen(false)} className="shrink-0 text-white/80 hover:text-white text-xl">
                  <Icon name="close" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={onlineAlert.testSound} title="Vérifier que le son fonctionne sur ce poste"
                  className="flex-1 text-xs font-bold bg-white/15 hover:bg-white/25 px-3 py-2 rounded-lg flex items-center justify-center gap-1.5">
                  <Icon name="bell" /> Tester le son
                </button>
                {onlineAlert.ringingCount > 0 && (
                  <button onClick={onlineAlert.silenceAll} title="Arrêter toutes les sonneries"
                    className="flex-1 text-xs font-bold bg-amber-400 hover:bg-amber-500 text-amber-950 px-3 py-2 rounded-lg flex items-center justify-center gap-1.5">
                    <Icon name="bell_off" /> Tout couper
                  </button>
                )}
              </div>
              {onlineAlert.diagnostic && (
                <p className="mt-2 text-[11px] leading-snug text-white/80">{onlineAlert.diagnostic}</p>
              )}
            </div>

            {/* Le son est piloté depuis l'Espace Gérant : ici on signale seulement qu'il est inopérant. */}
            {(!onlineAlert.enabled || onlineAlert.needsUnlock) && (
              <button
                onClick={onlineAlert.needsUnlock ? onlineAlert.unlock : onlineAlert.toggle}
                className="bg-amber-400 hover:bg-amber-500 text-amber-950 text-sm font-bold px-4 py-3 flex items-center gap-2 text-left">
                <Icon name="bell_off" />
                {onlineAlert.needsUnlock
                  ? "Son bloqué par le navigateur — cliquer pour l'activer"
                  : 'Son coupé — cliquer pour le réactiver'}
              </button>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {onlineAlert.loading ? (
                <p className="text-center text-gray-400 text-sm py-10">Chargement…</p>
              ) : onlineAlert.orders.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">Aucune commande en ligne en cours.</p>
              ) : (
                onlineAlert.orders.map(({ order: o, ringing }) => {
                  const at = tsToDate(o.createdAt);
                  const hour = at
                    ? at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Guadeloupe' })
                    : '—';
                  const number = orderLabel(o);
                  const served = o.status === 'delivered' && !o.paid;   // servi mais impayé : à encaisser en priorité
                  const statusLabel = served ? 'Servi — à encaisser'
                    : ({ pending: 'Nouvelle', preparing: 'En préparation', ready: 'Prête' }[o.status] || o.status);
                  return (
                    <div key={o._id || o.id} className={`bg-white rounded-xl p-4 ${
                      served ? 'border-2 border-amber-400 animate-blink-ring'
                        : ringing ? 'border-2 border-amber-400 shadow-md'
                        : 'border border-gray-100 shadow-sm'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-lg font-bold text-gray-900">{hour}</span>
                            <span className="text-sm font-bold text-emerald-700">{number}</span>
                          </div>
                          <p className="text-sm font-semibold text-gray-800 truncate">{o.customerName || 'Client'}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
                              served ? 'bg-amber-400 text-amber-950'
                                : o.status === 'pending' ? 'bg-red-100 text-red-700'
                                : o.status === 'ready' ? 'bg-amber-100 text-amber-800'
                                : 'bg-orange-100 text-orange-700'
                            }`}>
                              {statusLabel}
                            </span>
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
                              o.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-800 text-white'
                            }`}>
                              {o.paid ? 'Payée en ligne' : 'À payer'}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <span className="text-sm font-bold text-gray-900 whitespace-nowrap">
                            {Number(o.finalPrice ?? o.totalPrice ?? 0).toFixed(2)} €
                          </span>
                          {ringing ? (
                            <button
                              onClick={() => onlineAlert.silence(o._id || o.id)}
                              title="Arrêter la sonnerie de cette commande"
                              className="h-11 px-4 rounded-full bg-amber-300 hover:bg-amber-400 text-amber-950 font-bold flex items-center gap-2 animate-pulse transition">
                              <Icon name="bell" /> Couper
                            </button>
                          ) : (
                            <span title="Sonnerie arrêtée"
                              className="w-11 h-11 rounded-full bg-gray-100 text-gray-300 flex items-center justify-center text-xl">
                              <Icon name="bell_off" />
                            </span>
                          )}
                        </div>
                      </div>

                      {o.paid ? (
                        <button
                          onClick={() => handleAddToOnlineOrder(o)}
                          className="w-full mt-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition flex items-center justify-center gap-2">
                          <Icon name="add" /> Ajouter un produit
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSettleOnlineOrder(o)}
                          className="w-full mt-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition flex items-center justify-center gap-2">
                          <Icon name="arrow-right" /> Reprendre
                        </button>
                      )}
                      {/* Une commande déjà réglée en ligne ne s'annule pas ici : il faut un remboursement (Espace Gérant). */}
                      {!o.paid && (
                        onlineCancelTarget === (o._id || o.id) ? (
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => setOnlineCancelTarget(null)}
                              className="flex-1 py-2 rounded-lg border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition">
                              Non
                            </button>
                            <button onClick={() => handleCancelOnlineOrder(o)}
                              className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition">
                              Oui, annuler
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setOnlineCancelTarget(o._id || o.id)}
                            className="w-full mt-2 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition flex items-center justify-center gap-2">
                            <Icon name="close" /> Annuler
                          </button>
                        )
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== PANNEAU TICKETS OUVERTS — additions en attente / en cuisine non réglées ===== */}
      {ticketsPanelOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setTicketsPanelOpen(false); setTicketCancelTarget(null); }} />
          <div className="relative w-full max-w-sm bg-gray-50 h-full shadow-2xl flex flex-col">
            <div className="bg-emerald-700 text-white px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Icon name="receipt" /> Tickets ouverts
                <span className="bg-white/20 text-sm px-2 py-0.5 rounded-full">{openTickets.length}</span>
              </h2>
              <button onClick={() => { setTicketsPanelOpen(false); setTicketCancelTarget(null); }} className="text-white/80 hover:text-white">
                <Icon name="close" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingOpenTickets ? (
                <p className="text-center text-gray-400 text-sm py-10">Chargement…</p>
              ) : openTickets.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">Aucun ticket ouvert.</p>
              ) : (
                openTickets.map(o => {
                  const inKitchen = o.status !== 'open';
                  const served = o.status === 'delivered';   // servi mais impayé : à encaisser en priorité
                  return (
                    <div key={o._id} className={`bg-white rounded-xl shadow-sm p-4 ${
                      served
                        ? 'border-2 border-amber-400 animate-blink-ring'   // repérable d'un coup d'œil
                        : 'border border-gray-100'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-gray-900 truncate pr-2">{o.customerName || 'Ticket'}</span>
                        <span className="text-sm font-bold text-emerald-700 whitespace-nowrap">{Number(o.totalPrice || 0).toFixed(2)} €</span>
                      </div>
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded mb-3 ${
                        served ? 'bg-amber-400 text-amber-950'
                          : inKitchen ? 'bg-orange-100 text-orange-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {served ? 'Servi — à encaisser' : inKitchen ? 'En cuisine' : 'En attente'}
                      </span>
                      <button
                        onClick={() => handleResumeTicket(o)}
                        disabled={unsavedPayment}
                        title={unsavedPayment ? UNSAVED_PAYMENT_HINT : undefined}
                        className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                        <Icon name="arrow-right" /> Reprendre
                      </button>
                      {ticketCancelTarget === o._id ? (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => setTicketCancelTarget(null)}
                            className="flex-1 py-2 rounded-lg border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition">
                            Non
                          </button>
                          <button onClick={() => handleCancelTicketFromPanel(o)}
                            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition">
                            Oui, annuler
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setTicketCancelTarget(o._id)}
                          className="w-full mt-2 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold transition flex items-center justify-center gap-2">
                          <Icon name="close" /> Annuler
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== PANNEAU SERVICE — commandes prêtes à servir ===== */}
      {serviceOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setServiceOpen(false)} />
          <div className="relative w-full max-w-sm bg-gray-50 h-full shadow-2xl flex flex-col">
            <div className="bg-emerald-700 text-white px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Icon name="bell" /> Prêt à servir
                <span className="bg-white/20 text-sm px-2 py-0.5 rounded-full">{readyOrders.length}</span>
              </h2>
              <button onClick={() => setServiceOpen(false)} className="text-white/80 hover:text-white">
                <Icon name="close" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {readyOrders.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">Aucune commande prête.</p>
              ) : (
                readyOrders.map(order => {
                  const lines = [];
                  const salList = order.salads?.length
                    ? order.salads
                    : (order.formula ? [{ formula: order.formula, quantity: order.formulaQuantity }] : []);
                  salList.forEach(s => {
                    const name = typeof s.formula === 'object' ? s.formula?.name : s.formula;
                    if (name) lines.push(`${(s.quantity || 1) > 1 ? `${s.quantity}× ` : ''}${name}`);
                  });
                  (order.dishes || []).forEach(d => lines.push(`${(d.quantity || 1) > 1 ? `${d.quantity}× ` : ''}${d.name}`));
                  (order.cartProducts || []).forEach(p => lines.push(`${p.quantity || 1}× ${p.name}`));
                  (order.products || []).forEach(p => lines.push(typeof p === 'object' ? p.name : p));
                  return (
                    <div key={order._id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-gray-900">
                          {orderLabel(order)}
                        </span>
                        <span className="text-sm font-semibold text-gray-500">{order.customerName || '—'}</span>
                      </div>
                      {lines.length > 0 && (
                        <ul className="text-sm text-gray-600 mb-3 space-y-0.5">
                          {lines.map((l, i) => <li key={i}>• {l}</li>)}
                        </ul>
                      )}
                      <button
                        onClick={() => handleServe(order._id)}
                        disabled={servingId === order._id}
                        className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-bold transition disabled:opacity-50 flex items-center justify-center gap-2">
                        <Icon name="check" /> Servi
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <QuickClientModal
        isOpen={quickClientOpen}
        onClose={() => { setQuickClientOpen(false); setQuickClientPartIdx(null); }}
        onCreated={(client) => {
          if (partPayOpen) setPartPayClient(client);
          else if (quickClientPartIdx !== null) setPartClient(quickClientPartIdx, client);
          else handleAttachClient(client);
          setQuickClientOpen(false);
          setQuickClientPartIdx(null);
        }}
      />

      {printingSlip && partSlip && (
        <PrintArea>
          <Ticket {...partSlip.ticket} />
        </PrintArea>
      )}

      {slipSendChannel && partSlip && (
        <SendReceiptModal
          orderId={partSlip.orderId}
          channel={slipSendChannel}
          defaultTo={slipSendChannel === 'email' ? (partSlip.email || '') : (partSlip.phone || '')}
          partIndex={partSlip.index}
          onClose={() => setSlipSendChannel(null)}
        />
      )}

      <PartPaymentModal
        isOpen={partPayOpen}
        onClose={() => { setPartPayOpen(false); setPartPayClient(null); }}
        onConfirm={handlePartPaid}
        items={partPayItems}
        remaining={splitBase}
        alreadyPaid={prepaidTotal}
        runTerminalPayment={runTerminalPayment}
        onNewClient={() => setQuickClientOpen(true)}
        newClient={partPayClient}
        terminalStatus={terminalStatus}
        terminalHint={terminalHint}
        onCancelTerminal={cancelTerminalNow}
        submitting={submitting}
      />

      <ConfirmModal
        isOpen={askPrintSlip && !!partSlip}
        variant="info"
        title="Imprimer le ticket ?"
        message={partSlip ? `Part de ${partSlip.amount.toFixed(2)} € encaissée.` : ''}
        confirmLabel="Oui, imprimer"
        cancelLabel="Non"
        onConfirm={() => { setAskPrintSlip(false); setPrintingSlip(true); }}
        onCancel={() => setAskPrintSlip(false)}
      />

      {extrasProduct && (
        <ProductExtrasModal
          product={extrasProduct}
          onClose={() => setExtrasProduct(null)}
          onConfirm={(product, selectedExtras) => addProductToCart(product, selectedExtras)}
        />
      )}

      {/* Le client a payé pendant l'annulation : l'argent est en suspens tant que la caissière
          n'a pas tranché — volontairement non refermable. */}
      {pendingAuth && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <Icon name="warning" />
              <h3 className="text-lg font-extrabold">Le client a déjà payé sur le terminal</h3>
            </div>
            <p className="text-sm text-gray-600">
              La transaction de <strong>{pendingAuth.amount.toFixed(2)} €</strong> a été acceptée avant
              votre annulation. Que faut-il en faire ?
            </p>
            <button onClick={capturePendingAuth}
              className="w-full py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold transition">
              Encaisser la commande
            </button>
            <button onClick={releasePendingAuth}
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition">
              Annuler le paiement
            </button>
            <p className="text-xs text-gray-400 text-center">
              En annulant, la carte n'est pas débitée — l'empreinte peut rester visible 1 à 7 jours
              selon la banque du client.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Caisse;
