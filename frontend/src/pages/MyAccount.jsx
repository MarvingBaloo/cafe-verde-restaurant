// frontend/src/pages/MyAccount.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { fetchOrdersByUser, updateProfile, exportOwnData } from '../services/api';
import Icon from '../components/Icon';
import Ticket from '../components/Ticket';
import PrintArea from '../components/PrintArea';
import SendReceiptModal from '../components/modals/SendReceiptModal';
import InvoiceModal from '../components/modals/InvoiceModal';
import { clickable } from '../utils/a11y';
import { POINTS_PER_EURO, pointsToEuros } from '../utils/loyalty';
import { socket } from '../socket';
import { orderLabel } from '../utils/orderTicket';

/**
 * @description Page "Mon Compte" (Dashboard Client)
 * Profil, fidélité, historique de commandes, édition du profil,
 * export et suppression du compte (RGPD).
 */
const MyAccount = () => {
  const { user, logout, applyUserUpdate, deleteAccount, hasPassword, linkEmailPassword, changePassword } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modales
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // Ticket : impression locale + envoi email/SMS
  const [printData, setPrintData] = useState(null);
  const [receiptModal, setReceiptModal] = useState(null); // { order, channel }
  const [invoiceTarget, setInvoiceTarget] = useState(null);

  // Édition profil
  const [editName, setEditName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Sécurité & connexion (mot de passe / liaison email)
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [securityMsg, setSecurityMsg] = useState('');
  const [securitySuccess, setSecuritySuccess] = useState('');

  const getUserProperty = (prop) => user?.data?.[prop] || user?.[prop];

  // Redirection si non connecté
  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  // Chargement des commandes
  useEffect(() => {
    const loadOrders = async () => {
      const userId = getUserProperty('_id');
      if (!user || !userId) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const response = await fetchOrdersByUser(userId);
        const rawData = response.data?.data || response.data;
        setOrders(Array.isArray(rawData) ? rawData : []);
      } catch {
        setError('Impossible de charger vos commandes. Veuillez réessayer.');
      } finally {
        setLoading(false);
      }
    };
    loadOrders();
  }, [user]);

  // Suivi temps réel : la cuisine fait avancer la commande dans le KDS → reflété ici en direct.
  useEffect(() => {
    const myId = getUserProperty('_id');
    if (!myId) return;

    const upsert = (incoming) => {
      if (!incoming || incoming.user !== myId) return;
      setOrders(prev => {
        const list = Array.isArray(prev) ? prev : [];
        return list.some(o => o._id === incoming._id)
          ? list.map(o => (o._id === incoming._id ? { ...o, ...incoming } : o))
          : [incoming, ...list];
      });
    };
    const onOrderUpdated = (order) => upsert(order);
    const onNewOrder = (order) => upsert(order);
    const onOrderCancelled = ({ order }) => upsert(order);

    socket.on('order_updated', onOrderUpdated);
    socket.on('new_order', onNewOrder);
    socket.on('order:cancelled', onOrderCancelled);
    return () => {
      socket.off('order_updated', onOrderUpdated);
      socket.off('new_order', onNewOrder);
      socket.off('order:cancelled', onOrderCancelled);
    };
  }, [user]);

  const safeOrders = Array.isArray(orders) ? orders : [];
  const currentOrders = safeOrders.filter(o => o && ['pending', 'preparing', 'ready'].includes(o.status));
  const pastOrders    = safeOrders.filter(o => o && ['delivered', 'cancelled'].includes(o.status));
  const visiblePast   = showAllHistory ? pastOrders : pastOrders.slice(0, 10);

  // Gère les Timestamps Firestore (SDK, sérialisé _seconds/seconds), Date ou string ISO
  const toJsDate = (val) => {
    if (!val) return null;
    if (typeof val.toDate === 'function') return val.toDate();
    if (val._seconds != null) return new Date(val._seconds * 1000);
    if (val.seconds != null) return new Date(val.seconds * 1000);
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const formatDate = (dateValue) => {
    const d = toJsDate(dateValue);
    if (!d) return '—';
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const statusLabels = {
    pending: 'En attente', preparing: 'En préparation', ready: 'Prête',
    delivered: 'Livrée', cancelled: 'Annulée',
  };
  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800', preparing: 'bg-blue-100 text-blue-800',
    ready: 'bg-green-100 text-green-800', delivered: 'bg-gray-100 text-gray-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  // Identité / rôle
  const role = getUserProperty('role');
  const roleLabel = role === 'superadmin' ? 'Super Admin' : role === 'admin' ? 'Administrateur' : 'Client';
  const roleColor = (role === 'admin' || role === 'superadmin') ? 'bg-purple-100 text-purple-800' : 'bg-brand-100 text-brand-800';
  const contactInfo = getUserProperty('email') || getUserProperty('phone') || '—';

  // --- Actions ---

  const openEdit = () => {
    setEditName(getUserProperty('name') || '');
    setProfileMsg('');
    setEditOpen(true);
  };

  const handleSaveProfile = async () => {
    if (!editName.trim()) { setProfileMsg('Le nom est requis.'); return; }
    setSavingProfile(true);
    setProfileMsg('');
    try {
      const res = await updateProfile({ name: editName.trim() });
      const updated = res.data?.data || res.data;
      applyUserUpdate({ name: updated.name });
      setEditOpen(false);
    } catch (err) {
      setProfileMsg(err.response?.data?.message || 'Erreur lors de la mise à jour.');
    } finally {
      setSavingProfile(false);
    }
  };

  const openSecurity = () => {
    setCurPwd(''); setNewPwd(''); setConfirmPwd(''); setLinkEmail('');
    setSecurityMsg(''); setSecuritySuccess('');
    setSecurityOpen(true);
  };

  const handleSecuritySubmit = async () => {
    setSecurityMsg(''); setSecuritySuccess('');
    if (newPwd.length < 6) { setSecurityMsg('Le mot de passe doit contenir au moins 6 caractères.'); return; }
    if (newPwd !== confirmPwd) { setSecurityMsg('Les mots de passe ne correspondent pas.'); return; }

    let result;
    if (hasPassword) {
      if (!curPwd) { setSecurityMsg('Saisissez votre mot de passe actuel.'); return; }
      setSavingSecurity(true);
      result = await changePassword(curPwd, newPwd);
    } else {
      if (!linkEmail.trim()) { setSecurityMsg('Saisissez votre adresse email.'); return; }
      setSavingSecurity(true);
      result = await linkEmailPassword(linkEmail, newPwd);
    }
    setSavingSecurity(false);

    if (result.success) {
      setSecuritySuccess(hasPassword
        ? 'Mot de passe mis à jour.'
        : 'Email et mot de passe créés. Vous pouvez désormais vous connecter avec votre email.');
      setCurPwd(''); setNewPwd(''); setConfirmPwd('');
      setTimeout(() => setSecurityOpen(false), 1800);
    } else {
      setSecurityMsg(result.message);
    }
  };

  const handleExport = async () => {
    try {
      const res = await exportOwnData();
      const data = res.data?.data || res.data;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mes-donnees-cafe-verde_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Impossible d\'exporter vos données.');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    const result = await deleteAccount();
    setDeleting(false);
    if (result.success) {
      navigate('/');
    } else {
      setProfileMsg(result.message);
      setDeleteOpen(false);
    }
  };

  // --- Ticket : impression & envoi ---

  const handlePrint = (order) => setPrintData(orderToTicket(order));

  // Déclenche l'impression dès que le ticket est prêt, puis nettoie après impression.
  useEffect(() => {
    if (!printData) return;
    const t = setTimeout(() => window.print(), 60);
    const after = () => setPrintData(null);
    window.addEventListener('afterprint', after);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, [printData]);

  const openReceiptModal = (order, channel) => setReceiptModal({ order, channel });

  if (!user) return null;

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 selection:bg-brand-200 selection:text-brand-900 pt-8 pb-24">
      {/* Hero */}
      <section className="container mx-auto px-4 py-12 text-center">
        <motion.h1
          initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="text-5xl md:text-6xl gelasio font-bold text-gray-900 mb-6">
          Mon <span className="text-brand-600">Compte</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}
          className="text-xl text-gray-600 max-w-3xl mx-auto mb-10">
          Gérez vos informations, suivez vos commandes et découvrez vos avantages fidélité.
        </motion.p>
      </section>

      <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Colonne gauche */}
        <div className="lg:col-span-1 space-y-8">
          {/* Profil */}
          <motion.div
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.5 }}
            className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-brand-600 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                {getUserProperty('name')?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0">
                <h3 className="text-2xl gelasio font-bold text-gray-900 truncate">{getUserProperty('name')}</h3>
                <p className="text-gray-500 truncate">{contactInfo}</p>
                <div className="mt-2 text-sm text-gray-400">
                  Membre depuis {new Date(getUserProperty('createdAt') || Date.now()).toLocaleDateString('fr-FR')}
                </div>
              </div>
            </div>
            <div className="pt-6 border-t border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-700 font-bold">Statut</span>
                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${roleColor}`}>
                  {roleLabel}
                </span>
              </div>
              <button
                onClick={openEdit}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-900 text-white font-bold hover:bg-brand-600 transition-colors">
                <Icon name="edit" /> Modifier mon profil
              </button>
            </div>
          </motion.div>

          {/* Sécurité & connexion */}
          <motion.div
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35, duration: 0.5 }}
            className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
            <h3 className="text-xl gelasio font-bold text-gray-900 mb-2 flex items-center gap-2">
              <Icon name="lock" className="text-brand-600" /> Sécurité &amp; connexion
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {hasPassword
                ? 'Modifiez le mot de passe de votre compte.'
                : 'Ajoutez une adresse email et un mot de passe pour vous connecter sans code SMS.'}
            </p>
            <button
              onClick={openSecurity}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 transition-colors">
              <Icon name={hasPassword ? 'lock' : 'mail'} />
              {hasPassword ? 'Modifier mon mot de passe' : 'Créer un mot de passe'}
            </button>
          </motion.div>

          {/* Fidélité */}
          <motion.div
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4, duration: 0.5 }}
            className="bg-gradient-to-br from-brand-500 to-emerald-600 rounded-2xl shadow-xl p-6 text-white">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-2xl gelasio font-bold">Vos points fidélité</h3>
              <Icon name="crown" className="text-2xl" />
            </div>
            {(() => {
              const pts = getUserProperty('loyaltyPoints') || 0;
              const availableEuros = Math.floor(pointsToEuros(pts));
              const remainder = pts % POINTS_PER_EURO;
              return (
                <>
                  <div className="text-center mb-4">
                    <div className="text-5xl font-bold mb-1">{pts}</div>
                    <div className="text-brand-100">points accumulés</div>
                    {availableEuros > 0 && (
                      <div className="mt-2 inline-flex items-center gap-1.5 bg-white/20 rounded-lg px-3 py-1 text-sm font-bold">
                        <Icon name="gift" /> {availableEuros}€ de réduction disponible{availableEuros > 1 ? 's' : ''} !
                      </div>
                    )}
                  </div>
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span>Vers le prochain euro</span>
                      <span>{remainder} / {POINTS_PER_EURO} points</span>
                    </div>
                    <div className="h-3 bg-white/30 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }} animate={{ width: `${(remainder / POINTS_PER_EURO) * 100}%` }}
                        transition={{ delay: 0.6, duration: 1, ease: 'easeOut' }}
                        className="h-full bg-white rounded-full" />
                    </div>
                  </div>
                  <p className="text-sm text-brand-100">
                    <Icon name="info" className="inline mr-1" />
                    {availableEuros === 0
                      ? `Plus que ${POINTS_PER_EURO - remainder} pts pour débloquer 1€ de réduction !`
                      : `1€ dépensé = 1 point • ${POINTS_PER_EURO} points = 1€ de réduction`}
                  </p>
                </>
              );
            })()}
          </motion.div>

          {/* Actions rapides */}
          <motion.div
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5, duration: 0.5 }}
            className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
            <h3 className="text-xl gelasio font-bold text-gray-900 mb-4">Actions rapides</h3>
            <div className="space-y-3">
              <button onClick={() => navigate('/products')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-brand-50 text-gray-800 hover:text-brand-600 transition-colors group">
                <span className="font-medium">Nouvelle commande</span>
                <Icon name="arrow-right" className="group-hover:translate-x-1 transition-transform" />
              </button>
              <button onClick={() => navigate('/')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-brand-50 text-gray-800 hover:text-brand-600 transition-colors group">
                <span className="font-medium">Revenir à l'accueil</span>
                <Icon name="home" className="group-hover:scale-110 transition-transform" />
              </button>
              <button onClick={handleLogout}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 text-gray-800 transition-colors group">
                <span className="font-medium">Se déconnecter</span>
                <Icon name="arrow-right" className="text-gray-400" />
              </button>
            </div>
          </motion.div>

        </div>

        {/* Colonne droite : Commandes */}
        <div className="lg:col-span-2 space-y-8">
          {/* En cours */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }}
            className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl gelasio font-bold text-gray-900 flex items-center gap-3">
                <Icon name="preparation" className="text-brand-600" /> Commandes en cours
              </h2>
              <span className="px-3 py-1 bg-brand-100 text-brand-800 rounded-full font-bold text-sm">
                {currentOrders.length} commande{currentOrders.length !== 1 ? 's' : ''}
              </span>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
                <p className="mt-4 text-gray-500">Chargement de vos commandes...</p>
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <Icon name="warning" className="text-4xl text-red-500 mx-auto mb-3" />
                <p className="text-red-600">{error}</p>
              </div>
            ) : currentOrders.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-2xl">
                <Icon name="history" className="text-4xl text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">Vous n'avez aucune commande en cours.</p>
                <button onClick={() => navigate('/products')}
                  className="mt-4 px-6 py-2 bg-brand-600 text-white rounded-full font-bold hover:bg-brand-700 transition-colors">
                  Commander maintenant
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {currentOrders.map((order) => (
                  <OrderCard key={order._id} order={order} onClick={() => setSelectedOrder(order)}
                    statusColors={statusColors} statusLabels={statusLabels} formatDate={formatDate}
                    onPrint={handlePrint} onEmail={(o) => openReceiptModal(o, 'email')} onSms={(o) => openReceiptModal(o, 'sms')}
                    onInvoice={setInvoiceTarget} />
                ))}
              </div>
            )}
          </motion.div>

          {/* Historique */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }}
            className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl gelasio font-bold text-gray-900 flex items-center gap-3">
                <Icon name="history" className="text-brand-600" /> Historique des commandes
              </h2>
              <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full font-bold text-sm">
                {pastOrders.length} commande{pastOrders.length !== 1 ? 's' : ''}
              </span>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
                <p className="mt-4 text-gray-500">Chargement de l'historique...</p>
              </div>
            ) : pastOrders.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-2xl">
                <Icon name="history" className="text-4xl text-gray-400 mx-auto mb-3" />
                <p className="text-gray-500">Votre historique de commandes est vide.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {visiblePast.map((order) => (
                  <OrderCard key={order._id} order={order} onClick={() => setSelectedOrder(order)}
                    statusColors={statusColors} statusLabels={statusLabels} formatDate={formatDate} past
                    onPrint={handlePrint} onEmail={(o) => openReceiptModal(o, 'email')} onSms={(o) => openReceiptModal(o, 'sms')}
                    onInvoice={setInvoiceTarget} />
                ))}
                {pastOrders.length > 10 && (
                  <div className="text-center pt-4">
                    <button onClick={() => setShowAllHistory(v => !v)}
                      className="text-brand-600 hover:text-brand-800 font-bold">
                      {showAllHistory ? 'Réduire' : `Voir tout l'historique (${pastOrders.length - 10} de plus)`}
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {/* Liens RGPD discrets (obligation légale, volontairement peu visibles) */}
      <div className="container mx-auto px-4 mt-20">
        <div className="border-t border-gray-100 pt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-300">
          <button onClick={handleExport} className="hover:text-gray-400 transition-colors">
            Exporter mes données
          </button>
          <span className="text-gray-200">·</span>
          <button onClick={() => setDeleteOpen(true)} className="hover:text-gray-400 transition-colors">
            Supprimer mon compte
          </button>
        </div>
        {profileMsg && !editOpen && (
          <p className="text-xs text-red-500 text-center mt-2">{profileMsg}</p>
        )}
      </div>

      {/* MODALE ÉDITION PROFIL */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-2xl gelasio font-bold text-gray-900 mb-4">Modifier mon profil</h3>
            <label className="block text-sm font-bold text-gray-500 mb-1">Nom</label>
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-2 focus:ring-2 focus:ring-brand-400 outline-none" />
            {profileMsg && <p className="text-sm text-red-600 mb-2">{profileMsg}</p>}
            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => setEditOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Annuler</button>
              <button onClick={handleSaveProfile} disabled={savingProfile}
                className="px-5 py-2 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-colors disabled:opacity-50">
                {savingProfile ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE SÉCURITÉ & CONNEXION */}
      {securityOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-2xl gelasio font-bold text-gray-900 mb-2">
              {hasPassword ? 'Modifier mon mot de passe' : 'Créer un mot de passe'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {hasPassword
                ? 'Saisissez votre mot de passe actuel puis le nouveau.'
                : 'Votre email vous servira de second moyen de connexion, en plus du SMS.'}
            </p>

            {!hasPassword && (
              <>
                <label className="block text-sm font-bold text-gray-500 mb-1">Adresse email</label>
                <input type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                  placeholder="votre@email.com" autoComplete="email"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-4 focus:ring-2 focus:ring-brand-400 outline-none" />
              </>
            )}

            {hasPassword && (
              <>
                <label className="block text-sm font-bold text-gray-500 mb-1">Mot de passe actuel</label>
                <input type="password" value={curPwd} onChange={e => setCurPwd(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-4 focus:ring-2 focus:ring-brand-400 outline-none" />
              </>
            )}

            <label className="block text-sm font-bold text-gray-500 mb-1">Nouveau mot de passe</label>
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
              autoComplete="new-password"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-4 focus:ring-2 focus:ring-brand-400 outline-none" />

            <label className="block text-sm font-bold text-gray-500 mb-1">Confirmer le mot de passe</label>
            <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
              autoComplete="new-password"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-2 focus:ring-2 focus:ring-brand-400 outline-none" />

            {securityMsg && <p className="text-sm text-red-600 mb-2">{securityMsg}</p>}
            {securitySuccess && <p className="text-sm text-brand-600 mb-2">{securitySuccess}</p>}

            <div className="flex gap-3 justify-end mt-4">
              <button onClick={() => setSecurityOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Annuler</button>
              <button onClick={handleSecuritySubmit} disabled={savingSecurity}
                className="px-5 py-2 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-colors disabled:opacity-50">
                {savingSecurity ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE SUPPRESSION COMPTE */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-2xl gelasio font-bold text-red-600 mb-3">Supprimer mon compte</h3>
            <p className="text-gray-600 mb-6">
              Cette action est <strong>irréversible</strong>. Toutes vos données personnelles et votre
              solde de points fidélité seront définitivement effacés.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteOpen(false)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Annuler</button>
              <button onClick={handleDeleteAccount} disabled={deleting}
                className="px-5 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                {deleting ? 'Suppression...' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE DÉTAIL COMMANDE */}
      {selectedOrder && (
        <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)}
          statusColors={statusColors} statusLabels={statusLabels} formatDate={formatDate} />
      )}

      {/* MODALE ENVOI TICKET (EMAIL / SMS) */}
      {receiptModal && (
        <SendReceiptModal
          orderId={receiptModal.order._id}
          channel={receiptModal.channel}
          defaultTo={receiptModal.channel === 'email' ? (getUserProperty('email') || '') : (getUserProperty('phone') || '')}
          onClose={() => setReceiptModal(null)}
        />
      )}

      {/* MODALE FACTURE */}
      {invoiceTarget && (
        <InvoiceModal order={invoiceTarget} onClose={() => setInvoiceTarget(null)} />
      )}

      {/* ZONE D'IMPRESSION — portal hors #root, visible uniquement à l'impression */}
      {printData && (
        <PrintArea>
          <Ticket {...printData.ticket} createdAt={printData.createdAt} customerName={printData.customerName} />
        </PrintArea>
      )}
    </div>
  );
};

// ─── Carte commande (cliquable) ──────────────────────────────────────────────

// Stepper d'avancement (commandes en cours) — reflète le statut KDS en temps réel.
const PROGRESS_STEPS = [
  { key: 'pending', label: 'Reçue' },
  { key: 'preparing', label: 'En préparation' },
  { key: 'ready', label: 'Prête' },
];
const OrderProgress = ({ status }) => {
  const idx = PROGRESS_STEPS.findIndex(s => s.key === status);
  if (idx < 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-gray-100 flex items-center">
      {PROGRESS_STEPS.map((s, i) => (
        <React.Fragment key={s.key}>
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${i <= idx ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
              {i < idx ? <Icon name="check" /> : i + 1}
            </div>
            <span className={`mt-1 text-[10px] font-semibold whitespace-nowrap ${i <= idx ? 'text-brand-700' : 'text-gray-400'}`}>{s.label}</span>
          </div>
          {i < PROGRESS_STEPS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-1 mb-4 ${i < idx ? 'bg-brand-600' : 'bg-gray-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// Menu d'actions "⋮" (imprimer / email / SMS). State local ; stopPropagation pour
// ne pas déclencher l'ouverture du détail de la carte.
const OrderActionsMenu = ({ order, onPrint, onEmail, onSms, onInvoice }) => {
  const [open, setOpen] = useState(false);
  const choose = (fn) => (e) => { e.stopPropagation(); setOpen(false); fn(order); };
  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        aria-label="Actions sur la commande"
        className="w-9 h-9 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
        <Icon name="more" className="text-xl" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-20">
            <button onClick={choose(onPrint)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              <Icon name="print" className="text-gray-400" /> Imprimer le ticket
            </button>
            <button onClick={choose(onInvoice)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              <Icon name="invoice" className="text-gray-400" /> Facture
            </button>
            <button onClick={choose(onEmail)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              <Icon name="mail" className="text-gray-400" /> Envoyer par email
            </button>
            <button onClick={choose(onSms)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              <Icon name="sms" className="text-gray-400" /> Envoyer par SMS
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const OrderCard = ({ order, onClick, statusColors, statusLabels, formatDate, past, onPrint, onEmail, onSms, onInvoice }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
    {...clickable(onClick)}
    className="p-4 border border-gray-100 rounded-xl hover:shadow-md hover:border-brand-200 transition-all cursor-pointer">
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-lg font-bold text-gray-900">Commande {orderLabel(order)}</h4>
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${statusColors[order.status]}`}>
            {statusLabels[order.status]}
          </span>
        </div>
        <p className="text-gray-600 text-sm">
          {order.formula?.name || (order.dishes?.length ? `${order.dishes.length} plat(s) chaud(s)` : 'Commande personnalisée')} • {Number(order.finalPrice ?? order.totalPrice).toFixed(2)}€
        </p>
        <p className="text-gray-400 text-xs mt-1">{formatDate(order.createdAt)}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900">{Number(order.finalPrice ?? order.totalPrice).toFixed(2)}€</div>
          <div className="text-xs text-gray-500">Total</div>
        </div>
        {past && order.status === 'delivered' ? (
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <Icon name="check" className="text-green-600" />
          </div>
        ) : (
          <Icon name="arrow-right" className="text-gray-400" />
        )}
        <OrderActionsMenu order={order} onPrint={onPrint} onEmail={onEmail} onSms={onSms} onInvoice={onInvoice} />
      </div>
    </div>
    {!past && <OrderProgress status={order.status} />}
  </motion.div>
);

// ─── Construction du ticket (impression) ─────────────────────────────────────
// Reflète l'OrderDetailModal (salades / plats / produits) pour un ticket fidèle.

const ticketNameOf = (x) => (typeof x === 'object' ? (x?.name ?? '') : (x ?? ''));
const ticketMenuLabel = (menu) => {
  const n = ticketNameOf(menu);
  return n && n !== 'Solo' && n !== 'Sans Menu' ? n : null;
};
const ticketToDate = (val) => {
  if (!val) return new Date();
  if (typeof val.toDate === 'function') return val.toDate();
  if (val._seconds != null) return new Date(val._seconds * 1000);
  if (val.seconds != null) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
};

const buildTicketLines = (order) => {
  const lines = [];
  const salads = order.salads?.length
    ? order.salads
    : (order.formula
      ? [{ formula: order.formula, ingredients: order.ingredients, quantity: order.formulaQuantity, menu: order.menu, menuProducts: order.menuProducts }]
      : []);
  salads.forEach((s) => {
    const qty = s.quantity || 1;
    const m = ticketMenuLabel(s.menu);
    const details = [];
    if (Array.isArray(s.ingredients) && s.ingredients.length) details.push(s.ingredients.map(ticketNameOf).join(', '));
    if (m && s.menuProducts?.length) details.push(`Menu : ${s.menuProducts.map(ticketNameOf).join(', ')}`);
    lines.push({ label: `${ticketNameOf(s.formula)}${qty > 1 ? ` ×${qty}` : ''}${m ? ` — ${m}` : ''}`, details: details.join(' · ') });
  });
  (order.dishes || []).forEach((d) => {
    const m = ticketMenuLabel(d.menu);
    const details = [];
    if (d.selectedSides?.length) details.push(`+ ${d.selectedSides.map(ticketNameOf).join(', ')}`);
    if (m) details.push(d.menuProducts?.length ? `${m} : ${d.menuProducts.map(ticketNameOf).join(', ')}` : m);
    lines.push({ label: ticketNameOf(d.name) || 'Plat', details: details.join(' · ') });
  });
  [...(order.products || []), ...(order.cartProducts || [])].forEach((p) => {
    const qty = p.quantity || 1;
    lines.push({
      label: `${ticketNameOf(p.name) || ticketNameOf(p) || 'Produit'}${qty > 1 ? ` ×${qty}` : ''}`,
      details: p.selectedExtras?.length ? `+ ${p.selectedExtras.map(ticketNameOf).join(', ')}` : undefined,
    });
  });
  return lines;
};

const orderToTicket = (order) => {
  const payLabels = { cash: 'Espèces', card: 'Carte', online: 'En ligne', ticket: 'Tickets resto', mixed: 'Mixte', split: 'Addition séparée', points: 'Points fidélité' };
  const paymentLines = [];
  if (order.discountAmount > 0) paymentLines.push(`Réduction fidélité : −${Number(order.discountAmount).toFixed(2)} € (${order.pointsRedeemed} pts)`);
  if (order.paymentMethod) paymentLines.push(`Paiement : ${payLabels[order.paymentMethod] || order.paymentMethod}`);
  return {
    ticket: {
      subheading: `Commande ${orderLabel(order)}`,
      lines: buildTicketLines(order),
      total: Number(order.finalPrice ?? order.totalPrice ?? 0),
      totalLabel: 'Total payé',
      paymentLines,
      tax: (order.totalTVA > 0 && Array.isArray(order.taxBreakdown) && order.taxBreakdown.length)
        ? { breakdown: order.taxBreakdown, totalTVA: Number(order.totalTVA), totalHT: Number(order.totalHT), consumptionMode: order.consumptionMode }
        : null,
      serviceRate: order.serviceRate || 0,
    },
    createdAt: ticketToDate(order.createdAt),
    customerName: order.customerName,
  };
};

// ─── Modale détail commande ──────────────────────────────────────────────────

const OrderDetailModal = ({ order, onClose, statusColors, statusLabels, formatDate }) => {
  const payLabels = { cash: 'Espèces', card: 'Carte (terminal)', online: 'En ligne', ticket: 'Tickets restaurant', mixed: 'Mixte', split: 'Addition séparée', points: 'Points fidélité' };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-2xl gelasio font-bold text-gray-900">Commande {orderLabel(order)}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${statusColors[order.status]}`}>
            {statusLabels[order.status]}
          </span>
          <span className="text-sm text-gray-400">{formatDate(order.createdAt)}</span>
        </div>

        {/* Salade(s) — salads[] si présent, sinon repli sur le champ formula unique */}
        {(order.salads?.length
          ? order.salads
          : (order.formula ? [{ formula: order.formula, ingredients: order.ingredients, quantity: order.formulaQuantity, menu: order.menu }] : [])
        ).map((s, si) => {
          const menuName = s.menu?.name && s.menu.name !== 'Solo' && s.menu.name !== 'Sans Menu' ? s.menu.name : null;
          return (
            <div key={si} className="border-t border-gray-100 pt-3 mb-3">
              <p className="font-bold text-gray-800">
                {typeof s.formula === 'object' ? s.formula?.name : s.formula}
                {(s.quantity || 1) > 1 && <span className="ml-2 text-brand-600">×{s.quantity}</span>}
                {menuName && <span className="ml-2 text-xs font-bold text-brand-600 uppercase">{menuName}</span>}
              </p>
              {menuName && s.menuProducts?.length > 0 && (
                <p className="text-sm text-brand-600 mt-0.5">{s.menuProducts.map(p => typeof p === 'object' ? p.name : p).join(', ')}</p>
              )}
              {Array.isArray(s.ingredients) && s.ingredients.length > 0 && (
                <ul className="text-sm text-gray-600 mt-1 space-y-0.5">
                  {s.ingredients.map((ing, i) => (
                    <li key={i}>• {typeof ing === 'object' ? ing.name : ing}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {/* Plats chauds */}
        {Array.isArray(order.dishes) && order.dishes.length > 0 && (
          <div className="border-t border-gray-100 pt-3 mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Plats chauds</p>
            {order.dishes.map((d, i) => (
              <div key={i} className="text-sm mb-1">
                <p className="font-semibold text-gray-800">{d.name}</p>
                {d.selectedSides?.length > 0 && (
                  <p className="text-xs text-gray-500">+ {d.selectedSides.map(s => s.name).join(', ')}</p>
                )}
                {d.menu?.name && d.menu.name !== 'Solo' && d.menu.name !== 'Sans Menu' && (
                  <p className="text-xs font-semibold text-brand-600">
                    {d.menu.name}{d.menuProducts?.length ? ` : ${d.menuProducts.map(p => typeof p === 'object' ? p.name : p).join(', ')}` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Produits à l'unité : products (caisse) ET cartProducts (client en ligne) */}
        {(() => {
          const allProducts = [...(order.products || []), ...(order.cartProducts || [])];
          if (!allProducts.length) return null;
          return (
            <div className="border-t border-gray-100 pt-3 mb-3">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Produits</p>
              <p className="text-sm text-gray-600">
                {allProducts.map(p => {
                  const n = typeof p === 'object' ? p.name : p;
                  const qty = (typeof p === 'object' && p.quantity) || 1;
                  const extras = (typeof p === 'object' && p.selectedExtras?.length) ? ` (+${p.selectedExtras.map(e => e.name).join(', ')})` : '';
                  return (qty > 1 ? `${n} ×${qty}` : n) + extras;
                }).join(', ')}
              </p>
            </div>
          );
        })()}

        {/* Totaux */}
        <div className="border-t border-gray-100 pt-3 space-y-1 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Total</span><span className="font-mono">{Number(order.totalPrice ?? 0).toFixed(2)}€</span>
          </div>
          {order.discountAmount > 0 && (
            <div className="flex justify-between text-amber-600">
              <span>Réduction fidélité ({order.pointsRedeemed} pts)</span>
              <span className="font-mono">−{Number(order.discountAmount).toFixed(2)}€</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-900 text-base pt-1">
            <span>Payé</span><span className="font-mono">{Number(order.finalPrice ?? order.totalPrice).toFixed(2)}€</span>
          </div>
          {order.paymentMethod && (
            <div className="flex justify-between text-gray-400 text-xs pt-1">
              <span>Paiement</span><span>{payLabels[order.paymentMethod] || order.paymentMethod}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyAccount;
