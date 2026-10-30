// frontend/src/hooks/useActivityTracker.js
import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { socket } from '../socket';

/**
 * @function getSessionId
 * @description Génère ou récupère un ID de session unique pour le tracking
 * @returns {String} Session ID unique
 */
const getSessionId = () => {
  let sessionId = sessionStorage.getItem('sessionId');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('sessionId', sessionId);
  }
  return sessionId;
};

/**
 * @function getDeviceInfo
 * @description Détecte les informations sur l'appareil et le navigateur
 * @returns {Object} Informations sur l'appareil
 */
const getDeviceInfo = () => {
  const ua = navigator.userAgent;
  return {
    userAgent: ua,
    deviceType: /mobile/i.test(ua) ? 'mobile' : /tablet/i.test(ua) ? 'tablet' : 'desktop',
    browser: getBrowser(ua),
    os: getOS(ua),
    screenResolution: `${window.screen.width}x${window.screen.height}`
  };
};

const getBrowser = (ua) => {
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  return 'Other';
};

const getOS = (ua) => {
  if (ua.includes('Win')) return 'Windows';
  if (ua.includes('Mac')) return 'MacOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Other';
};

/**
 * @hook useActivityTracker
 * @description Hook React pour tracker l'activité utilisateur en temps réel
 * @returns {Object} Fonctions de tracking
 */
export const useActivityTracker = () => {
  const { user } = useAuth();
  const sessionId = useRef(getSessionId());
  // Posées au montage (voir l'effet « page_view ») : les initialiser ici appelait
  // Date.now() à chaque rendu pour une valeur aussitôt écrasée.
  const pageStartTime = useRef(0);
  const heartbeatIntervalRef = useRef(null);
  const lastActivityTime = useRef(0);
  const navigationHistory = useRef([]);
  
  // Connexion Socket.io désactivée pour Ngrok - Utilisation exclusive de l'API REST
  /*
  useEffect(() => {
    socketRef.current = io(import.meta.env.VITE_API_URL, { transports: ['websocket', 'polling'], withCredentials: true });
    
    socketRef.current.on('connect', () => {
      console.log('[Tracking] Connecté');
    });
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);
  */
  
  /**
   * @function track
   * @description Fonction générique de tracking d'événements
   * @param {String} eventType - Type d'événement
   * @param {Object} eventData - Données de l'événement
   */
  const track = useCallback((eventType, eventData = {}) => {
    const activity = {
      user: user?._id || null,
      sessionId: sessionId.current,
      eventType,
      eventData,
      page: {
        path: window.location.pathname,
        title: document.title,
        referrer: document.referrer
      },
      device: getDeviceInfo(),
      timestamp: new Date()
    };
    
    socket.emit('track_activity', activity);
  }, [user]);
  
  // Tracking automatique des vues de page
  useEffect(() => {
    pageStartTime.current = Date.now();
    lastActivityTime.current = Date.now();
    track('page_view');
    
    // Ajouter à l'historique de navigation
    navigationHistory.current.push({
      path: window.location.pathname,
      timestamp: new Date(),
      title: document.title
    });
    
    // Limiter l'historique à 20 entrées
    if (navigationHistory.current.length > 20) {
      navigationHistory.current = navigationHistory.current.slice(-20);
    }
    
    return () => {
      const duration = Date.now() - pageStartTime.current;
      track('page_leave', { duration });
    };
  }, [track]);
  
  /* Système de Heartbeat - indique que l'utilisateur est toujours actif.
     Battement porté de 60 s à 5 min : à une minute il produisait 25 525 documents
     (12,5 % de la collection) pour répondre à « y a-t-il quelqu'un ? », question qui
     ne se pose pas à la minute près. Le seuil d'inactivité vaut lui aussi 5 min,
     donc un onglet resté ouvert sans personne devant cesse d'émettre après un
     battement au lieu de cinq. */
  useEffect(() => {
    heartbeatIntervalRef.current = setInterval(() => {
      const timeSinceLastActivity = Date.now() - lastActivityTime.current;
      const timeOnPage = Date.now() - pageStartTime.current;
      
      // Ne tracker le heartbeat que si l'utilisateur est actif (moins de 5 minutes d'inactivité)
      if (timeSinceLastActivity < 5 * 60000) {
        track('user_active', {
          page: window.location.pathname,
          timeOnPage,
          timeSinceLastActivity,
          scrollPosition: window.scrollY,
          windowSize: `${window.innerWidth}x${window.innerHeight}`,
          navigationHistoryLength: navigationHistory.current.length
        });
      }
    }, 5 * 60000);
    
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [track]);
  
  /* La profondeur de défilement n'est plus enregistrée : 95 604 documents (46,8 % de
     toute la collection activityLogs) qu'aucun écran ni aucun calcul ne lisait. Le
     seuil se comparait à la dernière position et non au maximum atteint, si bien
     qu'un aller-retour sur une page réécrivait une vingtaine de fois la même
     information. Si la question se repose un jour, enregistrer une seule ligne par
     visite avec le maximum atteint. Le défilement reste écouté plus bas, comme
     simple signe de vie (voir handleActivity) : sans lui, un visiteur qui lit à la
     molette était compté inactif au bout de cinq minutes. */

  // Tracking des clics (clics significatifs seulement)
  useEffect(() => {
    const handleClick = (event) => {
      /* L'ancien test se terminait par `text.length > 2`, ce qui rendait significatif
         tout élément portant plus de deux caractères : 60 463 documents enregistrés,
         soit près d'un tiers de la collection, pour une carte de chaleur noyée dans
         le bruit. Il regardait aussi `event.target` seul, si bien qu'un clic sur le
         libellé d'un bouton était vu comme un clic sur un <span>.

         On remonte désormais au plus proche élément réellement actionnable. Le
         sélecteur inclut [role="button"] : les div rendues cliquables par clickable()
         (utils/a11y.js) en portent un, et sans cela la plupart des vrais boutons du
         projet passeraient à la trappe. */
      const el = event.target.closest?.(
        'button, a, [role="button"], input[type="submit"], [class*="btn"], [class*="card"]'
      );
      if (!el) return;

      // className : chaîne sur un élément HTML, SVGAnimatedString sur un SVG.
      const className = typeof el.className === 'string'
        ? el.className
        : el.className?.baseVal || '';

      track('click_event', {
        element: el.tagName.toLowerCase(),
        className: className.substring(0, 100),
        id: el.id || 'none',
        text: (el.textContent?.trim() || '').substring(0, 50),
        position: {
          x: event.clientX,
          y: event.clientY,
          pageX: event.pageX,
          pageY: event.pageY
        }
      });
      lastActivityTime.current = Date.now();
    };
    
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [track]);
  
  // Tracking de l'inactivité et fermeture de page
  useEffect(() => {
    const handleActivity = () => {
      lastActivityTime.current = Date.now();
    };
    
    // Réagir aux événements d'activité
    window.addEventListener('mousemove', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });
    // Défiler à la molette ne déclenche ni mousemove ni touchstart : sans cette
    // ligne, un visiteur qui se contente de lire passerait pour inactif.
    window.addEventListener('scroll', handleActivity, { passive: true });
    
    // Tracking de la fermeture de page
    const handleBeforeUnload = () => {
      const duration = Date.now() - pageStartTime.current;
      track('user_inactive', { 
        reason: 'page_closed',
        sessionDuration: duration,
        navigationCount: navigationHistory.current.length
      });
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [track]);
  
  // Fonction de tracking de navigation
  const trackNavigation = useCallback((from, to) => {
    track('navigation', {
      from: {
        path: from?.path || window.location.pathname,
        title: from?.title || document.title
      },
      to: {
        path: to?.path || window.location.pathname,
        title: to?.title || document.title
      },
      duration: Date.now() - pageStartTime.current
    });
    pageStartTime.current = Date.now();
  }, [track]);
  
  // Tracking du temps sur la tâche (pour le configurateur)
  const trackTaskTime = useCallback((taskName, duration, details = {}) => {
    track('task_completed', {
      taskName,
      duration,
      ...details
    });
  }, [track]);
  
  // Tracking d'erreur
  const trackError = useCallback((errorType, errorMessage, context = {}) => {
    track('error_occurred', {
      errorType,
      errorMessage: errorMessage.substring(0, 200),
      ...context
    });
  }, [track]);
  
  // Méthodes spécifiques pour le configurateur
  const trackFormulaSelection = useCallback((formula) => {
    track('formula_selected', { 
      formulaId: formula._id,
      formulaName: formula.name,
      formulaPrice: formula.price
    });
  }, [track]);
  
  const trackIngredientAdded = useCallback((ingredient) => {
    track('ingredient_added', {
      ingredientId: ingredient._id,
      ingredientName: ingredient.name,
      category: ingredient.category,
      price: ingredient.price
    });
  }, [track]);
  
  const trackIngredientRemoved = useCallback((ingredient) => {
    track('ingredient_removed', {
      ingredientId: ingredient._id,
      ingredientName: ingredient.name
    });
  }, [track]);
  
  const trackIngredientPreview = useCallback((ingredient) => {
    track('ingredient_preview', {
      ingredientId: ingredient._id,
      ingredientName: ingredient.name,
      category: ingredient.category
    });
  }, [track]);
  
  const trackMenuSelected = useCallback((menu) => {
    track('menu_selected', {
      menuId: menu._id,
      menuName: menu.name,
      menuPrice: menu.price_addition
    });
  }, [track]);
  
  const trackProductAdded = useCallback((product) => {
    track('product_added', {
      productId: product._id,
      productName: product.name,
      productPrice: product.price
    });
  }, [track]);
  
  const trackProductRemoved = useCallback((product) => {
    track('product_removed', {
      productId: product._id,
      productName: product.name
    });
  }, [track]);
  
  const trackOrderStarted = useCallback((orderData) => {
    track('order_started', {
      totalPrice: orderData.totalPrice,
      ingredientsCount: orderData.ingredients?.length || 0,
      productsCount: orderData.products?.length || 0
    });
  }, [track]);
  
  const trackOrderValidated = useCallback((order) => {
    track('order_validated', {
      orderId: order._id,
      orderNumber: order.orderNumber || null,
      totalPrice: order.totalPrice,
      ingredientsCount: order.ingredients?.length || 0,
      productsCount: order.products?.length || 0
    });
  }, [track]);
  
  const trackOrderCancelled = useCallback((reason = '') => {
    track('order_cancelled', { reason });
  }, [track]);
  
  const trackAIInteraction = useCallback((action, data) => {
    const eventType = action === 'opened' ? 'ai_chat_opened' : 
                      action === 'suggestion_applied' ? 'ai_suggestion_applied' : 
                      `ai_${action}`;
    track(eventType, data);
  }, [track]);
  
  const trackSearch = useCallback((query, results) => {
    track('search_performed', {
      query,
      resultsCount: results?.length || 0
    });
  }, [track]);
  
  const trackFilterApplied = useCallback((filterType, filterValue) => {
    track('filter_applied', {
      filterType,
      filterValue
    });
  }, [track]);
  
  return {
    track,
    trackNavigation,
    trackTaskTime,
    trackError,
    trackFormulaSelection,
    trackIngredientAdded,
    trackIngredientRemoved,
    trackIngredientPreview,
    trackMenuSelected,
    trackProductAdded,
    trackProductRemoved,
    trackOrderStarted,
    trackOrderValidated,
    trackOrderCancelled,
    trackAIInteraction,
    trackSearch,
    trackFilterApplied
  };
};
