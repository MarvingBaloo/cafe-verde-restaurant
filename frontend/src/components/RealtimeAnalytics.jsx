// frontend/src/components/RealtimeAnalytics.jsx
import React, { useState, useEffect } from 'react';
import { socket } from '../socket';
import { fetchRealtimeStats } from '../services/api';
import Icon from './Icon';

/**
 * @component RealtimeAnalytics
 * @description Composant dashboard pour visualiser les statistiques en temps réel
 * Utilisé dans la page SuperAdmin pour le monitoring de l'activité utilisateur
 * @author BMG Consulting
 */
const RealtimeAnalytics = () => {
  const [stats, setStats] = useState(null);
  const [timeRange, setTimeRange] = useState('24h');
  const [activeUsers, setActiveUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  
  // Connexion Socket.io pour recevoir les mises à jour en temps réel
  useEffect(() => {
    socket.emit('join_superadmin');

    const onConnect = () => console.log('[Analytics] Dashboard connecté en temps réel');
    const onNewActivity = (activity) => {
      console.log('[Analytics] Nouvelle activité détectée:', activity.eventType);
      setLastUpdate(new Date());
      loadStats();
    };

    socket.on('connect', onConnect);
    socket.on('new_activity', onNewActivity);

    return () => {
      socket.off('connect', onConnect);
      socket.off('new_activity', onNewActivity);
    };
  }, []);
  
  // Chargement initial et rafraîchissement périodique
  useEffect(() => {
    loadStats();
    // Rafraîchir toutes les 30 secondes
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [timeRange]);
  
  const loadStats = async () => {
    try {
      setLoading(true);
      const response = await fetchRealtimeStats(timeRange);
      setStats(response.data);
      setActiveUsers(response.data.activeUsers || []);
    } catch (error) {
      console.error('Erreur chargement stats en temps réel:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center p-10">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Chargement des analytics...</p>
        </div>
      </div>
    );
  }
  
  if (!stats) return null;
  
  return (
    <div className="space-y-6">
      {/* En-tête avec filtres de temps */}
      <div className="bg-white p-4 rounded-xl shadow-md border border-gray-100">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Analytics en Temps Réel
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Dernière mise à jour: {lastUpdate.toLocaleTimeString('fr-FR')}
            </p>
          </div>
          <div className="flex gap-2">
            {[
              { value: '1h', label: '1 heure' },
              { value: '24h', label: '24 heures' },
              { value: '7d', label: '7 jours' },
              { value: '30d', label: '30 jours' }
            ].map(range => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  timeRange === range.value 
                    ? 'bg-purple-600 text-white shadow-md' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Utilisateurs actifs en temps réel */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-2xl shadow-md border-2 border-green-200">
        <h3 className="text-xl font-bold text-green-800 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
          Utilisateurs Actifs Maintenant
          <span className="ml-2 bg-green-600 text-white px-3 py-1 rounded-full text-sm font-bold">
            {activeUsers.length}
          </span>
        </h3>
        
        {activeUsers.length === 0 ? (
          <p className="text-green-700 text-center py-4">Aucun utilisateur actif pour le moment</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeUsers.map((user, index) => (
              <div key={user.sessionId} className="bg-white p-4 rounded-lg shadow-sm border border-green-100">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    {user.deviceType === 'mobile' || user.deviceType === 'tablet' ? (
                      <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    )}
                    <div>
                      <p className="font-bold text-gray-800 text-sm">
                        Session #{index + 1}
                      </p>
                      <p className="text-xs text-gray-500">
                        {user.sessionId.slice(-8)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                    {user.pageCount} pages
                  </span>
                </div>
                <p className="text-sm text-gray-700 font-medium truncate flex items-center gap-1">
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {user.currentPage || 'Page inconnue'}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Actif il y a {Math.floor((Date.now() - new Date(user.lastActivity)) / 1000)}s
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Funnel de conversion */}
      <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          Funnel de Conversion
        </h3>
        <div className="space-y-4">
          {stats.conversionFunnel?.map((step, index) => (
            <div key={index} className="relative">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm">
                    {index + 1}
                  </span>
                  <span className="font-semibold text-gray-800">{step.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 font-medium">
                    {step.count} utilisateurs
                  </span>
                  <span className={`text-lg font-bold ${
                    step.conversionRate >= 80 ? 'text-green-600' :
                    step.conversionRate >= 50 ? 'text-orange-600' :
                    'text-red-600'
                  }`}>
                    {step.conversionRate}%
                  </span>
                </div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
                <div 
                  className={`h-6 rounded-full transition-all duration-700 flex items-center justify-end px-3 ${
                    step.conversionRate >= 80 ? 'bg-gradient-to-r from-green-400 to-green-600' :
                    step.conversionRate >= 50 ? 'bg-gradient-to-r from-orange-400 to-orange-600' :
                    'bg-gradient-to-r from-red-400 to-red-600'
                  }`}
                  style={{ width: `${step.conversionRate}%` }}
                >
                  {step.conversionRate > 10 && (
                    <span className="text-white text-xs font-bold">
                      {step.conversionRate}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Grille 2 colonnes : Pages populaires + Appareils */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pages populaires */}
        <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
            </svg>
            Pages les Plus Visitées
          </h3>
          {stats.popularPages?.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-3">
              {stats.popularPages?.slice(0, 5).map((page, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-gray-800 flex-1 truncate">
                      {page.page}
                    </span>
                    <span className="ml-2 bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold">
                      {page.views} vues
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      {page.uniqueUsers} utilisateurs
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {Math.round((page.avgDuration || 0) / 1000)}s moyen
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Répartition par appareil */}
        <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Répartition par Appareil
          </h3>
          {stats.deviceBreakdown?.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Aucune donnée disponible</p>
          ) : (
            <div className="space-y-4">
              {stats.deviceBreakdown?.map((device, i) => {
                const total = stats.deviceBreakdown.reduce((sum, d) => sum + d.count, 0);
                const percentage = total > 0 ? ((device.count / total) * 100).toFixed(1) : 0;
                
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-800 flex items-center gap-2">
                        {device.deviceType === 'mobile' || device.deviceType === 'tablet' ? (
                          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        )}
                        <span className="capitalize">{device.deviceType || 'Inconnu'}</span>
                      </span>
                      <span className="text-sm font-bold text-gray-600">
                        {device.count} ({percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-4">
                      <div 
                        className="bg-gradient-to-r from-blue-400 to-blue-600 h-4 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      
      {/* Taux d'abandon */}
      <div className="bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-200 p-6 rounded-2xl shadow-md">
        <h3 className="text-xl font-bold text-red-700 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Analyse d'Abandon de Panier
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Commandes démarrées</p>
            <p className="text-3xl font-bold text-gray-800">{stats.abandonmentRate?.started || 0}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Commandes validées</p>
            <p className="text-3xl font-bold text-green-600">{stats.abandonmentRate?.validated || 0}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Abandonnées</p>
            <p className="text-3xl font-bold text-red-600">{stats.abandonmentRate?.abandoned || 0}</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <p className="text-sm text-gray-600 mb-1">Taux d'abandon</p>
            <p className={`text-3xl font-bold ${
              (stats.abandonmentRate?.abandonmentRate || 0) > 50 ? 'text-red-600' : 
              (stats.abandonmentRate?.abandonmentRate || 0) > 30 ? 'text-orange-600' : 
              'text-green-600'
            }`}>
              {stats.abandonmentRate?.abandonmentRate || 0}%
            </p>
          </div>
        </div>
      </div>
      
      {/* Interactions avec les ingrédients */}
      <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Icon name="salad" /> Analyse des Ingrédients
          <span className="text-sm text-gray-500 font-normal">
            (Intérêt des clients)
          </span>
        </h3>
        {stats.ingredientInteractions?.length === 0 ? (
          <p className="text-gray-500 text-center py-4">Aucune interaction enregistrée</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 font-bold text-gray-700">Ingrédient</th>
                  <th className="text-center py-3 px-4 font-bold text-gray-700">
                    <span className="flex items-center justify-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      Vus
                    </span>
                  </th>
                  <th className="text-center py-3 px-4 font-bold text-gray-700">
                    <span className="flex items-center justify-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Ajoutés
                    </span>
                  </th>
                  <th className="text-center py-3 px-4 font-bold text-gray-700">
                    <span className="flex items-center justify-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Retirés
                    </span>
                  </th>
                  <th className="text-center py-3 px-4 font-bold text-gray-700">Taux d'intérêt</th>
                </tr>
              </thead>
              <tbody>
                {stats.ingredientInteractions?.slice(0, 10).map((ing, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-800">{ing.ingredient}</td>
                    <td className="text-center py-3 px-4 text-blue-600 font-medium">{ing.previewed}</td>
                    <td className="text-center py-3 px-4 text-green-600 font-medium">{ing.added}</td>
                    <td className="text-center py-3 px-4 text-red-600 font-medium">{ing.removed}</td>
                    <td className="text-center py-3 px-4">
                      <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${
                        ing.interestRate >= 70 ? 'bg-green-100 text-green-700' :
                        ing.interestRate >= 40 ? 'bg-orange-100 text-orange-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {ing.interestRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default RealtimeAnalytics;
