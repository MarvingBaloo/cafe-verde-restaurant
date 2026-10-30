// src/pages/Summary.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useConfig } from '../context/ConfigContext';
import { useAuth } from '../context/AuthContext';
import { createOrder, fetchTaxConfig } from '../services/api';
import { hapticOrderSuccess, hapticError } from '../utils/haptic';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { POINTS_PER_EURO, pointsToEuros } from '../utils/loyalty';
import Icon from '../components/Icon';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { savePendingOrder, clearPendingOrder } from '../utils/pendingOrder';
import { useOpeningHours } from '../hooks/useOpeningHours';
import PickupSlotPicker from '../components/PickupSlotPicker';
import { humanTime, zonedToUtc } from '../utils/hours';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import api from '../services/api';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

/**
 * @description Page de récapitulatif de la commande.
 * Affiche un résumé de la commande, permet de saisir un nom,
 * et de valider la commande pour l'envoyer au backend.
 * @author Marvin G.
 */
const StripeCheckoutForm = ({ orderData, finalPrice, pointsToRedeem, onSuccess, onBack, updateUserLoyalty, trackOrderValidated, trackOrderCancelled }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [payError, setPayError] = useState('');
  const [slowHint, setSlowHint] = useState(false);
  const slowTimer = useRef(null);

  useEffect(() => () => clearTimeout(slowTimer.current), []);

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setIsProcessing(true);
    setPayError('');
    setSlowHint(false);

    // `confirmPayment` reste en attente tant que le challenge 3-D Secure n'a pas rendu sa
    // réponse : si la fenêtre de la banque ne s'ouvre pas, rien ne l'interrompt. Ce délai
    // n'annule pas le paiement — il explique simplement la situation au client.
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(() => setSlowHint(true), 45000);

    // Sauvegardé AVANT la confirmation : si la banque impose une redirection pleine page
    // pour le 3-D Secure, ce composant est détruit et seule cette copie permet de créer
    // la commande au retour (pages/PaymentReturn.jsx).
    savePendingOrder({ orderData, finalPrice, pointsToRedeem });

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}/paiement/retour` },
        redirect: 'if_required',
      });

      if (error) {
        setPayError(error.message || "Le paiement n'a pas pu être finalisé.");
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        try {
          const response = await createOrder({ ...orderData, paymentIntentId: paymentIntent.id });
          hapticOrderSuccess();
          const pointsEarned = Math.floor(finalPrice);
          updateUserLoyalty(pointsEarned - pointsToRedeem);
          const created = response.data?.data || response.data;
          trackOrderValidated({ _id: created?._id, totalPrice: orderData.totalPrice, ingredientsCount: orderData.ingredients?.length || 0, productsCount: orderData.products?.length || 0 });
          onSuccess(created);
        } catch {
          hapticError();
          setPayError('Paiement accepté mais erreur lors de la création de la commande. Présentez ce message au comptoir.');
          trackOrderCancelled('error_after_payment');
        }
        return;
      }

      // Tout statut non final doit produire un message : sans cela le client reste
      // devant un bouton qui tourne (ou redevient cliquable) sans aucune explication.
      switch (paymentIntent?.status) {
        case 'processing':
          setPayError("Votre paiement est en cours de traitement par votre banque. Ne fermez pas cette page, le résultat arrive dans quelques instants.");
          break;
        case 'requires_action':
          setPayError("L'authentification demandée par votre banque n'a pas abouti. Relancez le paiement et validez la demande dans votre application bancaire.");
          break;
        case 'requires_payment_method':
          setPayError("Le paiement a été refusé. Vérifiez vos informations ou utilisez une autre carte.");
          break;
        default:
          setPayError("Le paiement n'a pas abouti. Aucun montant n'a été débité.");
      }
    } catch {
      setPayError("Une erreur est survenue pendant le paiement. Aucun montant n'a été débité.");
    } finally {
      // En cas de redirection vers la banque, la page est quittée et ce bloc ne s'exécute
      // pas : la commande en attente reste disponible pour PaymentReturn.
      clearTimeout(slowTimer.current);
      setSlowHint(false);
      clearPendingOrder();
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleConfirm} className="bg-white rounded-2xl shadow-lg p-4 sm:p-8 border border-gray-100">
      <h2 className="text-lg font-bold text-gray-800 mb-4">Paiement par carte</h2>
      <PaymentElement className="mb-6" />
      {payError && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm font-bold mb-4">{payError}</div>}
      {slowHint && !payError && (
        <div className="bg-amber-50 text-amber-800 px-4 py-3 rounded-lg text-sm mb-4">
          <p className="font-bold mb-1">L'authentification prend plus de temps que prévu.</p>
          <p>
            Si la fenêtre de votre banque ne s'est pas ouverte, désactivez votre bloqueur de publicités
            ou essayez depuis un autre navigateur. Aucun montant n'a encore été débité.
          </p>
        </div>
      )}
      <button type="submit" disabled={!stripe || isProcessing}
        className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-brand-600 transition-all flex justify-center items-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed">
        {isProcessing ? (
          <><div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div><span>Traitement...</span></>
        ) : (
          <span>Payer {finalPrice.toFixed(2)} €</span>
        )}
      </button>
      <button type="button" onClick={onBack} className="mt-3 w-full px-6 py-3 text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors">
        Retour
      </button>
    </form>
  );
};

const Summary = () => {
  const { order, totalPrice, resetOrder, removeDishFromOrder, removeBubbleTeaFromOrder, removeMilkshakeFromOrder, incrementProductInCart, decrementProductInCart, removeProductFromCart } = useConfig();
  const { user, updateUserLoyalty } = useAuth(); // Récupération de l'utilisateur connecté et fonction de mise à jour
  const navigate = useNavigate();
  
  // Hook de tracking d'activité
  const { trackOrderStarted, trackOrderValidated, trackOrderCancelled } = useActivityTracker();
  
  const [customerName, setCustomerName] = useState('');
  // Téléphone : obligatoire pour un client SANS compte — c'est par lui qu'il reçoit la
  // confirmation de commande (SMS) et que ses points se rattachent à un futur compte.
  const [customerPhone, setCustomerPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null); // { orderNumber, scheduledFor } pour l'écran de succès
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [paymentStep, setPaymentStep] = useState('form');
  const [clientSecret, setClientSecret] = useState('');
  const [pendingOrderData, setPendingOrderData] = useState(null);
  const [payingOnSite, setPayingOnSite] = useState(false);
  const [consumptionMode, setConsumptionMode] = useState('dineIn'); // sur place / à emporter → pilote la ventilation TVA

  // Horaires : le serveur refusera de lui-même hors créneau ; ici on évite au client
  // de composer un panier entier pour se le voir refuser au paiement.
  const { scheduling, todayPickup, closed: orderingClosed, message: closedNotice, reload: reloadHours } = useOpeningHours();
  const [pickupAt, setPickupAt] = useState(null); // heure de retrait choisie (ISO)

  // Une seule journée est proposée à la fois : aujourd'hui tant que la commande est
  // ouverte, demain une fois la journée close.
  const pickupOffer = orderingClosed ? scheduling : todayPickup;

  // Le créneau retenu ne vaut que tant qu'il figure dans l'offre courante : elle avance
  // avec l'heure (« dans 15 min » se décale) et la boutique peut fermer pendant que le
  // client hésite. On ne laisse jamais partir une heure que le serveur refusera.
  useEffect(() => {
    if (!pickupOffer) { setPickupAt(null); return; }
    const valides = pickupOffer.slots.map((s) => zonedToUtc(pickupOffer.date, s)?.toISOString());
    if (pickupAt && valides.includes(pickupAt)) return;
    // Aujourd'hui : le plus tôt possible est pré-sélectionné, le client garde un parcours
    // en un clic. Demain : rien n'est pré-choisi, c'est une décision qu'il doit prendre.
    setPickupAt(orderingClosed ? null : (valides[0] || null));
  }, [pickupOffer, pickupAt, orderingClosed]);

  const scheduledFor = pickupAt;
  // Plus de commande sans heure de retrait : il faut un créneau valide pour valider.
  // Sans compte, il faut aussi un téléphone — seul lien avec la commande.
  const canOrder = !!scheduledFor && (!!user || !!customerPhone);
  // Réserver, c'est commander pour un autre jour. Fermé sans repli possible, il n'y a
  // pas de créneau du tout : les boutons ne doivent alors rien promettre.
  const isReservation = orderingClosed && !!pickupOffer;
  const pickupLabel = pickupOffer && scheduledFor
    ? humanTime(pickupOffer.slots.find((s) => zonedToUtc(pickupOffer.date, s)?.toISOString() === scheduledFor))
    : null;

  // Paiement en ligne par carte activé (compte Stripe live : pk_live côté Vercel + sk_live côté backend)
  const CARD_PAYMENT_ENABLED = true;

  const availablePoints = user?.loyaltyPoints || 0;
  // Plafond de réduction en € : valeur des points dispo, bornée au total de la commande.
  const maxRedeemableTiers = Math.min(
    Math.floor(pointsToEuros(availablePoints)),
    Math.floor(totalPrice)
  );
  const discountAmount = pointsToEuros(pointsToRedeem);
  const finalPrice = Math.max(0, totalPrice - discountAmount);

  // Pré-remplissage du nom si l'utilisateur est connecté
  useEffect(() => {
    if (user && user.name) {
      setCustomerName(user.name);
    }
  }, [user]);

  // Mode de consommation par défaut → aligné sur la config taxes (comme la caisse)
  useEffect(() => {
    fetchTaxConfig()
      .then((res) => {
        const cfg = res.data || null;
        if (cfg?.defaultMode) setConsumptionMode(cfg.defaultMode);
      })
      .catch(() => {});
  }, []);

  // Tracking: Commande démarrée (arrivée sur la page)
  useEffect(() => {
    if (order.formula) {
      trackOrderStarted({
        totalPrice,
        ingredientsCount: order.ingredients?.length || 0,
        productsCount: order.products?.length || 0,
        hasMenu: !!order.menu
      });
    }
  }, []); // Uniquement au montage du composant

  // Redirection si le panier est vide (ni salade, ni plat chaud, ni produit à l'unité)
  const hasSalade = !!order.formula;
  const hasDishes = (order.dishes || []).length > 0;
  const bubbleTeas = order.bubbleTeas || [];
  const hasBubbleTeas = bubbleTeas.length > 0;
  const milkshakes = order.milkshakes || [];
  const hasMilkshakes = milkshakes.length > 0;
  const cartProducts = order.cartProducts || [];
  const hasCartProducts = cartProducts.length > 0;
  if (!hasSalade && !hasDishes && !hasCartProducts && !hasBubbleTeas && !hasMilkshakes) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center">
        <h1 className="text-2xl font-bold mb-4">Votre panier est vide</h1>
        <p className="mb-8">Commencez par choisir une formule ou un plat chaud.</p>
        <Link to="/products" className="bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700">
          Voir le menu
        </Link>
      </div>
    );
  }

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setError('Veuillez saisir votre prénom.');
      return;
    }
    // Sans compte, le téléphone est le seul moyen de recevoir la confirmation de commande
    // et de rattacher les points à un futur compte partageant ce numéro.
    if (!user && !customerPhone) {
      setError('Veuillez saisir votre numéro de téléphone.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const orderData = {
        customerName: customerName,
        phone: customerPhone || null,
        totalPrice: totalPrice,
        formula: order.formula || null,
        formulaQuantity: order.formulaQuantity || 1,
        ingredients: order.ingredients,
        menu: order.menu,
        products: order.products,
        dishes: order.dishes || [],
        cartProducts: order.cartProducts || [],
        bubbleTeas: order.bubbleTeas || [],
        milkshakes: order.milkshakes || [],
        user: user ? (user.data?._id || user._id) : null,
        pointsToRedeem,
        source: 'online',
        paymentMethod: 'card',
        consumptionMode,
        scheduledFor,
      };
      setPendingOrderData(orderData);
      const response = await api.post('/payment/create-intent', { amount: finalPrice, scheduledFor });
      setClientSecret(response.data.clientSecret);
      setPaymentStep('payment');
    } catch (err) {
      // Fermeture survenue pendant la composition du panier : le serveur tranche,
      // on relit les horaires pour que l'écran dise la même chose que lui.
      const refus = err?.response?.status === 503 || err?.response?.status === 400;
      setError(refus && err?.response?.data?.message
        ? err.response.data.message
        : "Impossible d'initialiser le paiement.");
      if (refus) reloadHours();
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // « Payer sur place » : crée directement la commande non réglée (source online), sans Stripe.
  // Aucun point fidélité ni réduction ici — réglés à l'encaissement à la caisse.
  const handlePayOnSite = async () => {
    if (!customerName.trim()) {
      setError('Veuillez saisir votre prénom.');
      return;
    }
    if (!user && !customerPhone) {
      setError('Veuillez saisir votre numéro de téléphone.');
      return;
    }
    setPayingOnSite(true);
    setError('');
    try {
      const response = await createOrder({
        customerName,
        phone: customerPhone || null,
        totalPrice,
        formula: order.formula || null,
        formulaQuantity: order.formulaQuantity || 1,
        ingredients: order.ingredients,
        menu: order.menu,
        products: order.products,
        dishes: order.dishes || [],
        cartProducts: order.cartProducts || [],
        bubbleTeas: order.bubbleTeas || [],
        milkshakes: order.milkshakes || [],
        user: user ? (user.data?._id || user._id) : null,
        pointsToRedeem: 0,
        source: 'online',
        paymentMethod: 'onsite',
        consumptionMode,
        scheduledFor,
      });
      hapticOrderSuccess();
      const created = response.data?.data || response.data;
      trackOrderValidated({
        _id: created?._id,
        totalPrice,
        ingredientsCount: order.ingredients?.length || 0,
        productsCount: order.products?.length || 0,
      });
      setConfirmedOrder(created);
      setSuccess(true);
      setTimeout(() => { resetOrder(); navigate('/'); }, 3000);
    } catch (err) {
      hapticError();
      const refus = err?.response?.status === 503 || err?.response?.status === 400;
      setError(refus && err?.response?.data?.message
        ? err.response.data.message
        : "Impossible d'enregistrer votre commande. Veuillez réessayer.");
      if (refus) reloadHours();
      console.error(err);
    } finally {
      setPayingOnSite(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-center animate-[fadeIn_0.5s_ease-out]">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        </div>
        <h1 className="text-3xl font-bold text-green-600 mb-2">Commande validée !</h1>
        {confirmedOrder?.orderNumber && (
          <p className="text-sm font-mono font-bold text-gray-500 mb-1">
            Commande {confirmedOrder.orderNumber}
          </p>
        )}
        <p className="text-gray-600 mb-1">
          {confirmedOrder?.scheduledFor
            ? `Retrait prévu à ${new Date(confirmedOrder.scheduledFor).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Guadeloupe' })}.`
            : 'Votre commande est en cours de préparation.'}
        </p>
        <p className="text-sm text-gray-400 mb-6">
          Une confirmation vous a été envoyée par {user ? 'email ou SMS' : 'SMS'}.
        </p>

        {/* Message de récompense */}
        {user && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-6 py-3 rounded-xl font-bold flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                {pointsToRedeem > 0 ? (
                    <span>−{discountAmount.toFixed(2)}€ déduits • +{Math.floor(finalPrice)} points gagnés !</span>
                ) : (
                    <span>+{Math.floor(finalPrice)} points de fidélité gagnés !</span>
                )}
            </div>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-2xl min-h-screen bg-gray-50 flex flex-col justify-center">
      {paymentStep === 'form' && (
        <button
          onClick={() => navigate(-1)}
          className="self-start mb-4 inline-flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-brand-600 transition-colors font-semibold"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Précédent
        </button>
      )}
      <h1 className="text-2xl sm:text-3xl font-bold text-center mb-6 gelasio">Récapitulatif de votre commande</h1>

      <div className="bg-white rounded-2xl shadow-xl p-4 sm:p-8 mb-6 border border-gray-100 relative overflow-hidden">
        {/* Effet décoratif ticket */}
        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-400 to-brand-600"></div>

        {/* Section Salade (conditionnelle) */}
        {hasSalade && (
          <div className="border-b-2 border-dashed border-gray-200 pb-6 mb-6">
            <div className="flex justify-between items-start mb-2">
              <h2 className="text-xl font-bold text-gray-900">
                {order.formula.name}
                {(order.formulaQuantity || 1) > 1 && <span className="ml-2 text-brand-600">×{order.formulaQuantity}</span>}
              </h2>
              <span className="font-mono font-bold">{order.formula.base_price.toFixed(2)}€</span>
            </div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Composition</p>
            <ul className="space-y-1 text-gray-600 text-sm">
              {order.ingredients.map(ing => (
                <li key={ing._id} className="flex justify-between">
                  <span>{ing.name}</span>
                  {ing.extra_price > 0 && <span className="text-xs bg-gray-100 px-1 rounded">+{ing.extra_price.toFixed(2)}€</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Section Plats Chauds (conditionnelle) */}
        {hasDishes && (
          <div className="border-b-2 border-dashed border-gray-200 pb-6 mb-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Plats Chauds</p>
            {order.dishes.map((dish, idx) => (
              <div key={idx} className="mb-3 last:mb-0">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">
                      {dish.name}
                      {(dish.quantity || 1) > 1 && <span className="ml-2 text-brand-600">×{dish.quantity}</span>}
                    </p>
                    {dish.selectedSides?.length > 0 && (
                      <ul className="text-sm text-stone-600 mt-1 space-y-0.5">
                        {dish.selectedSides.map((s, i) => (
                          <li key={i}>
                            + {s.name}
                            {s.priceAddition > 0 && <span className="text-stone-500"> (+{s.priceAddition.toFixed(2)} €)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {dish.menu?.name && dish.menu.name !== 'Solo' && dish.menu.name !== 'Sans Menu' && (
                      <p className="text-sm text-brand-600 mt-1 font-medium">
                        {dish.menu.name}{dish.menuProducts?.length ? ` : ${dish.menuProducts.map(p => p.name).join(', ')}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right ml-4 flex flex-col items-end gap-1">
                    <span className="font-mono font-bold">{(dish.subtotal * (dish.quantity || 1)).toFixed(2)}€</span>
                    <button
                      onClick={() => removeDishFromOrder(idx)}
                      className="text-xs text-stone-400 hover:text-cherry transition-colors"
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Section Bubble Teas (conditionnelle) */}
        {hasBubbleTeas && (
          <div className="border-b-2 border-dashed border-gray-200 pb-6 mb-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Bubble Teas</p>
            {bubbleTeas.map((bt, idx) => (
              <div key={idx} className="mb-3 last:mb-0">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">
                      {bt.name}
                      {(bt.quantity || 1) > 1 && <span className="ml-2 text-brand-600">×{bt.quantity}</span>}
                    </p>
                    {bt.selections?.length > 0 && (
                      <ul className="text-sm text-stone-600 mt-1 space-y-0.5">
                        {bt.selections.map((s, i) => (
                          <li key={i}>
                            <span className="text-stone-400">{s.category} :</span> {s.name}
                            {s.supplementPrice > 0 && <span className="text-stone-500"> (+{s.supplementPrice.toFixed(2)} €)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="text-right ml-4 flex flex-col items-end gap-1">
                    <span className="font-mono font-bold">{(bt.subtotal * (bt.quantity || 1)).toFixed(2)}€</span>
                    <button
                      onClick={() => removeBubbleTeaFromOrder(idx)}
                      className="text-xs text-stone-400 hover:text-cherry transition-colors"
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Section Milkshakes (conditionnelle) */}
        {hasMilkshakes && (
          <div className="border-b-2 border-dashed border-gray-200 pb-6 mb-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Milkshakes</p>
            {milkshakes.map((ms, idx) => (
              <div key={idx} className="mb-3 last:mb-0">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="font-bold text-gray-900">
                      {ms.name}
                      {(ms.quantity || 1) > 1 && <span className="ml-2 text-brand-600">×{ms.quantity}</span>}
                    </p>
                    {ms.selections?.length > 0 && (
                      <ul className="text-sm text-stone-600 mt-1 space-y-0.5">
                        {ms.selections.map((s, i) => (
                          <li key={i}>
                            <span className="text-stone-400">{s.category} :</span> {s.name}
                            {s.supplementPrice > 0 && <span className="text-stone-500"> (+{s.supplementPrice.toFixed(2)} €)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="text-right ml-4 flex flex-col items-end gap-1">
                    <span className="font-mono font-bold">{(ms.subtotal * (ms.quantity || 1)).toFixed(2)}€</span>
                    <button
                      onClick={() => removeMilkshakeFromOrder(idx)}
                      className="text-xs text-stone-400 hover:text-cherry transition-colors"
                    >
                      Retirer
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasSalade && order.menu && order.menu.name !== "Solo" && (
          <div className="border-b-2 border-dashed border-gray-200 pb-6 mb-6">
            <div className="flex justify-between items-start mb-2">
                <h2 className="text-xl font-bold text-gray-900">Menu {order.menu.name}</h2>
                <span className="font-mono font-bold">+{order.menu.price_addition.toFixed(2)}€</span>
            </div>
            {order.products.length > 0 && (
              <ul className="space-y-1 text-gray-600 text-sm">
                {order.products.map(p => (
                    <li key={p._id} className="flex justify-between">
                        <span>{p.name}</span>
                        {p.menu_surcharge > 0 && <span className="text-xs bg-gray-100 px-1 rounded">+{p.menu_surcharge.toFixed(2)}€</span>}
                    </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Section Produits à l'unité (conditionnelle) */}
        {hasCartProducts && (
          <div className="border-b-2 border-dashed border-gray-200 pb-6 mb-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Produits à l'unité</p>
            {cartProducts.map((p) => (
              <div key={p.lineId || p._id} className="flex justify-between items-center mb-3 last:mb-0">
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{p.name}</p>
                  {(p.selectedExtras || []).length > 0 && (
                    <p className="text-xs text-stone-500">+ {p.selectedExtras.map(e => e.name).join(', ')}</p>
                  )}
                  <p className="text-xs text-gray-500">{p.price.toFixed(2)}€ l'unité</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => decrementProductInCart(p.lineId)}
                      className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors"
                    >−</button>
                    <span className="font-mono font-bold w-6 text-center">{p.quantity}</span>
                    <button
                      onClick={() => incrementProductInCart(p.lineId)}
                      className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors"
                    >+</button>
                  </div>
                  <span className="font-mono font-bold w-16 text-right">{(p.price * p.quantity).toFixed(2)}€</span>
                  <button
                    onClick={() => removeProductFromCart(p.lineId)}
                    className="text-xs text-stone-400 hover:text-cherry transition-colors"
                  >Retirer</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between items-end pt-2">
          <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Total à payer</p>
          <div className="text-right">
            {pointsToRedeem > 0 && (
              <p className="text-sm text-gray-400 line-through">{totalPrice.toFixed(2)} €</p>
            )}
            <p className="text-3xl sm:text-4xl font-extrabold text-brand-600">{finalPrice.toFixed(2)} €</p>
          </div>
        </div>
      </div>

      {paymentStep === 'form' ? (
      <form onSubmit={handleSubmitOrder} className="bg-white rounded-2xl shadow-lg p-4 sm:p-8 border border-gray-100">
        <PickupSlotPicker
          offer={pickupOffer}
          closed={orderingClosed}
          selectedPickup={pickupAt}
          onSelectPickup={setPickupAt}
          message={closedNotice}
        />

        <label htmlFor="customerName" className="block text-sm font-bold text-gray-500 uppercase tracking-widest mb-3">
          Pour qui préparons-nous ceci ?
        </label>
        
        <input
          type="text"
          id="customerName"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all mb-4"
          placeholder="Votre Prénom"
          required
        />

        {/* Sans compte : le téléphone est le seul lien avec la commande — confirmation SMS
            et rattachement de la fidélité si ce numéro appartient déjà à un client. */}
        {!user && (
          <div className="mb-4">
            <label htmlFor="customerPhone" className="block text-sm font-bold text-gray-500 uppercase tracking-widest mb-3">
              Votre téléphone
            </label>
            <PhoneInput
              id="customerPhone"
              international
              defaultCountry="GP"
              value={customerPhone || undefined}
              onChange={(value) => setCustomerPhone(value || '')}
              placeholder="Numéro (tous pays)"
              className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold focus-within:ring-2 focus-within:ring-brand-500 focus-within:bg-white outline-none transition-all"
            />
            <p className="mt-2 text-xs text-gray-400">
              Pour recevoir la confirmation de votre commande par SMS.
            </p>
          </div>
        )}

        {/* Mode de consommation → pilote la ventilation TVA du ticket */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">Consommation</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            {[
              { key: 'dineIn',   label: 'Sur place' },
              { key: 'takeaway', label: 'À emporter' },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setConsumptionMode(key)}
                className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                  consumptionMode === key ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Bloc utilisation des points de fidélité */}
        {user && maxRedeemableTiers > 0 && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg"><Icon name="gift" /></span>
              <p className="font-bold text-amber-800 text-sm">
                {availablePoints} points disponibles → jusqu'à {maxRedeemableTiers}€ de réduction
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPointsToRedeem(p => Math.max(0, p - POINTS_PER_EURO))}
                disabled={pointsToRedeem === 0}
                className="w-9 h-9 rounded-full bg-amber-200 text-amber-900 font-bold text-lg flex items-center justify-center hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >−</button>
              <span className="font-mono font-bold text-amber-900 min-w-[110px] text-center text-sm">
                {pointsToRedeem} pts = {discountAmount.toFixed(2)}€
              </span>
              <button
                type="button"
                onClick={() => setPointsToRedeem(p => Math.min(maxRedeemableTiers * POINTS_PER_EURO, p + POINTS_PER_EURO))}
                disabled={pointsToRedeem >= maxRedeemableTiers * POINTS_PER_EURO}
                className="w-9 h-9 rounded-full bg-amber-200 text-amber-900 font-bold text-lg flex items-center justify-center hover:bg-amber-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >+</button>
            </div>
            {pointsToRedeem > 0 && (
              <p className="mt-2 text-sm text-amber-700">
                Total : {totalPrice.toFixed(2)}€ → <span className="font-bold text-emerald-700">{finalPrice.toFixed(2)}€</span> (−{discountAmount.toFixed(2)}€)
              </p>
            )}
          </div>
        )}

        {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm font-bold mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
            </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !CARD_PAYMENT_ENABLED || !canOrder}
          className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-brand-600 transition-all duration-300 transform hover:-translate-y-1 shadow-xl shadow-gray-200 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none flex justify-center items-center gap-2"
        >
          {isLoading ? (
             <>
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                <span>Validation...</span>
             </>
          ) : (
             <>
                <span>{isReservation ? 'Payer et réserver ce créneau' : 'Valider et payer par carte'}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
             </>
          )}
        </button>
        {!CARD_PAYMENT_ENABLED && (
          <p className="mt-2 text-center text-xs text-gray-400">
            Paiement en ligne par carte bientôt disponible
          </p>
        )}

        {/* Séparateur */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">ou</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Bouton Payer sur place — crée la commande sans paiement en ligne */}
        <button
          type="button"
          onClick={handlePayOnSite}
          disabled={payingOnSite || isLoading || !canOrder}
          className="w-full bg-brand-600 text-white font-bold py-4 rounded-xl hover:bg-brand-700 transition-all duration-300 shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed flex justify-center items-center gap-2"
        >
          {payingOnSite ? (
            <>
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
              <span>Envoi en cuisine...</span>
            </>
          ) : (
            <>
              <Icon name="store" />
              <span>{isReservation ? 'Réserver et payer sur place' : 'Valider et payer sur place'}</span>
            </>
          )}
        </button>
        {/* Ne rien promettre quand rien ne peut partir : sans créneau retenu, annoncer une
            heure de retrait contredirait le bandeau juste au-dessus. */}
        {canOrder && (
          <p className="mt-2 text-center text-xs text-gray-400">
            Votre commande sera prête {isReservation ? `${pickupOffer.weekdayName} ` : ''}
            à {pickupLabel}. Vous réglerez à la caisse.
          </p>
        )}

        {pickupOffer && !scheduledFor && (
          <p className="mt-3 text-center text-sm font-semibold text-amber-700">
            Choisissez une heure de retrait ci-dessus pour valider votre commande.
          </p>
        )}

        {/* Bouton Annuler — abandon avant validation */}
        <button
          type="button"
          onClick={() => setShowCancelModal(true)}
          className="mt-3 w-full px-6 py-3 text-cherry border-2 border-cherry rounded-xl hover:bg-cherry hover:text-white transition-colors font-semibold"
        >
          Annuler ma commande
        </button>
      </form>
      ) : (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <StripeCheckoutForm
            orderData={pendingOrderData}
            finalPrice={finalPrice}
            pointsToRedeem={pointsToRedeem}
            onSuccess={(created) => {
              setConfirmedOrder(created);
              setSuccess(true);
              setTimeout(() => { resetOrder(); navigate('/'); }, 3000);
            }}
            onBack={() => setPaymentStep('form')}
            updateUserLoyalty={updateUserLoyalty}
            trackOrderValidated={trackOrderValidated}
            trackOrderCancelled={trackOrderCancelled}
          />
        </Elements>
      )}

      {/* Modal de confirmation d'abandon */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-brand-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-2xl gelasio text-wood mb-3">Confirmer l'abandon ?</h3>
            <p className="text-wood/70 mb-6">
              Votre panier sera vidé et vous reviendrez à l'accueil. Vous ne pourrez pas récupérer cette commande.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 text-wood hover:bg-wood/10 rounded transition-colors"
              >
                Non, je continue
              </button>
              <button
                onClick={() => {
                  trackOrderCancelled('abandoned_at_summary');
                  resetOrder();
                  navigate('/');
                }}
                className="px-4 py-2 bg-cherry text-white rounded-xl hover:bg-cherry/90 transition-colors font-bold"
              >
                Oui, abandonner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Summary;