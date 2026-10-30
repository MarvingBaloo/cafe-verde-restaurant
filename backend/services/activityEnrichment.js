// backend/services/activityEnrichment.js
// Enrichissement d'une activité brute (Firestore) vers le payload affiché par
// le feed "Activité Live". Partagé entre le broadcast Socket.io (track_activity)
// et l'endpoint d'historique (GET /api/analytics/activities) pour garantir un
// rendu identique en live et en relecture.

const { findById } = require('../models/User');

/** Libellé d'une commande dans le feed, aligné sur orderLabel (receiptRenderer / orderTicket). */
const orderEventLabel = (eventData) =>
  eventData.orderNumber ||
  (eventData.orderId ? `#${String(eventData.orderId).slice(-4).toUpperCase()}` : 'N/A');

/**
 * Récupère les informations complètes d'un utilisateur.
 */
const getUserInfo = async (userId) => {
  try {
    if (!userId) return null;

    const user = await findById(userId);

    if (!user) return {
      id: userId,
      role: 'unknown',
      displayRole: 'Utilisateur inconnu',
      icon: '❓',
      color: 'gray'
    };

    const formatRole = (role) => {
      switch (role) {
        case 'superadmin': return 'Super Admin';
        case 'admin': return 'Admin';
        case 'client': return 'Client';
        case 'dev': return 'Développeur';
        default: return role;
      }
    };

    const getRoleIcon = (role) => {
      switch (role) {
        case 'superadmin': return '👑';
        case 'admin': return '👨‍🍳';
        case 'client': return '👤';
        case 'dev': return '🛠️';
        default: return '❓';
      }
    };

    const getRoleColor = (role) => {
      switch (role) {
        case 'superadmin': return 'purple';
        case 'admin': return 'blue';
        case 'client': return 'green';
        case 'dev': return 'slate';
        default: return 'gray';
      }
    };

    return {
      id: userId,
      name: user.name,
      email: user.email,
      role: user.role,
      loyaltyPoints: user.loyaltyPoints || 0,
      displayName: user.name,
      displayRole: formatRole(user.role),
      icon: getRoleIcon(user.role),
      color: getRoleColor(user.role),
      colorClass: getRoleColor(user.role)
    };
  } catch (error) {
    console.error('❌ Erreur récupération infos utilisateur:', error);
    return {
      id: userId,
      role: 'error',
      displayRole: 'Erreur',
      icon: '❌',
      color: 'red'
    };
  }
};

/**
 * Formate les détails d'un événement pour l'affichage user-friendly.
 */
const formatEventDetails = (eventType, eventData) => {
  if (!eventData || Object.keys(eventData).length === 0) return null;

  switch (eventType) {
    case 'ingredient_added':
      return {
        title: 'Ingrédient ajouté',
        description: `${eventData.ingredientName || 'Ingrédient'} - ${(eventData.price || 0).toFixed(2)}€`,
        icon: '➕',
        details: [
          { label: 'Catégorie', value: eventData.category || 'Non spécifiée' },
          { label: 'ID', value: eventData.ingredientId ? `#${eventData.ingredientId.slice(-6)}` : 'N/A' }
        ]
      };

    case 'ingredient_removed':
      return {
        title: 'Ingrédient retiré',
        description: eventData.ingredientName || 'Ingrédient',
        icon: '➖',
        details: [
          { label: 'ID', value: eventData.ingredientId ? `#${eventData.ingredientId.slice(-6)}` : 'N/A' }
        ]
      };

    case 'formula_selected':
      return {
        title: 'Formule sélectionnée',
        description: `${eventData.formulaName || 'Formule'} - ${(eventData.formulaPrice || 0).toFixed(2)}€`,
        icon: '📋',
        details: [
          { label: 'Type', value: 'Formule' },
          { label: 'Prix', value: `${(eventData.formulaPrice || 0).toFixed(2)}€` },
          { label: 'ID', value: eventData.formulaId ? `#${eventData.formulaId.slice(-6)}` : 'N/A' }
        ]
      };

    case 'order_started':
      return {
        title: 'Commande démarrée',
        description: `Total estimé: ${(eventData.totalPrice || 0).toFixed(2)}€`,
        icon: '🛒',
        details: [
          { label: 'Ingrédients', value: eventData.ingredientsCount || 0 },
          { label: 'Produits', value: eventData.productsCount || 0 }
        ]
      };

    case 'order_validated':
      // Même libellé que partout ailleurs (cf. orderLabel) : numéro séquentiel si l'événement
      // le porte, sinon repli sur les 4 derniers caractères de l'id — jamais 6.
      return {
        title: 'Commande validée',
        description: `Commande ${orderEventLabel(eventData)} - ${(eventData.totalPrice || 0).toFixed(2)}€`,
        icon: '✅',
        details: [
          { label: 'ID Commande', value: eventData.orderId ? `#${eventData.orderId.slice(-8)}` : 'N/A' },
          { label: 'Total', value: `${(eventData.totalPrice || 0).toFixed(2)}€` }
        ]
      };

    case 'order_cancelled':
      return {
        title: 'Commande annulée',
        description: eventData.reason ? `Raison: ${eventData.reason}` : 'Aucune raison spécifiée',
        icon: '❌',
        details: []
      };

    case 'page_view':
      return {
        title: 'Visite de page',
        description: eventData.pageTitle || 'Page visitée',
        icon: '👁️',
        details: [
          { label: 'Chemin', value: eventData.pagePath || 'N/A' }
        ]
      };

    default:
      return {
        title: 'Activité',
        description: eventType,
        icon: '📝',
        details: Object.entries(eventData).map(([key, value]) => ({
          label: key,
          value: typeof value === 'object' ? JSON.stringify(value) : String(value)
        }))
      };
  }
};

const getActivityIcon = (eventType) => {
  const icons = {
    'page_view': '👁️',
    'page_leave': '🚪',
    'formula_selected': '📋',
    'ingredient_added': '➕',
    'ingredient_removed': '➖',
    'ingredient_preview': '👀',
    'menu_selected': '🍽️',
    'product_added': '🛍️',
    'product_removed': '🗑️',
    'order_started': '🛒',
    'order_validated': '✅',
    'order_cancelled': '❌',
    'ai_chat_opened': '🤖',
    'search_performed': '🔍',
    'filter_applied': '⚙️'
  };
  return icons[eventType] || '📝';
};

const getActivityColor = (eventType) => {
  if (eventType.includes('added') || eventType.includes('validated')) return 'green';
  if (eventType.includes('removed') || eventType.includes('cancelled')) return 'red';
  if (eventType.includes('selected') || eventType.includes('started')) return 'blue';
  return 'gray';
};

const getActivityDisplayText = (activity, userInfo) => {
  const sessionShort = activity.sessionId?.slice(-8) || 'inconnu';
  const pageName = activity.page?.path?.split('/').pop() || 'page inconnue';

  if (userInfo) {
    const userPrefix = `${userInfo.icon} ${userInfo.displayRole}: ${userInfo.name}`;

    switch (activity.eventType) {
      case 'page_view':
        return `${userPrefix} a visité ${pageName}`;
      case 'ingredient_added':
        return `${userPrefix} a ajouté ${activity.eventData?.ingredientName || 'un ingrédient'}`;
      case 'ingredient_removed':
        return `${userPrefix} a retiré ${activity.eventData?.ingredientName || 'un ingrédient'}`;
      case 'formula_selected':
        return `${userPrefix} a sélectionné ${activity.eventData?.formulaName || 'une formule'}`;
      case 'order_started':
        return `${userPrefix} a démarré une commande`;
      case 'order_validated':
        return `${userPrefix} a validé une commande`;
      case 'order_cancelled':
        return `${userPrefix} a annulé une commande`;
      default:
        return `${userPrefix} - ${activity.eventType}`;
    }
  } else {
    switch (activity.eventType) {
      case 'page_view':
        return `👤 ${sessionShort} a visité ${pageName}`;
      case 'ingredient_added':
        return `➕ ${sessionShort} a ajouté ${activity.eventData?.ingredientName || 'un ingrédient'}`;
      case 'ingredient_removed':
        return `➖ ${sessionShort} a retiré ${activity.eventData?.ingredientName || 'un ingrédient'}`;
      case 'formula_selected':
        return `📋 ${sessionShort} a sélectionné ${activity.eventData?.formulaName || 'une formule'}`;
      case 'order_started':
        return `🛒 ${sessionShort} a démarré une commande`;
      case 'order_validated':
        return `✅ ${sessionShort} a validé une commande`;
      case 'order_cancelled':
        return `❌ ${sessionShort} a annulé une commande`;
      default:
        return `📝 ${sessionShort} - ${activity.eventType}`;
    }
  }
};

/**
 * Transforme une activité brute (doc Firestore ou payload track_activity) en
 * objet enrichi prêt pour le feed live.
 *
 * @param {Object} activity - activité avec au moins { eventType, sessionId, user, page, eventData, device, timestamp }
 * @param {Object} [userInfo] - infos utilisateur déjà résolues (optionnel, évite un lookup ; utilisé par l'historique avec cache)
 */
const enrichActivity = async (activity, userInfo) => {
  const enrichedUser = userInfo !== undefined
    ? userInfo
    : (activity.user ? await getUserInfo(activity.user) : null);

  return {
    id: activity._id?.toString() || activity.id?.toString() || Date.now().toString(),
    eventType: activity.eventType,
    sessionId: activity.sessionId,
    user: activity.user,
    enrichedUser,
    page: activity.page,
    eventData: activity.eventData,
    formattedDetails: formatEventDetails(activity.eventType, activity.eventData),
    device: activity.device,
    timestamp: activity.timestamp,
    displayText: getActivityDisplayText(activity, enrichedUser),
    icon: getActivityIcon(activity.eventType),
    color: getActivityColor(activity.eventType),
    rawActivity: activity
  };
};

module.exports = {
  getUserInfo,
  formatEventDetails,
  getActivityIcon,
  getActivityColor,
  getActivityDisplayText,
  enrichActivity
};
