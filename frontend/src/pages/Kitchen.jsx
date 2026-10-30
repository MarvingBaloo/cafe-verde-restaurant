// src/pages/Kitchen.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { fetchOrders, updateOrderStatus } from '../services/api';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { socket } from '../socket';
import ConfirmModal from '../components/modals/ConfirmModal';
import Icon from '../components/Icon';
import { useToast } from '../context/ToastContext';
import { orderLabel, tsToDate } from '../utils/orderTicket';
import { RESTAURANT_TIMEZONE } from '../utils/hours';

// --- Regroupement KDS ---
// Fusionne les entrées STRICTEMENT identiques d'un même type et somme les quantités
// (ex: deux "Menu XL" identiques → "Menu XL ×2"). Deux articles qui diffèrent ne
// serait-ce que d'un détail (un ingrédient, une option, le menu) restent deux lignes
// distinctes. On ne regroupe jamais au niveau ingrédient : l'unité est l'article entier.
const itemName = (x) => (x && typeof x === 'object' ? x.name : x);
const listSig = (arr) => (Array.isArray(arr) ? arr.map(itemName).filter(Boolean).sort().join('|') : '');

const groupItems = (items, sigFn) => {
  const map = new Map();
  (items || []).forEach((raw) => {
    const it = raw && typeof raw === 'object' ? raw : { name: raw };
    const sig = sigFn(it);
    const prev = map.get(sig);
    if (prev) prev.quantity += (it.quantity || 1);
    else map.set(sig, { ...it, quantity: it.quantity || 1 });
  });
  return [...map.values()];
};

const saladSig = (s) => [itemName(s.formula) || '', listSig(s.ingredients), s.menu?.name || '', listSig(s.menuProducts)].join('§');
const dishSig = (d) => [d.name || '', listSig(d.selectedSides), d.menu?.name || '', listSig(d.menuProducts)].join('§');
const drinkSig = (x) => [x.name || '', (x.selections || []).map(s => `${s.category || ''}:${s.name || ''}`).sort().join('|')].join('§');
const productSig = (p) => [p._id || p.id || p.name || '', (p.selectedExtras || []).map(e => e.name).sort().join('|')].join('§');

const Kitchen = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState([]);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const { user, isDev } = useAuth();
  const isGerant = user?.role === 'admin' || user?.role === 'superadmin' || isDev;
  const [cancelledListHidden, setCancelledListHidden] = useState(false);
  const [confirmState, setConfirmState] = useState({ open: false, title: '', message: '', onConfirm: null, variant: 'warning' });
  const closeConfirm = () => setConfirmState(s => ({ ...s, open: false, onConfirm: null }));

  // 1. Chargement initial des commandes
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const response = await fetchOrders();
        
        // Logique d'extraction intelligente (Gère le bug backend .message)
        let allOrders = [];
        if (Array.isArray(response.data)) {
            allOrders = response.data;
        } else if (response.data && Array.isArray(response.data.message)) {
            allOrders = response.data.message;
        } else if (response.data && Array.isArray(response.data.data)) {
            allOrders = response.data.data;
        }

        // On garde les commandes actives + annulées (pour la zone "Annulées du jour")
        const relevantOrders = allOrders.filter(o =>
          ['pending', 'preparing', 'ready', 'cancelled'].includes(o.status)
        );
        setOrders(relevantOrders);
      } catch (error) {
        console.error("Erreur chargement cuisine:", error);
      }
    };

    loadInitialData();

    // 2. Écoute connexion/déconnexion
    const onConnect = () => { setIsConnected(true); console.log('[KDS] Connecté au serveur'); };
    const onDisconnect = () => { setIsConnected(false); console.log('[KDS] Déconnecté'); };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // 3. Écoute des événements Socket
  useEffect(() => {

    const onNewOrder = (newOrder) => setOrders(prev => [newOrder, ...prev]);
    const onOrderUpdated = (updatedOrder) => {
      setOrders(prev => {
        if (updatedOrder.status === 'delivered') return prev.filter(o => o._id !== updatedOrder._id);
        return prev.map(o => o._id === updatedOrder._id ? updatedOrder : o);
      });
    };
    const onOrderCancelled = ({ orderId, order }) => {
      setOrders(prev => prev.map(o => o._id === orderId ? order : o));
      setCancelledListHidden(false);
    };

    socket.on('new_order', onNewOrder);
    socket.on('order_updated', onOrderUpdated);
    socket.on('order:cancelled', onOrderCancelled);

    return () => {
      socket.off('new_order', onNewOrder);
      socket.off('order_updated', onOrderUpdated);
      socket.off('order:cancelled', onOrderCancelled);
    };
  }, []);

  // --- LOGIQUE MÉTIER ---

  const moveOrder = async (orderId, nextStatus) => {
    try {
      // 1. Mise à jour Optimiste (UI d'abord)
      setOrders(prev => prev.map(o => 
        o._id === orderId ? { ...o, status: nextStatus } : o
      ));

      // 2. Appel API
      await updateOrderStatus(orderId, nextStatus);

      // 3. Gestion spéciale pour la fin de cycle (Livré)
      if (nextStatus === 'delivered') {
        // On laisse la carte affichée 2 secondes dans la colonne "Prêt" avant de la faire disparaître
        setTimeout(() => {
          setOrders(prev => prev.filter(o => o._id !== orderId));
        }, 1000);
      }

    } catch (error) {
      console.error("Erreur changement statut", error);
      // En cas d'erreur, on pourrait recharger la liste complète
    }
  };

  const handleCancelOrder = (orderId) => {
    setConfirmState({
      open: true,
      title: 'Annuler la commande',
      message: 'Êtes-vous sûr de vouloir annuler cette commande ?',
      variant: 'warning',
      onConfirm: async () => {
        closeConfirm();
        try {
          await api.patch(`/orders/${orderId}/cancel`);
          // Le Socket.io émis par le backend met à jour la liste automatiquement
        } catch (error) {
          toast.error('Impossible d\'annuler : ' + (error.response?.data?.message || error.message));
        }
      }
    });
  };

  // Séparation des colonnes (statuses mutuellement exclusifs, 'cancelled' exclu naturellement)
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const preparingOrders = orders.filter(o => o.status === 'preparing');
  const readyOrders = orders.filter(o => o.status === 'ready');

  // --- Scindage En ligne / Sur place ---
  // Le KDS ne se scinde que s'il existe au moins une commande EN LIGNE active.
  const isOnline = (o) => o.source === 'online';
  const hasOnlineOrders = orders.some(o => isOnline(o) && ['pending', 'preparing', 'ready'].includes(o.status));

  // Étape la plus en arrière occupée par une commande en ligne (0=À faire,1=En prépa,2=Prêt) ; Infinity si aucune.
  // Sert au "fil de progression" : une section En ligne vide n'est masquée que si son étape est DÉJÀ dépassée.
  const STAGES = ['pending', 'preparing', 'ready'];
  const minOnlineStage = orders.reduce((min, o) => {
    if (!isOnline(o)) return min;
    const idx = STAGES.indexOf(o.status);
    return idx >= 0 && idx < min ? idx : min;
  }, Infinity);

  // Rend le corps d'une colonne : mode scindé (2 sections) ou liste à plat (comportement d'origine).
  const renderColumnBody = (stageIndex, list, makeTicket) => {
    if (!hasOnlineOrders) return list.map(makeTicket);
    const online = list.filter(isOnline);
    const onsite = list.filter(o => !isOnline(o));
    const showOnline = online.length > 0 || stageIndex >= minOnlineStage; // étape en cours/à venir : on garde visible même vide
    const showOnsite = onsite.length > 0;
    return (
      <>
        {showOnline && (
          <Section label="En ligne" icon="globe" tone="online">
            {online.length > 0
              ? online.map(makeTicket)
              : <p className="text-xs text-gray-500 italic px-1 py-3 text-center">À venir…</p>}
          </Section>
        )}
        {showOnsite && (
          <Section label="Sur place" icon="store" tone="onsite">
            {onsite.map(makeTicket)}
          </Section>
        )}
      </>
    );
  };

  // Commandes annulées aujourd'hui — useMemo pour éviter recalcul à chaque render
  const cancelledTodayOrders = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return orders.filter(o => {
      if (o.status !== 'cancelled') return false;
      // Vente abandonnée à la caisse, jamais envoyée en cuisine : c'est une trace comptable,
      // pas un plat à ne plus préparer.
      if (o.reachedKitchen === false) return false;
      const orderDate = new Date(o.updatedAt || o.createdAt);
      return orderDate >= today;
    });
  }, [orders]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 font-sans flex flex-col overflow-y-auto">
      {/* Header KDS */}
      <header className="flex flex-wrap justify-between items-center gap-2 mb-6 px-2">
        <div className="flex items-center gap-3 sm:gap-4">
          <h1 className="text-lg sm:text-2xl font-bold tracking-wider sm:tracking-widest text-white">KITCHEN DISPLAY SYSTEM</h1>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${isConnected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
        <div className="text-gray-400 font-mono text-sm">
          {new Date().toLocaleTimeString()}
        </div>
      </header>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:min-h-[60vh]">
        
        {/* COLONNE 1 : À FAIRE */}
        <Column
          title="À FAIRE"
          count={pendingOrders.length}
          color="border-red-500"
          bgColor="bg-gray-800"
        >
          {renderColumnBody(0, pendingOrders, order => (
            <OrderTicket
              key={order._id}
              order={order}
              btnAction={() => moveOrder(order._id, 'preparing')}
              btnText="LANCER"
              btnColor="bg-blue-600 hover:bg-blue-500"
              showCancel={isGerant}
              onCancel={() => handleCancelOrder(order._id)}
            />
          ))}
        </Column>

        {/* COLONNE 2 : EN COURS */}
        <Column
          title="EN PRÉPARATION"
          count={preparingOrders.length}
          color="border-yellow-500"
          bgColor="bg-gray-800"
        >
          {renderColumnBody(1, preparingOrders, order => (
            <OrderTicket
              key={order._id}
              order={order}
              btnAction={() => moveOrder(order._id, 'ready')}
              btnText="TERMINER"
              btnColor="bg-yellow-600 hover:bg-yellow-500"
              showCancel={isGerant}
              onCancel={() => handleCancelOrder(order._id)}
              onMoveBack={isGerant ? () => moveOrder(order._id, 'pending') : undefined}
            />
          ))}
        </Column>

        {/* COLONNE 3 : PRÊT */}
        <Column
          title="PRÊT À SERVIR"
          count={readyOrders.length}
          color="border-green-500"
          bgColor="bg-gray-800"
        >
          {renderColumnBody(2, readyOrders, order => (
            <OrderTicket
              key={order._id}
              order={order}
              waitingService={true}
              isReady={true}
              showCancel={isGerant}
              onCancel={() => handleCancelOrder(order._id)}
              onMoveBack={isGerant ? () => moveOrder(order._id, 'preparing') : undefined}
            />
          ))}
        </Column>

      </div>

      {/* MODAL DE CONFIRMATION */}
      <ConfirmModal
        isOpen={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={closeConfirm}
      />

      {/* Zone Annulées du jour */}
      {!cancelledListHidden && cancelledTodayOrders.length > 0 && (
        <div className="mt-8 bg-red-950/40 border-2 border-cherry/30 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-cherry flex items-center gap-2">
              <Icon name="forbid" /> Annulées aujourd'hui
              <span className="text-sm font-normal text-cherry/70">
                ({cancelledTodayOrders.length})
              </span>
            </h2>
            <button
              onClick={() => setCancelledListHidden(true)}
              className="text-sm text-cherry hover:text-cherry/70 underline transition-colors"
            >
              Vider la liste
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cancelledTodayOrders.map(order => (
              <div key={order._id} className="bg-gray-800 rounded-lg border border-cherry/40 p-4 opacity-75">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-200">
                    {orderLabel(order)} — {order.customerName || '—'}
                  </span>
                  <span className="text-xs font-bold text-white bg-cherry px-2 py-1 rounded">
                    ANNULÉE
                  </span>
                </div>
                <p className="text-sm text-gray-400">
                  {order.formula ? (typeof order.formula === 'object' ? order.formula.name : order.formula) : '—'}
                </p>
                {order.totalPrice != null && (
                  <p className="text-xs text-gray-500 mt-1">{Number(order.totalPrice).toFixed(2)} €</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- COMPOSANTS UI INTERNES ---

// Sous-section empilée d'une colonne en mode scindé (En ligne / Sur place).
const Section = ({ label, icon, tone, children }) => (
  <div className="mb-5 last:mb-0">
    <div className={`flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider ${
      tone === 'online' ? 'bg-sky-900/60 text-sky-300 border-l-4 border-sky-400' : 'bg-gray-700/50 text-gray-300 border-l-4 border-gray-500'
    }`}>
      <Icon name={icon} /> {label}
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);

const Column = ({ title, count, children, color, bgColor }) => (
  <div className={`flex flex-col h-full rounded-xl border-t-4 ${color} ${bgColor} shadow-2xl overflow-hidden`}>
    <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-black/20">
      <h2 className="font-bold text-lg uppercase tracking-wider text-white">{title}</h2>
      <span className="bg-gray-700 text-white px-3 py-1 rounded-full font-mono font-bold">{count}</span>
    </div>
    <div className="flex-grow overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
      {children}
    </div>
  </div>
);

const OrderTicket = ({ order, btnAction, btnText, btnColor, isReady, waitingService, showCancel, onCancel, onMoveBack }) => {
  // Calcul du temps écoulé
  const [minutesElapsed, setMinutesElapsed] = useState(0);

  useEffect(() => {
    const calcTime = () => {
      // Une commande réservée a été créée la veille : compter depuis sa création
      // afficherait « 800 min » en rouge. Le chrono part du moment où la cuisine
      // l'a réellement reçue.
      const ts = order.kitchenReleaseAt || order.createdAt;
      const start = ts?.toDate ? ts.toDate().getTime()       // Timestamp Firestore SDK
        : ts?._seconds != null ? ts._seconds * 1000          // Timestamp sérialisé en JSON
        : ts?.seconds  != null ? ts.seconds  * 1000          // Autre forme
        : new Date(ts).getTime();                            // String ISO ou Date JS
      const now = new Date().getTime();
      setMinutesElapsed(Math.floor((now - start) / 60000));
    };
    calcTime(); // Init
    const interval = setInterval(calcTime, 60000); // Update every min
    return () => clearInterval(interval);
  }, [order.createdAt, order.kitchenReleaseAt]);

  // Alerte retard (> 10 min et pas encore prêt)
  const isLate = minutesElapsed > 10 && !isReady;

  return (
    <div className={`
      relative bg-white text-gray-900 rounded-lg p-4 shadow-lg transition-all duration-300
      ${isLate ? 'ring-4 ring-red-500 animate-pulse' : ''}
      ${isReady ? 'bg-green-50' : ''}
    `}>
      {/* Timer Badge */}
      <div className={`absolute top-4 right-4 text-xs font-bold px-2 py-1 rounded 
        ${isLate ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
        {minutesElapsed} min
      </div>

      {/* Header Ticket */}
      <div className="mb-3 pr-10">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-xl">{orderLabel(order)}</h3>
          {order.paid === false && (order.source === 'online' || order.source === 'caisse') && (
            <span className="text-[10px] font-bold text-white bg-orange-500 px-2 py-0.5 rounded uppercase tracking-wide">À payer</span>
          )}
          {/* Commande réservée à l'avance : l'heure de retrait prime sur tout le reste,
              c'est elle qui dit quand la préparer. */}
          {order.scheduledFor && (
            <span className="text-[10px] font-bold text-white bg-violet-600 px-2 py-0.5 rounded uppercase tracking-wide">
              Retrait {tsToDate(order.scheduledFor)?.toLocaleTimeString('fr-FR', {
                hour: '2-digit', minute: '2-digit', timeZone: RESTAURANT_TIMEZONE,
              })}
            </span>
          )}
          {/* Mode de consommation choisi par le client en ligne — indépendant du paiement */}
          {order.source === 'online' && order.consumptionMode && (
            <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded uppercase tracking-wide ${
              order.consumptionMode === 'takeaway' ? 'bg-indigo-600' : 'bg-sky-600'
            }`}>
              {order.consumptionMode === 'takeaway' ? 'À emporter' : 'À consommer sur place'}
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-gray-600">{order.customerName}</p>
      </div>

      {/* Détail salade(s) — salads[] si présent, sinon repli sur le champ formula unique */}
      <div className="mb-4 text-sm border-t border-b border-gray-100 py-2">
        {(() => {
          const salList = groupItems(
            order.salads?.length
              ? order.salads
              : (order.formula ? [{ formula: order.formula, ingredients: order.ingredients, quantity: order.formulaQuantity, menu: order.menu }] : []),
            saladSig
          );
          if (salList.length === 0) return <div className="font-bold text-gray-800 mb-1">—</div>;
          return salList.map((s, si) => {
            const name = typeof s.formula === 'object' ? s.formula?.name : s.formula;
            const menuName = s.menu?.name && s.menu.name !== 'Solo' && s.menu.name !== 'Sans Menu' ? s.menu.name : null;
            return (
              <div key={si} className={si > 0 ? 'mt-2 pt-2 border-t border-dashed border-gray-200' : ''}>
                <div className="font-bold text-gray-800 mb-1">
                  {name || '—'}
                  {(s.quantity || 1) > 1 && <span className="ml-2 text-cherry">×{s.quantity}</span>}
                  {menuName && <span className="ml-2 text-xs font-bold text-emerald-700 uppercase">{menuName}</span>}
                </div>
                {menuName && s.menuProducts?.length > 0 && (
                  <p className="text-xs text-emerald-700 pl-1 mb-1">{s.menuProducts.map(p => typeof p === 'object' ? p.name : p).join(', ')}</p>
                )}
                <ul className="space-y-1 text-gray-600 pl-1">
                  {Array.isArray(s.ingredients) && s.ingredients.map((ing, i) => (
                    <li key={i} className="flex items-start gap-2 leading-tight">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0"></span>
                      <span>{typeof ing === 'object' ? ing.name : ing}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          });
        })()}

        {/* Produits annexes */}
        {order.products && order.products.length > 0 && (
          <div className="mt-2 pt-2 border-t border-dashed border-gray-200 text-blue-600 font-semibold">
            {groupItems(order.products, productSig).map((p, i) => (
              <span key={i}>{i > 0 && ', '}{itemName(p)}{p.selectedExtras?.length ? ` (+${p.selectedExtras.map(e => e.name).join(', ')})` : ''}{p.quantity > 1 && ` ×${p.quantity}`}</span>
            ))}
          </div>
        )}
      </div>

      {/* Plats chauds (si commande mixte ou plat seul) */}
      {order.dishes?.length > 0 && (
        <div className="mb-3 pt-2 border-t border-gray-100">
          <p className="text-xs font-bold uppercase tracking-wider text-cherry mb-1">Plats chauds</p>
          {groupItems(order.dishes, dishSig).map((d, i) => (
            <div key={i} className="text-sm mb-1">
              <p className="font-bold text-gray-800">
                {(d.quantity || 1) > 1 && <span className="text-cherry">{d.quantity}× </span>}{d.name}
              </p>
              {d.selectedSides?.length > 0 && (
                <p className="text-xs text-stone-500">
                  + {d.selectedSides.map(s => s.name).join(', ')}
                </p>
              )}
              {d.menu?.name && d.menu.name !== 'Solo' && d.menu.name !== 'Sans Menu' && (
                <p className="text-xs font-semibold text-emerald-700">
                  {d.menu.name}{d.menuProducts?.length ? ` : ${d.menuProducts.map(p => typeof p === 'object' ? p.name : p).join(', ')}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bubble teas */}
      {order.bubbleTeas?.length > 0 && (
        <div className="mb-3 pt-2 border-t border-gray-100">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700 mb-1">Bubble teas</p>
          {groupItems(order.bubbleTeas, drinkSig).map((b, i) => {
            // Regroupe les options par catégorie pour la préparation (Billes : fraise, passion / Sirop : …)
            const byCategory = (b.selections || []).reduce((acc, s) => {
              const cat = s.category || 'Options';
              (acc[cat] = acc[cat] || []).push(s.name);
              return acc;
            }, {});
            return (
              <div key={i} className="text-sm mb-1">
                <p className="font-bold text-gray-800">
                  {(b.quantity || 1) > 1 && <span className="text-brand-700">{b.quantity}× </span>}{b.name}
                </p>
                {Object.entries(byCategory).map(([cat, names]) => (
                  <p key={cat} className="text-xs text-stone-500">
                    <span className="font-semibold text-stone-600">{cat} :</span> {names.join(', ')}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Milkshakes */}
      {order.milkshakes?.length > 0 && (
        <div className="mb-3 pt-2 border-t border-gray-100">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700 mb-1">Milkshakes</p>
          {groupItems(order.milkshakes, drinkSig).map((m, i) => {
            // Regroupe les options par catégorie pour la préparation (Glaces : vanille / Topping : …)
            const byCategory = (m.selections || []).reduce((acc, s) => {
              const cat = s.category || 'Options';
              (acc[cat] = acc[cat] || []).push(s.name);
              return acc;
            }, {});
            return (
              <div key={i} className="text-sm mb-1">
                <p className="font-bold text-gray-800">
                  {(m.quantity || 1) > 1 && <span className="text-brand-700">{m.quantity}× </span>}{m.name}
                </p>
                {Object.entries(byCategory).map(([cat, names]) => (
                  <p key={cat} className="text-xs text-stone-500">
                    <span className="font-semibold text-stone-600">{cat} :</span> {names.join(', ')}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Produits à l'unité */}
      {order.cartProducts?.length > 0 && (
        <div className="mb-3 pt-2 border-t border-gray-100">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-1">Produits</p>
          {groupItems(order.cartProducts, productSig).map((p, i) => (
            <div key={i}>
              <p className="text-sm font-bold text-gray-800">{p.quantity}× {p.name}</p>
              {p.selectedExtras?.length > 0 && (
                <p className="text-xs text-gray-500 pl-3">+ {p.selectedExtras.map(e => e.name).join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action Button — absent dans la colonne "Prêt à servir" (la caisse clôt la commande) */}
      {btnText && (
        <button
          onClick={btnAction}
          className={`w-full py-3 rounded-lg font-bold text-white shadow-md transition-transform active:scale-95 ${btnColor}`}
        >
          {btnText}
        </button>
      )}

      {/* État d'attente : la commande est prête, le service la remet au client depuis la caisse */}
      {waitingService && (
        <div className="w-full py-2.5 rounded-lg bg-green-100 text-green-800 font-bold text-center text-sm flex items-center justify-center gap-2">
          <Icon name="check" /> En attente de service
        </div>
      )}

      {/* Actions gérant — reculer le statut / annuler */}
      {(onMoveBack || showCancel) && (
        <div className="mt-2 flex gap-2">
          {onMoveBack && (
            <button
              onClick={onMoveBack}
              className="flex-1 px-3 py-1 text-xs rounded-lg font-bold text-white shadow-md transition-transform active:scale-95 bg-gray-600 hover:bg-gray-500 flex items-center justify-center gap-1"
            >
              <Icon name="arrow-left" /> Reculer
            </button>
          )}
          {showCancel && (
            <button
              onClick={onCancel}
              className="flex-1 px-3 py-1 text-xs rounded-lg font-bold text-white shadow-md transition-transform active:scale-95 bg-red-600 hover:bg-red-500"
            >
              Annuler
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default Kitchen;