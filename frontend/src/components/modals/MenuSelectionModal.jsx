import React, { useState, useEffect } from 'react';
import { fetchMenus } from '../../services/api';

/**
 * Composant SVG pour une salade simple
 */
const SaladIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-brand-500">
    <path d="M24 8C24 8 30 4 36 8C42 12 40 20 34 22C28 24 24 28 24 28C24 28 20 24 14 22C8 20 6 12 12 8C18 4 24 8 24 8Z" 
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 30L20 34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M32 30L28 34" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M24 28V38" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="24" cy="38" r="2" fill="currentColor" />
    <circle cx="18" cy="14" r="2" fill="currentColor" />
    <circle cx="30" cy="14" r="2" fill="currentColor" />
    <circle cx="20" cy="18" r="1.5" fill="currentColor" />
    <circle cx="28" cy="18" r="1.5" fill="currentColor" />
  </svg>
);

/**
 * Composant SVG pour une boisson (verre avec paille)
 */
const DrinkIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-blue-500">
    <path d="M16 16H32V32C32 34.209 30.209 36 28 36H20C17.791 36 16 34.209 16 32V16Z" 
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 10H28L30 16H18L20 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M24 10V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M24 32V36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M20 22H28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="24" cy="26" r="1.5" fill="currentColor" />
    <path d="M20 40H28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * Composant SVG pour un dessert (gâteau)
 */
const DessertIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-orange-500">
    <path d="M12 24H36V36C36 38.209 34.209 40 32 40H16C13.791 40 12 38.209 12 36V24Z" 
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 16H28L30 24H18L20 16Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M24 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M16 28H32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="20" cy="32" r="1.5" fill="currentColor" />
    <circle cx="28" cy="32" r="1.5" fill="currentColor" />
    <path d="M24 20V24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M18 20L20 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M30 20L28 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * @description Modale de sélection de menu
 * @param {Object} props - Les propriétés du composant
 * @param {boolean} props.isOpen - Indique si la modale est ouverte
 * @param {Function} props.onClose - Fonction à appeler pour fermer la modale
 * @param {Function} props.onSelect - Fonction à appeler avec le menu sélectionné
 * @param {Array} [props.menus] - Liste des menus disponibles (optionnel, sinon chargé via API)
 */
const MenuSelectionModal = ({ isOpen, onClose, onSelect, menus: propMenus }) => {
  const [menus, setMenus] = useState(propMenus || []);
  const [loading, setLoading] = useState(!propMenus);
  const [error, setError] = useState(null);

  // Charger les menus si non fournis via props
  useEffect(() => {
    if (!isOpen || propMenus) return;

    const loadMenus = async () => {
      try {
        setLoading(true);
        const response = await fetchMenus();
        // Extraire les données selon la structure de l'API
        let menusData = [];
        if (Array.isArray(response.data)) {
          menusData = response.data;
        } else if (response.data && Array.isArray(response.data.data)) {
          menusData = response.data.data;
        } else if (response.data && Array.isArray(response.data.message)) {
          menusData = response.data.message;
        }
        setMenus(menusData);
        setError(null);
      } catch (err) {
        console.error('Erreur lors du chargement des menus:', err);
        setError('Impossible de charger les menus. Veuillez réessayer.');
        // Fallback avec des données par défaut
        setMenus([
          { _id: 'solo', name: 'Solo', price_addition: 0, includes: { drink: false, dessert: false } },
          { _id: 'menu-l', name: 'Menu L', price_addition: 3.5, includes: { drink: true, dessert: false } },
          { _id: 'menu-xl', name: 'Menu XL', price_addition: 5.5, includes: { drink: true, dessert: true } }
        ]);
      } finally {
        setLoading(false);
      }
    };

    loadMenus();
  }, [isOpen, propMenus]);

  if (!isOpen) return null;

  // Trier les menus: Solo, Menu L, Menu XL, autres
  const sortedMenus = [...menus].sort((a, b) => {
    const order = { 'Solo': 0, 'Menu L': 1, 'Menu XL': 2 };
    return (order[a.name] || 3) - (order[b.name] || 3);
  });

  // Prendre seulement les 3 premiers menus pour l'affichage
  const displayMenus = sortedMenus.slice(0, 3);

  const handleCardClick = (menu) => {
    onSelect(menu);
    onClose();
  };

  // Fonction pour obtenir l'icône et la description selon le menu
  const getMenuDetails = (menu) => {
    if (menu.name === 'Solo' || menu.name === 'Sans Menu') {
      return {
        icon: <SaladIcon />,
        title: 'Solo',
        subtitle: 'Salade seule',
        price: 'Inclus',
        description: 'Profitez de votre création sans supplément.',
        colorClass: 'border-gray-200 hover:border-gray-300',
        textColor: 'text-gray-700'
      };
    } else if (menu.name === 'Menu L' || (menu.includes.drink && !menu.includes.dessert)) {
      return {
        icon: (
          <div className="relative">
            <SaladIcon />
            <div className="absolute -right-2 -bottom-2">
              <DrinkIcon />
            </div>
          </div>
        ),
        title: 'Menu L',
        subtitle: 'Salade + Boisson',
        price: `+${menu.price_addition.toFixed(2)}€`,
        description: 'Accompagnez votre salade d\'une boisson fraîche.',
        colorClass: 'border-blue-200 hover:border-blue-400',
        textColor: 'text-blue-600'
      };
    } else if (menu.name === 'Menu XL' || (menu.includes.drink && menu.includes.dessert)) {
      return {
        icon: (
          <div className="relative">
            <SaladIcon />
            <div className="absolute -right-2 -bottom-2">
              <DrinkIcon />
            </div>
            <div className="absolute -left-2 -bottom-2">
              <DessertIcon />
            </div>
          </div>
        ),
        title: 'Menu XL',
        subtitle: 'Salade + Boisson + Dessert',
        price: `+${menu.price_addition.toFixed(2)}€`,
        description: 'Complétez votre repas avec une boisson et un dessert.',
        colorClass: 'border-orange-200 hover:border-orange-400',
        textColor: 'text-orange-600'
      };
    } else {
      // Menu générique
      const includes = [];
      if (menu.includes.drink) includes.push('boisson');
      if (menu.includes.dessert) includes.push('dessert');
      
      return {
        icon: <SaladIcon />,
        title: menu.name,
        subtitle: includes.length > 0 ? `Inclut: ${includes.join(' + ')}` : 'Salade seule',
        price: menu.price_addition > 0 ? `+${menu.price_addition.toFixed(2)}€` : 'Inclus',
        description: menu.description || 'Personnalisez votre menu.',
        colorClass: 'border-brand-200 hover:border-brand-400',
        textColor: 'text-brand-600'
      };
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop avec blur */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Fenêtre modale */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-in fade-in-50 zoom-in-90 duration-300">
        {/* En-tête */}
        <div className="sticky top-0 bg-white border-b border-gray-100 p-6 rounded-t-3xl z-10">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl gelasio font-bold text-gray-900">Choisissez votre menu</h2>
              <p className="text-gray-600 mt-2">Transformez votre création en un repas complet</p>
            </div>
            <button
              onClick={onClose}
              className="p-3 hover:bg-gray-100 rounded-full transition-colors text-2xl text-gray-500 font-bold"
              aria-label="Fermer"
            >
              ×
            </button>
          </div>
        </div>

        {/* Contenu principal */}
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center items-center py-16">
              <div className="animate-spin h-12 w-12 border-4 border-brand-500 border-t-transparent rounded-full"></div>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-500 mb-4">{error}</p>
              <p className="text-gray-600">Utilisation des menus par défaut.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {displayMenus.map((menu) => {
                const details = getMenuDetails(menu);
                return (
                  <button
                    key={menu._id}
                    onClick={() => handleCardClick(menu)}
                    className={`group relative bg-white rounded-2xl border-2 p-6 cursor-pointer transition-all duration-300 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-offset-2 ${details.colorClass}`}
                  >
                    {/* Illustration */}
                    <div className="flex justify-center mb-6">
                      <div className="transition-transform duration-300 group-hover:scale-110">
                        {details.icon}
                      </div>
                    </div>

                    {/* Titre et sous-titre */}
                    <h3 className="text-2xl gelasio font-bold text-gray-900 text-center mb-1">
                      {details.title}
                    </h3>
                    <p className="text-gray-500 text-center mb-4 text-sm">
                      {details.subtitle}
                    </p>

                    {/* Prix */}
                    <div className="text-center mb-6">
                      <div className={`text-3xl font-bold ${details.textColor}`}>
                        {details.price}
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-gray-600 text-center text-sm">
                      {details.description}
                    </p>

                    {/* Indicateur de survol (bordure épaissie) */}
                    <div className="absolute inset-0 border-2 border-transparent group-hover:border-current rounded-2xl transition-all duration-300 pointer-events-none opacity-50 group-hover:opacity-100"></div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Note informative */}
          <div className="mt-8 text-center">
            <p className="text-gray-600 text-sm">
              {displayMenus.length === 1 ? 
                'Le menu Solo est sélectionné par défaut.' :
                'Sélectionnez un menu pour continuer vers la finalisation de votre commande.'
              }
            </p>
          </div>
        </div>

        {/* Pied de page */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-6 rounded-b-3xl">
          <div className="flex justify-between items-center">
            <button
              onClick={onClose}
              className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-bold hover:bg-gray-200 transition-colors"
            >
              Annuler
            </button>
            <p className="text-gray-500 text-sm">
              {displayMenus.length} option{displayMenus.length > 1 ? 's' : ''} disponible{displayMenus.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MenuSelectionModal;