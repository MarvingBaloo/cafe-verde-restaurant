import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import Icon from './Icon';
import kitchenIcon from '../assets/svg/kitchen.svg';
import ticketIcon from '../assets/svg/ticket.svg';
import managerIcon from '../assets/svg/manager.svg';
import ownerIcon from '../assets/svg/owner.svg';
import devIcon from '../assets/svg/dev.svg';
import productsIcon from '../assets/svg/products.svg';
import loginIconWhite from '../assets/svg/login-icon-white.svg';
import logoutIcon from '../assets/svg/logout.svg';

export default function MobileDrawer({ isHome, isProducts, isStaffUser, isDev, user, onLogout }) {
  return (
    <div className="md:hidden bg-white border-t border-gray-100 shadow-lg">
      <div className="container mx-auto px-4 py-4 flex flex-col gap-1">
        <Link to="/" className={`flex items-center gap-3 px-3 py-3 rounded-lg font-medium text-sm ${isHome ? 'text-brand-600 bg-brand-50 font-bold' : 'text-gray-700 hover:bg-gray-50'}`}>
          <Icon name="home" className="h-5 w-5" />
          <span>Accueil</span>
        </Link>
        <Link to="/products" className={`flex items-center gap-3 px-3 py-3 rounded-lg font-medium text-sm ${isProducts ? 'text-brand-600 bg-brand-50 font-bold' : 'text-gray-700 hover:bg-gray-50'}`}>
          <img src={productsIcon} alt="" className="h-5 w-5" />
          <span>Nos Produits</span>
        </Link>
        {isStaffUser && (
          <>
            <div className="h-px bg-gray-100 my-1" />
            <Link to="/kitchen" className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
              <img src={kitchenIcon} alt="" className="h-5 w-5" />
              <span>Cuisine</span>
            </Link>
            <Link to="/admin/caisse" className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
              <img src={ticketIcon} alt="" className="h-5 w-5" />
              <span>Caisse</span>
            </Link>
            <Link to="/admin" className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
              <img src={managerIcon} alt="" className="h-5 w-5" />
              <span>Manager</span>
            </Link>
            {(user?.role === 'superadmin' || isDev) && (
              <Link to="/super-admin" className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm hover:bg-gray-50 ${user?.role === 'superadmin' && !isDev ? 'text-gray-900 font-bold' : 'text-gray-700'}`}>
                <img src={ownerIcon} alt="" className="h-5 w-5" />
                <span>Gérant</span>
              </Link>
            )}
            {isDev && (
              <Link to="/dev" className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-900 font-bold hover:bg-gray-50">
                <img src={devIcon} alt="" className="h-5 w-5" />
                <span>DEV</span>
              </Link>
            )}
          </>
        )}
        <div className="h-px bg-gray-100 my-1" />
        {user ? (
          <>
            <Link to="/account" className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-700 hover:bg-gray-50 justify-between">
              <span className="font-bold">{user.name}</span>
              <span className="text-xs text-brand-600 font-bold bg-brand-50 px-2 py-0.5 rounded">{user.loyaltyPoints} pts</span>
            </Link>
            <button onClick={onLogout} className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-red-500 hover:bg-red-50 text-left font-medium">
              <img src={logoutIcon} alt="" className="h-5 w-5" />
              <span>Se déconnecter</span>
            </button>
          </>
        ) : (
          <Link to="/login" className="flex items-center gap-3 justify-center px-3 py-3 rounded-lg text-sm font-bold text-white bg-gray-900 hover:bg-brand-600 transition-colors mt-1">
            <img src={loginIconWhite} alt="" className="h-5 w-5" />
            <span>Connexion</span>
          </Link>
        )}
      </div>
    </div>
  );
}

MobileDrawer.propTypes = {
  isHome: PropTypes.bool,
  isProducts: PropTypes.bool,
  isStaffUser: PropTypes.bool,
  isDev: PropTypes.bool,
  user: PropTypes.object,
  onLogout: PropTypes.func.isRequired,
};
