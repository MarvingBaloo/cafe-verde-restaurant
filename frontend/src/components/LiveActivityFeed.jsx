// frontend/src/components/LiveActivityFeed.jsx
import React, { useState, useEffect } from 'react';
import { socket } from '../socket';
import { fetchRecentActivities } from '../services/api';
import Icon from './Icon';

// Met une activité (live ou historique) à la forme attendue par le rendu du feed.
const formatActivity = (activity) => ({
  ...activity,
  id: activity.id || activity._id || Date.now().toString(),
  time: new Date(activity.timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }),
  date: new Date(activity.timestamp).toLocaleDateString('fr-FR'),
  display: activity.displayText || `Activité: ${activity.eventType}`
});

/**
 * @component LiveActivityFeed
 * @description Composant pour afficher un flux d'activités utilisateur en temps réel
 * Affiche les événements au fur et à mesure qu'ils se produisent sur le site
 * @author BMG Consulting
 */
const LiveActivityFeed = () => {
  const [activities, setActivities] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all', 'page_view', 'ingredient_added', etc.
  // État initial lu directement sur le socket : le poser depuis l'effet déclenchait
  // un second rendu immédiat quand la connexion existait déjà au montage.
  const [connectionStatus, setConnectionStatus] = useState(() => (socket?.connected ? 'connected' : 'connecting'));
  const [activeUsers, setActiveUsers] = useState({});
  // Horloge d'affichage : lire Date.now() pendant le rendu rendait celui-ci non
  // déterministe. En prime, les « il y a X min » se rafraîchissent maintenant seuls.
  const [now, setNow] = useState(() => Date.now());

  // Connexion Socket.io pour recevoir les activités en temps réel
  useEffect(() => {
    if (!socket) return;

    // Rejoindre la room super admin
    socket.emit('join_superadmin');

    // Handlers nommés pour pouvoir les retirer proprement
    const handleConnect = () => {
      console.log('[LiveFeed] Connecté au serveur temps réel');
      setConnectionStatus('connected');
      socket.emit('join_superadmin');
    };

    const handleDisconnect = () => {
      console.log('[LiveFeed] Déconnecté du serveur temps réel');
      setConnectionStatus('disconnected');
    };

    const handleConnectError = (error) => {
      console.error('[LiveFeed] Erreur connexion:', error);
      setConnectionStatus('error');
    };

    const handleNewActivity = (activity) => {
      console.log('[LiveFeed] Nouvelle activité reçue:', activity.eventType, activity.displayText);

      const newActivity = formatActivity(activity);

      setActivities(prev => [newActivity, ...prev].slice(0, 100));

      setActiveUsers(prev => ({
        ...prev,
        [activity.sessionId]: {
          ...activity,
          lastSeen: new Date(),
          activityCount: (prev[activity.sessionId]?.activityCount || 0) + 1,
          displayName: `Session ${activity.sessionId?.slice(-8) || 'inconnue'}`
        }
      }));
    };

    socket.on('connect',       handleConnect);
    socket.on('disconnect',    handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('new_activity',  handleNewActivity);

    // Nettoyer les utilisateurs inactifs (> 5 minutes)
    const cleanupInterval = setInterval(() => {
      setNow(Date.now());
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60000);
      setActiveUsers(prev =>
        Object.fromEntries(
          Object.entries(prev).filter(([, user]) =>
            new Date(user.lastSeen) > fiveMinutesAgo
          )
        )
      );
    }, 60000);

    return () => {
      // Retirer uniquement les listeners — NE PAS appeler socket.disconnect()
      socket.off('connect',       handleConnect);
      socket.off('disconnect',    handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('new_activity',  handleNewActivity);
      clearInterval(cleanupInterval);
    };
  }, []);

  // Charger l'historique correspondant au filtre (le serveur filtre par eventType
  // AVANT de couper à 100, sinon les events rares sont noyés par le bruit
  // scroll/clic). Recharge à chaque changement de filtre ; le live s'empile par-dessus.
  useEffect(() => {
    let cancelled = false;
    fetchRecentActivities({ limit: 100, eventType: filter })
      .then(res => {
        if (cancelled) return;
        const history = (res.data || []).map(formatActivity);
        setActivities(history);
      })
      .catch(err => console.error('[LiveFeed] Échec chargement historique:', err));
    return () => { cancelled = true; };
  }, [filter]);

  // Filtrer les activités selon le filtre sélectionné
  const filteredActivities = filter === 'all' 
    ? activities 
    : activities.filter(activity => activity.eventType === filter);
  
  // Statistiques
  const totalActivities = activities.length;
  const uniqueSessions = Object.keys(activeUsers).length;
  const activitiesLast5Min = activities.filter(a => 
    new Date(a.timestamp) > new Date(now - 5 * 60000)
  ).length;
  
  // Types d'événements disponibles pour le filtre
  const eventTypes = [
    { value: 'all', label: 'Toutes les activités', icon: 'chart' },
    { value: 'page_view', label: 'Visites de pages', icon: 'eye' },
    { value: 'ingredient_added', label: 'Ingrédients ajoutés', icon: 'add' },
    { value: 'ingredient_removed', label: 'Ingrédients retirés', icon: 'minus' },
    { value: 'formula_selected', label: 'Formules sélectionnées', icon: 'clipboard' },
    { value: 'order_started', label: 'Commandes démarrées', icon: 'products' },
    { value: 'order_validated', label: 'Commandes validées', icon: 'check' },
    { value: 'order_cancelled', label: 'Commandes annulées', icon: 'cancel' },
    { value: 'ai_chat_opened', label: 'Chat IA ouvert', icon: 'ai' }
  ];
  
  // Fonction pour obtenir la couleur CSS selon le type d'événement
  const getEventColorClass = (color) => {
    switch(color) {
      case 'green': return 'border-l-green-500 bg-green-50';
      case 'red': return 'border-l-red-500 bg-red-50';
      case 'blue': return 'border-l-blue-500 bg-blue-50';
      case 'yellow': return 'border-l-yellow-500 bg-yellow-50';
      default: return 'border-l-gray-500 bg-gray-50';
    }
  };
  
  // Fonction pour formater l'affichage utilisateur
  const formatUserDisplay = (activity) => {
    if (activity.enrichedUser) {
      const { enrichedUser } = activity;
      const colorMap = {
        'purple': 'border-l-purple-500 bg-purple-50',
        'blue': 'border-l-blue-500 bg-blue-50',
        'green': 'border-l-green-500 bg-green-50',
        'gray': 'border-l-gray-500 bg-gray-50',
        'red': 'border-l-red-500 bg-red-50'
      };
      const colorClass = colorMap[enrichedUser.color] || 'border-l-gray-500 bg-gray-50';
      
      return {
        display: `${enrichedUser.icon} ${enrichedUser.displayRole}: ${enrichedUser.name}`,
        email: enrichedUser.email,
        role: enrichedUser.role,
        colorClass: colorClass,
        isAuthenticated: true,
        loyaltyPoints: enrichedUser.loyaltyPoints || 0
      };
    } else {
      return {
        display: 'Visiteur anonyme',
        email: null,
        role: 'visitor',
        colorClass: 'border-l-gray-500 bg-gray-50',
        isAuthenticated: false,
        loyaltyPoints: 0
      };
    }
  };
  
  // Fonction pour afficher les détails formatés
  const renderFormattedDetails = (activity) => {
    if (!activity.formattedDetails) return null;
    
    const { title, description, icon, details } = activity.formattedDetails;
    
    return (
      <div className="mt-3 pt-3 border-t border-gray-200">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <p className="font-bold text-gray-800 text-sm">{title}</p>
            <p className="text-sm text-gray-600">{description}</p>
          </div>
        </div>
        
        {details.length > 0 && (
          <div className="bg-gray-50 p-3 rounded-lg">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {details.map((detail, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-xs text-gray-500 font-medium whitespace-nowrap">{detail.label}:</span>
                  <span className="text-xs text-gray-700 flex-1">{detail.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };
  
  // Fonction pour afficher les détails JSON (fallback)
  const renderJSONDetails = (activity) => {
    if (!activity.eventData || Object.keys(activity.eventData).length === 0) return null;
    
    return (
      <div className="mt-3 pt-3 border-t border-gray-200">
        <p className="text-xs text-gray-600 font-medium mb-1">Données brutes:</p>
        <div className="bg-gray-50 p-3 rounded-lg">
          <pre className="text-xs text-gray-700 overflow-x-auto">
            {JSON.stringify(activity.eventData, null, 2)}
          </pre>
        </div>
      </div>
    );
  };
  
  // Fonction pour afficher les informations utilisateur
  const renderUserInfo = (activity) => {
    const userInfo = formatUserDisplay(activity);
    
    return (
      <div className="mt-3 text-xs text-gray-500 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
            </svg>
            Session: {activity.sessionId?.slice(-8)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${
              userInfo.role === 'superadmin' ? 'bg-purple-500' :
              userInfo.role === 'admin' ? 'bg-blue-500' :
              userInfo.role === 'client' ? 'bg-green-500' :
              'bg-gray-500'
            }`}></span>
            <span className={userInfo.isAuthenticated ? 'font-medium' : 'text-gray-400'}>
              {userInfo.display}
            </span>
            {userInfo.email && (
              <span className="text-gray-400 text-xs">({userInfo.email})</span>
            )}
          </div>
        </div>
      </div>
    );
  };
  
  return (
    <div className="space-y-6">
      {/* En-tête avec statistiques */}
      <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${
                connectionStatus === 'connected' ? 'bg-green-500 animate-pulse' :
                connectionStatus === 'connecting' ? 'bg-yellow-500' :
                'bg-red-500'
              }`}></span>
              Activité Live en Temps Réel
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              Surveillez ce que font vos utilisateurs en ce moment même
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            <div className="bg-gray-100 px-4 py-2 rounded-lg">
              <p className="text-xs text-gray-500">Utilisateurs actifs</p>
              <p className="text-xl font-bold text-gray-800">{uniqueSessions}</p>
            </div>
            <div className="bg-blue-100 px-4 py-2 rounded-lg">
              <p className="text-xs text-blue-600">Activités (5min)</p>
              <p className="text-xl font-bold text-blue-700">{activitiesLast5Min}</p>
            </div>
            <div className="bg-purple-100 px-4 py-2 rounded-lg">
              <p className="text-xs text-purple-600">Total activités</p>
              <p className="text-xl font-bold text-purple-700">{totalActivities}</p>
            </div>
          </div>
        </div>
        
        {/* Barre de statut de connexion */}
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm">
            <span className={`px-2 py-1 rounded text-white text-xs font-bold ${
              connectionStatus === 'connected' ? 'bg-green-600' :
              connectionStatus === 'connecting' ? 'bg-yellow-600' :
              'bg-red-600'
            }`}>
              {connectionStatus === 'connected' ? 'CONNECTÉ' :
               connectionStatus === 'connecting' ? 'CONNEXION...' :
               'DÉCONNECTÉ'}
            </span>
            <span className="text-gray-600">
              {connectionStatus === 'connected' ? 'Recevoir les activités en temps réel' :
               connectionStatus === 'connecting' ? 'Connexion au serveur...' :
               'Impossible de se connecter au serveur temps réel'}
            </span>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filtres à gauche */}
        <div className="lg:col-span-1">
          <div className="bg-white p-5 rounded-2xl shadow-md border border-gray-100 sticky top-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filtres
            </h3>
            
            <div className="space-y-2">
              {eventTypes.map(eventType => (
                <button
                  key={eventType.value}
                  onClick={() => setFilter(eventType.value)}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-all flex items-center gap-3 ${
                    filter === eventType.value
                      ? 'bg-purple-100 text-purple-700 font-bold border border-purple-300'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-lg"><Icon name={eventType.icon} /></span>
                  <span className="flex-1">{eventType.label}</span>
                  {filter === eventType.value && (
                    <span className="w-2 h-2 bg-purple-600 rounded-full"></span>
                  )}
                </button>
              ))}
            </div>
            
            {/* Utilisateurs actifs */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Utilisateurs Actifs ({uniqueSessions})
              </h4>
              {uniqueSessions === 0 ? (
                <p className="text-gray-500 text-sm text-center py-3">Aucun utilisateur actif</p>
              ) : (
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {Object.entries(activeUsers).map(([sessionId, user]) => {
                    const minutesAgo = Math.floor((now - new Date(user.lastSeen)) / 60000);
                    return (
                      <div key={sessionId} className="bg-gray-50 p-3 rounded-lg">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-gray-800 text-sm">
                            {user.displayName}
                          </span>
                          <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                            {user.activityCount} actions
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {user.page?.path || 'Page inconnue'}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Vu il y a {minutesAgo === 0 ? '<1 min' : `${minutesAgo} min`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Flux d'activités à droite */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">
            {/* En-tête du flux */}
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900">
                  Flux d'Activités en Direct
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setActivities([])}
                    className="text-sm bg-white border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Effacer tout
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="text-sm bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Actualiser
                  </button>
                </div>
              </div>
              <p className="text-gray-600 text-sm mt-1">
                Les activités apparaissent ici au fur et à mesure qu'elles se produisent
              </p>
            </div>
            
            {/* Liste des activités */}
            <div className="h-[600px] overflow-y-auto p-2">
              {filteredActivities.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 p-10">
                  <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-xl font-medium">Aucune activité à afficher</p>
                  <p className="text-sm mt-2">
                    {filter === 'all' 
                      ? "Les activités des utilisateurs apparaîtront ici en temps réel"
                      : `Aucune activité de type "${filter}" pour le moment`}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredActivities.map((activity) => (
                    <div
                      key={activity.id}
                      className={`p-4 rounded-xl border-l-4 ${getEventColorClass(activity.color)} border border-gray-200 transition-all hover:shadow-md animate-fadeIn`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl text-gray-400"><Icon name="note" /></span>
                          <div>
                            <p className="font-bold text-gray-800">{activity.display}</p>
                            <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                              <span className="flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {activity.time}
                              </span>
                              <span className="flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                {activity.page?.path || 'Page inconnue'}
                              </span>
                              {activity.device?.deviceType && (
                                <span className="flex items-center gap-1">
                                  <Icon name={activity.device.deviceType === 'mobile' ? 'mobile' : activity.device.deviceType === 'tablet' ? 'tablet' : 'desktop'} />
                                  {activity.device.deviceType}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full font-medium">
                          {activity.eventType}
                        </span>
                      </div>
                      
                      {/* Détails formatés ou JSON (fallback) */}
                      {renderFormattedDetails(activity) || renderJSONDetails(activity)}
                      
                      {/* Informations utilisateur enrichies */}
                      {renderUserInfo(activity)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Pied de page */}
            <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-600">
                Affichage de {filteredActivities.length} activité(s) • 
                Dernière mise à jour: {new Date().toLocaleTimeString('fr-FR')} • 
                <button 
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="ml-2 text-purple-600 hover:text-purple-800 font-medium"
                >
                  Remonter ↑
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveActivityFeed;