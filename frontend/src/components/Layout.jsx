// frontend/src/components/Layout.jsx
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';
import { FaFacebook, FaInstagram, FaXTwitter } from 'react-icons/fa6';
import { useAuth } from '../context/AuthContext';
import { useConfig } from '../context/ConfigContext';
import Icon from './Icon';
import CartModal from './CartModal';
import { socket } from '../socket';
import { orderLabel } from '../utils/orderTicket';
import { useOpeningHours } from '../hooks/useOpeningHours';
import { summarizeWeek } from '../utils/hours';
import logo from '../assets/svg/logo-cafeverde.svg';
import logoShort from '../assets/svg/logo-cafeverde-short.svg';
import footerLogo from '../assets/svg/column-logo.svg';
import signatureLabel from '../assets/svg/signature-label.svg';
import decorationLeft from '../assets/images/decoration-left.png';
import decorationRight from '../assets/images/decoration-right.png';
import MobileDrawer from './MobileDrawer';
import {
  KitchenIcon,
  TicketIcon,
  ManagerIcon,
  OwnerIcon,
  DevIcon,
  ProductsIcon,
  CartIcon,
  PointsIcon,
  LoginIcon,
  LogoutIcon,
  NotificationsIcon,
  MenuIcon,
  CloseIcon,
} from './HeaderIcons';

const getInitials = (name) => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
};

/**
 * @description Composant structurel global (Shell).
 * Il contient la Navbar fixe et le Footer, et enveloppe le contenu dynamique.
 */
const Layout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isDev } = useAuth();
  const { order } = useConfig();
  // Horaires affichés au pied de page : la même source que la garde de commande.
  const { config: hoursConfig } = useOpeningHours();
  const weekSummary = React.useMemo(() => (hoursConfig ? summarizeWeek(hoursConfig) : []), [hoursConfig]);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);
  const isHome = location.pathname === '/';
  const isProducts = location.pathname === '/products';
  const isDevPage = location.pathname === '/dev';
  const isKitchenPage = location.pathname === '/kitchen';
  const isCaissePage = location.pathname === '/admin/caisse';
  const isAdminPage = location.pathname === '/admin';
  const isGerantPage = location.pathname === '/super-admin';
  const isKitchen = user?.role === 'kitchen';

  // Nombre total d'articles dans le panier (salade + plats + produits à l'unité)
  const cartCount =
    (order.formula ? (order.formulaQuantity || 1) : 0) +
    (order.dishes || []).reduce((s, d) => s + (d.quantity || 1), 0) +
    (order.cartProducts || []).reduce((s, p) => s + (p.quantity || 1), 0);

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Fonction utilitaire pour déterminer si l'utilisateur est staff/admin
  const isStaffUser = user && (
    user.role === 'admin' ||
    user.role === 'superadmin' ||
    user.role === 'dev' ||
    user.isAdmin === true
  );

  // Signature de marque : visible pour un invité (non connecté) ou un client, jamais pour le staff/cuisine.
  const showSignature = !user || user.role === 'client';

  // Cloche de notifications : réservée au client connecté (ni staff, ni cuisine, ni invité).
  const isClient = !!user && !isStaffUser && !isKitchen;
  const myUserId = user?.data?._id || user?._id;
  const [notifications, setNotifications] = React.useState([]);
  const [notifOpen, setNotifOpen] = React.useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  // Notif "commande prête" : quand une commande du client passe au statut 'ready' (temps réel KDS).
  React.useEffect(() => {
    if (!isClient || !myUserId) return;
    const onOrderUpdated = (order) => {
      if (!order || order.user !== myUserId || order.status !== 'ready') return;
      setNotifications(prev => {
        if (prev.some(n => n.orderId === order._id)) return prev; // une seule notif par commande
        const label = orderLabel(order);
        return [{ orderId: order._id, label, at: Date.now(), read: false }, ...prev];
      });
    };
    socket.on('order_updated', onOrderUpdated);
    return () => socket.off('order_updated', onOrderUpdated);
  }, [isClient, myUserId]);

  // Purge à la déconnexion.
  React.useEffect(() => {
    if (!user) { setNotifications([]); setNotifOpen(false); }
  }, [user]);

  // Ouvre/ferme le menu ; à l'ouverture, tout est marqué lu (badge remis à zéro).
  const toggleNotif = () => {
    setNotifOpen(open => {
      const next = !open;
      if (next) setNotifications(ns => ns.map(n => ({ ...n, read: true })));
      return next;
    });
  };
  const openAccountFromNotif = () => { setNotifOpen(false); navigate('/account'); };

  // Debug: Afficher les données utilisateur en développement
  React.useEffect(() => {
    if (user && !user.role) {
      console.warn('[Layout] Utilisateur sans propriété role:', user);
    }
  }, [user]);

  // Redirection automatique : le rôle kitchen est restreint au KDS
  React.useEffect(() => {
    if (
      user?.role === 'kitchen' &&
      location.pathname !== '/kitchen' &&
      location.pathname !== '/login'
    ) {
      navigate('/kitchen');
    }
  }, [user, location.pathname, navigate]);

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* --- GLOBAL HEADER (Navbar) --- */}
      <nav className="sticky top-0 z-50 w-full bg-white/90 backdrop-blur-md shadow-md transition-all duration-300 header-nav">
        <div className="mx-auto px-4 h-16 flex items-center justify-between relative">
          <img src={decorationLeft} alt="" loading="lazy" width="100" height="100" className="header-decoration-left" />
          <img src={decorationRight} alt="" loading="lazy" width="130" height="130" className="header-decoration-right" />
          {/* Logo / Brand */}
          {/* Le personnel (staff/cuisine) a le bloc admin dans la nav, donc garde le logo court à toutes les tailles ; un client régulier garde le logo complet. */}
          {isKitchen ? (
            <div className="flex items-center gap-2">
              <img src={logoShort} alt="Café Verde" className="h-14 w-auto header-logo-img" />
              <span className="text-xl gelasio italic font-bold tracking-tight text-brand-700">Café Verde</span>
            </div>
          ) : (
            <div className="header-brand">
              <Link to="/" className="flex items-center gap-2">
                <img src={isStaffUser ? logoShort : logo} alt="Café Verde" className="h-14 w-auto header-logo-img" />
              </Link>
              {showSignature && (
                <>
                  <span className="header-separator" aria-hidden="true" />
                  <img src={signatureLabel} alt="" loading="lazy" width="118" height="61" className="header-signature-label" />
                </>
              )}
            </div>
          )}

          {/* Navigation desktop */}
          <div className="hidden md:flex items-center header-links">
            {isStaffUser && (
              <>
                <Link to="/kitchen" className={`header-link ${isKitchenPage ? 'active' : ''}`}>
                  <KitchenIcon className="header-link-icon" />
                  <span>Cuisine</span>
                </Link>
                <Link to="/admin/caisse" className={`header-link ${isCaissePage ? 'active' : ''}`}>
                  <TicketIcon className="header-link-icon" />
                  <span>Caisse</span>
                </Link>
                <Link to="/admin" className={`header-link ${isAdminPage ? 'active' : ''}`}>
                  <ManagerIcon className="header-link-icon" />
                  <span>Manager</span>
                </Link>
                {(user?.role === 'superadmin' || isDev) && (
                  <Link to="/super-admin" className={`header-link ${isGerantPage ? 'active' : (user?.role === 'superadmin' && !isDev ? 'role-active' : '')}`}>
                    <OwnerIcon className="header-link-icon" />
                    <span>Gérant</span>
                  </Link>
                )}
                {isClient && (
                  <NotifBell
                    notifications={notifications}
                    open={notifOpen}
                    unreadCount={unreadCount}
                    onToggle={toggleNotif}
                    onOpenAccount={openAccountFromNotif}
                    navLink
                  />
                )}
                {isDev && (
                  <Link to="/dev" className={`header-link ${isDevPage ? 'active' : ''}`}>
                    <DevIcon className="header-link-icon" />
                    <span>DEV</span>
                  </Link>
                )}
                <span className="header-separator" aria-hidden="true" />
              </>
            )}
            {!isKitchen && (
              <Link to="/products" className={`header-link ${isProducts ? 'active' : ''}`}>
                <ProductsIcon className="header-link-icon" />
                <span>Produits</span>
              </Link>
            )}
            {!isKitchen && (
              <button onClick={() => setCartOpen(true)} className="header-link header-cart" title="Mon panier">
                <CartIcon className="header-link-icon" />
                <span>Panier</span>
                {cartCount > 0 && (
                  <span className="header-badge">{cartCount}</span>
                )}
              </button>
            )}
            {user ? (
              <div className="header-user-block">
                <Link to="/account" className="header-user-avatar" title={user.name}>
                  {getInitials(user.name)}
                </Link>
                <div className="header-user-points">
                  <PointsIcon />
                  <span>{user.loyaltyPoints} pts</span>
                </div>
                <button onClick={handleLogout} className="header-user-logout" title="Se déconnecter" aria-label="Se déconnecter">
                  <LogoutIcon />
                </button>
              </div>
            ) : (
              <Link to="/login" className="header-login-block">
                <span>Compte</span>
                <LoginIcon className="header-link-icon" />
              </Link>
            )}
          </div>

          {/* Panier + hamburger mobile */}
          {!isKitchen && (
            <div className="md:hidden flex items-center gap-1">
              {isClient && (
                <NotifBell
                  notifications={notifications}
                  open={notifOpen}
                  unreadCount={unreadCount}
                  onToggle={toggleNotif}
                  onOpenAccount={openAccountFromNotif}
                  mobile
                />
              )}
              <button
                onClick={() => setCartOpen(true)}
                className="relative p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Mon panier"
              >
                <CartIcon className="h-6 w-6" />
                {cartCount > 0 && (
                  <span className="header-badge">{cartCount}</span>
                )}
              </button>
              <button
                onClick={() => setMobileMenuOpen(o => !o)}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Menu"
              >
                {mobileMenuOpen ? (
                  <CloseIcon className="h-6 w-6" />
                ) : (
                  <MenuIcon className="h-6 w-6" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Menu mobile drawer */}
        {mobileMenuOpen && !isKitchen && (
          <MobileDrawer
            isHome={isHome}
            isProducts={isProducts}
            isStaffUser={isStaffUser}
            isDev={isDev}
            user={user}
            onLogout={handleLogout}
          />
        )}

      </nav>

      {/* --- PANIER (MODAL) --- */}
      <CartModal isOpen={cartOpen} onClose={() => setCartOpen(false)} />

      {/* --- MAIN CONTENT --- */}
      <main className="flex-grow w-full">
        {children}
      </main>

      {/* --- GLOBAL FOOTER --- */}
      <footer className="">
        {/* Bande décorative honey */}
        <div className="h-[2px] bg-gradient-to-r from-transparent via-honey to-transparent" />

        <div className="footer-nav-container">

          {/* Colonne 1 : Brand + Réseaux sociaux */}
          <div className="footer-logo-socials">
            <img src={footerLogo} alt="Café Verde" className="h-24 w-24" />
            <div>
              <p className="">
                Cuisine antillaise &amp; salades à composer
              </p>
            </div>
            {/* Réseaux sociaux */}
            <div className="flex items-center gap-3">
              <a
                href="#"
                aria-label="Facebook"
                className="w-9 h-9 rounded-full bg-ivory/10 hover:bg-honey hover:text-brand-900 flex items-center justify-center text-ivory transition-all duration-200"
              >
                <FaFacebook size={16} />
              </a>
              <a
                href="#"
                aria-label="Instagram"
                className="w-9 h-9 rounded-full bg-ivory/10 hover:bg-honey hover:text-brand-900 flex items-center justify-center text-ivory transition-all duration-200"
              >
                <FaInstagram size={16} />
              </a>
              <a
                href="#"
                aria-label="Twitter / X"
                className="w-9 h-9 rounded-full bg-ivory/10 hover:bg-honey hover:text-brand-900 flex items-center justify-center text-ivory transition-all duration-200"
              >
                <FaXTwitter size={16} />
              </a>
            </div>
          </div>

          <div className="footer-nav">

            {/* Colonne 2 : Horaires — lus dans les réglages, jamais écrits en dur :
                le pied de page ne doit pas promettre une heure à laquelle la boutique
                refuse déjà les commandes. */}
            <div className='footer-nav-column'>
              <h4 className="text-honey uppercase tracking-widest mb-5">Horaires</h4>
              <ul className=" ">
                {weekSummary.map((group) => (
                  <li key={group.label} className={group.closed ? 'pt-6' : ''}>
                    {group.closed ? (
                      <span>Fermé {group.days.length === 1 ? `le ${group.label.toLowerCase()}` : group.label.toLowerCase()}</span>
                    ) : (
                      <>
                        <span className="block font-bold">{group.label}</span>
                        <span>{group.open} – {group.close} en continu</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <h4 className="text-honey uppercase tracking-widest mt-8 mb-3">Contact</h4>
              <a href="tel:+590590020723" className="hover:text-honey transition-colors">
                0590 02 07 23
              </a>
            </div>

            {/* Colonne 3 : Navigation */}
            <div className='footer-nav-column'>
              <h4 className="text-honey uppercase tracking-widest mb-5">Navigation</h4>
              <ul className="space-y-2 ">
                <li><Link to="/" className="hover:text-honey transition-colors">Accueil</Link></li>
                <li><Link to="/products" className="hover:text-honey transition-colors">Le menu</Link></li>
                <li><Link to="/configurator" className="hover:text-honey transition-colors">Composer ma salade</Link></li>
              </ul>
            </div>
          </div>
        </div>


        <div className="py-5 px-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-ivory/40">
          <p>&copy; 2026 Café Verde — Tous droits réservés.</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link to="/mentions-legales" className="hover:text-honey transition-colors">Mentions légales</Link>
            <Link to="/cgv" className="hover:text-honey transition-colors">CGV</Link>
            <Link to="/cgu" className="hover:text-honey transition-colors">CGU</Link>
            <Link to="/confidentialite" className="hover:text-honey transition-colors">Confidentialité</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
};

// Cloche de notifications in-app (client connecté uniquement).
const NotifBell = ({ notifications, open, unreadCount, onToggle, onOpenAccount, mobile, navLink }) => (
  <div className="relative">
    <button
      onClick={onToggle}
      className={navLink ? 'header-link header-notif' : `relative text-gray-600 hover:text-brand-600 transition-colors ${mobile ? 'p-2 rounded-lg hover:bg-gray-100' : ''}`}
      title="Notifications"
      aria-label="Notifications"
    >
      {navLink ? (
        <>
          <NotificationsIcon className="header-link-icon" />
          <span>Notifs</span>
        </>
      ) : (
        <NotificationsIcon className="h-6 w-6" />
      )}
      {unreadCount > 0 && (
        <span className="header-badge">{unreadCount}</span>
      )}
    </button>
    {open && (
      <>
        <div className="fixed inset-0 z-40" onClick={onToggle} />
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-bold text-gray-800 text-sm">Notifications</div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Aucune notification</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50">
              {notifications.map((n) => (
                <li key={n.orderId}>
                  <button
                    onClick={onOpenAccount}
                    className="w-full text-left px-4 py-3 hover:bg-brand-50 transition-colors flex items-start gap-2"
                  >
                    <span className="text-brand-600 mt-0.5"><Icon name="check" /></span>
                    <span>
                      <span className="block text-sm font-semibold text-gray-800">Commande {n.label} prête !</span>
                      <span className="block text-xs text-gray-400">Votre commande est prête à être récupérée.</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    )}
  </div>
);

NotifBell.propTypes = {
  notifications: PropTypes.array.isRequired,
  open: PropTypes.bool,
  unreadCount: PropTypes.number,
  onToggle: PropTypes.func.isRequired,
  onOpenAccount: PropTypes.func.isRequired,
  mobile: PropTypes.bool,
  navLink: PropTypes.bool,
};

Layout.propTypes = {
  children: PropTypes.node.isRequired,
};

export default Layout;