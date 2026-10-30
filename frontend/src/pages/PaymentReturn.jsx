// src/pages/PaymentReturn.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { useConfig } from '../context/ConfigContext';
import { useAuth } from '../context/AuthContext';
import { createOrder } from '../services/api';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { hapticOrderSuccess, hapticError } from '../utils/haptic';
import { loadPendingOrder, clearPendingOrder } from '../utils/pendingOrder';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

/**
 * @description Retour d'une authentification 3-D Secure ayant imposé une redirection
 * pleine page vers la banque. Stripe renvoie ici avec `payment_intent_client_secret` :
 * on relit le statut réel du paiement, puis on crée la commande mise de côté avant la
 * redirection. Sans cette page, un client authentifié par redirection serait débité
 * sans qu'aucune commande ne soit enregistrée.
 */
const PaymentReturn = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { resetOrder } = useConfig();
  const { updateUserLoyalty } = useAuth();
  const { trackOrderValidated, trackOrderCancelled } = useActivityTracker();

  const [state, setState] = useState('loading'); // loading | success | processing | failed | orphan
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const handled = useRef(false); // StrictMode monte le composant deux fois en dev

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const clientSecret = params.get('payment_intent_client_secret');
    if (!clientSecret) {
      navigate('/', { replace: true });
      return;
    }

    (async () => {
      const stripe = await stripePromise;
      if (!stripe) {
        setState('failed');
        setMessage("Le service de paiement est momentanément indisponible.");
        return;
      }

      const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);
      if (error || !paymentIntent) {
        setState('failed');
        setMessage("Nous n'avons pas pu vérifier l'état de votre paiement.");
        return;
      }
      setReference(paymentIntent.id);

      if (paymentIntent.status === 'processing') {
        setState('processing');
        return;
      }

      if (paymentIntent.status !== 'succeeded') {
        clearPendingOrder();
        hapticError();
        trackOrderCancelled('payment_failed_after_redirect');
        setState('failed');
        setMessage("L'authentification auprès de votre banque n'a pas abouti. Aucun montant n'a été débité.");
        return;
      }

      const pending = loadPendingOrder();
      if (!pending?.orderData) {
        setState('orphan');
        setMessage("Votre paiement est bien confirmé, mais nous n'avons pas retrouvé le détail de votre panier sur cet appareil.");
        return;
      }

      try {
        const response = await createOrder({ ...pending.orderData, paymentIntentId: paymentIntent.id });
        clearPendingOrder();
        hapticOrderSuccess();
        updateUserLoyalty(Math.floor(pending.finalPrice || 0) - (pending.pointsToRedeem || 0));
        const created = response.data?.data || response.data;
        trackOrderValidated({
          _id: created?._id,
          totalPrice: pending.orderData.totalPrice,
          ingredientsCount: pending.orderData.ingredients?.length || 0,
          productsCount: pending.orderData.products?.length || 0,
        });
        resetOrder();
        setState('success');
      } catch (err) {
        // 409 : ce PaymentIntent a déjà servi (double retour, rafraîchissement de la page).
        // La commande existe déjà côté serveur — c'est un succès, pas une erreur.
        if (err.response?.status === 409) {
          clearPendingOrder();
          resetOrder();
          setState('success');
          return;
        }
        hapticError();
        trackOrderCancelled('error_after_payment');
        setState('orphan');
        setMessage("Votre paiement est confirmé, mais l'enregistrement de votre commande a échoué.");
      }
    })();
  }, []);

  return (
    <div className="container mx-auto p-4 max-w-lg min-h-screen flex flex-col items-center justify-center text-center">
      {state === 'loading' && (
        <>
          <div className="animate-spin h-12 w-12 border-4 border-brand-600 border-t-transparent rounded-full mb-6" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Vérification de votre paiement…</h1>
          <p className="text-gray-500">Merci de ne pas fermer cette page.</p>
        </>
      )}

      {state === 'processing' && (
        <>
          <div className="animate-spin h-12 w-12 border-4 border-brand-600 border-t-transparent rounded-full mb-6" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Paiement en cours de traitement</h1>
          <p className="text-gray-600 mb-6">
            Votre banque n'a pas encore rendu sa réponse définitive. Rafraîchissez cette page dans quelques instants
            pour connaître le résultat.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-700 transition-colors"
          >
            Actualiser
          </button>
        </>
      )}

      {state === 'success' && (
        <>
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-green-600 mb-2">Commande validée !</h1>
          <p className="text-gray-600 mb-8">Votre paiement est confirmé, votre commande est en cours de préparation.</p>
          <Link
            to="/"
            className="bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-700 transition-colors"
          >
            Retour à l'accueil
          </Link>
        </>
      )}

      {state === 'orphan' && (
        <>
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Paiement confirmé</h1>
          <p className="text-gray-600 mb-4">{message}</p>
          <p className="text-gray-600 mb-6">
            Présentez la référence ci-dessous au comptoir, votre commande sera préparée immédiatement.
          </p>
          {reference && (
            <code className="block bg-gray-100 text-gray-800 font-mono text-sm px-4 py-3 rounded-lg mb-6 break-all">
              {reference}
            </code>
          )}
          <Link
            to="/"
            className="bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-700 transition-colors"
          >
            Retour à l'accueil
          </Link>
        </>
      )}

      {state === 'failed' && (
        <>
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Paiement non abouti</h1>
          <p className="text-gray-600 mb-8">{message}</p>
          <Link
            to="/summary"
            className="bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-700 transition-colors"
          >
            Revenir à ma commande
          </Link>
        </>
      )}
    </div>
  );
};

export default PaymentReturn;
