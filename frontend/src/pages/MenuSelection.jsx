// src/pages/MenuSelection.jsx
import React, { useState, useEffect } from 'react';
import { clickable } from '../utils/a11y';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../context/ConfigContext';
import { fetchConfig, fetchProducts } from '../services/api';
import { socket } from '../socket';
import { upsertAvailable, removeFromList } from '../utils/liveCatalog';
import ProductCard from '../components/ProductCard';
import SkeletonCard from '../components/SkeletonCard';
import Icon from '../components/Icon';

const MenuSelection = () => {
  const { order, setMenu, toggleProduct, totalPrice } = useConfig();
  const navigate = useNavigate();

  const [menus, setMenus] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [configRes, productsRes] = await Promise.all([fetchConfig(), fetchProducts()]);
        console.log('[DEBUG] Structure productsRes:', productsRes);
        console.log('[DEBUG] Contenu productsRes.data:', productsRes.data);
        
        // Fonction locale pour extraire les données proprement
        const extractData = (response) => {
          // Cas 1 : Tableau direct (ex: Ingrédients)
          if (Array.isArray(response.data)) return response.data;
          // Cas 2 : Wrapper "Buggé" où les données sont dans 'message' (ex: Commandes, Menus)
          if (response.data && Array.isArray(response.data.message)) return response.data.message;
          // Cas 3 : Wrapper Standard
          if (response.data && Array.isArray(response.data.data)) return response.data.data;
          // Fallback
          return [];
        };

        // Extraction des menus depuis configRes
        const configData = configRes.data || {};
        setMenus(configData.menus || []);

        // Extraction des produits avec extractData ; masque les produits désactivés (isAvailable === false)
        setProducts(extractData(productsRes).filter(p => p.isAvailable !== false));
      } catch (err) {
        setError('Erreur lors du chargement des options de menu.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Masquage temps réel des produits (dés)activés/supprimés par le gérant
  useEffect(() => {
    const onProduct = (p) => setProducts(prev => upsertAvailable(prev, p));
    const onProductDel = (e) => setProducts(prev => removeFromList(prev, e));
    socket.on('product_created', onProduct);
    socket.on('product_updated', onProduct);
    socket.on('product_availability_toggled', onProduct);
    socket.on('product_deleted', onProductDel);
    return () => {
      socket.off('product_created', onProduct);
      socket.off('product_updated', onProduct);
      socket.off('product_availability_toggled', onProduct);
      socket.off('product_deleted', onProductDel);
    };
  }, []);

  // Sélection par défaut du menu Solo
  useEffect(() => {
    if (!order.menu && menus.length > 0) {
      const soloMenu = menus.find(m => m.name === 'Solo') || menus[0];
      if (soloMenu) setMenu(soloMenu);
    }
  }, [menus, order.menu, setMenu]);

// Redirection de sécurité
  if (!order.formula) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 text-center">
        <h1 className="text-2xl font-bold mb-4">Oups !</h1>
        <p className="mb-6 text-gray-500">Votre bol est vide. Retournez à l'accueil pour commencer.</p>
        <button onClick={() => navigate('/')} className="bg-brand-600 text-white px-6 py-2 rounded-full font-bold">
          Retour Accueil
        </button>
      </div>
    );
  }

  const handleSelectMenu = (menu) => {
    setMenu(menu);
    // Scroll automatique doux vers les produits si ce n'est pas le menu Solo
    if (menu.name !== 'Solo' && menu.name !== 'Sans Menu') {
      setTimeout(() => {
        document.getElementById('products-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  const isMenuProduct = (p) =>
    order.menu?.allowedProductIds?.length ? order.menu.allowedProductIds.includes(p._id) : true;
  const drinks = products.filter(p => p.category === 'drink' && isMenuProduct(p));
  const desserts = products.filter(p => p.category === 'dessert' && isMenuProduct(p));

  // Le chargement a échoué : sans ce bloc, `error` était renseigné mais jamais
  // affiché — le client voyait une page vide sans savoir quoi faire.
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 pb-32 font-sans">
        <div className="bg-white py-8 px-4 text-center border-b border-gray-100 shadow-sm">
          <h1 className="text-3xl gelasio font-bold text-gray-900 mb-2">Accompagnez votre repas</h1>
        </div>
        <div className="container mx-auto px-4 py-12 max-w-xl text-center">
          <p className="text-red-600 font-semibold mb-6">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 pb-32 font-sans">
        <div className="bg-white py-8 px-4 text-center border-b border-gray-100 shadow-sm">
          <h1 className="text-3xl gelasio font-bold text-gray-900 mb-2">Accompagnez votre repas</h1>
          <p className="text-gray-500">Chargement des options...</p>
        </div>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50 pb-32 font-sans">
      
      {/* HEADER SIMPLE */}
      <div className="bg-white py-8 px-4 text-center border-b border-gray-100 shadow-sm">
        <h1 className="text-3xl gelasio font-bold text-gray-900 mb-2">Accompagnez votre repas</h1>
        <p className="text-gray-500">Transformez votre salade en un menu complet.</p>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        
        {/* 1. SÉLECTION DU TYPE DE MENU (Pricing Cards Style) */}
        <section className="mb-16">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-sm">1</span>
            Choisissez votre formule
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {menus.map(menu => {
              const isActive = order.menu?._id === menu._id;
              // Icônes dynamiques selon le nom du menu (logique simple)
              const iconName = menu.name.includes('XL') ? 'crown' : menu.name.includes('L') ? 'star' : 'salad';
              
              return (
                <div 
                  key={menu._id}
                  {...clickable(() => handleSelectMenu(menu))}
                  className={`
                    relative p-6 rounded-2xl border-2 cursor-pointer transition-all duration-300 flex flex-col items-center text-center
                    ${isActive 
                      ? 'border-brand-500 bg-white shadow-xl scale-105 z-10' 
                      : 'border-white bg-white shadow-sm hover:border-brand-200 hover:shadow-md opacity-80 hover:opacity-100'}
                  `}
                >
                  {isActive && (
                    <div className="absolute -top-4 bg-brand-500 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-sm">
                      Sélectionné
                    </div>
                  )}
                  
                  <div className="text-4xl mb-4"><Icon name={iconName} /></div>
                  <h3 className="text-xl font-bold text-gray-900">{menu.name}</h3>
                  <div className="text-brand-600 font-extrabold text-2xl my-2">
                    +{menu.price_addition.toFixed(2)}€
                  </div>
                  
                  {/* Liste des inclusions */}
                  <div className="mt-4 space-y-2 text-sm text-gray-500">
                    {menu.includes?.drink && menu.includes?.dessert ? (
                      menu.selectionMode === 'or' ? (
                        <div className="flex items-center gap-2 justify-center"><Icon name="drink" /><Icon name="dessert" /> Une boisson ou un dessert</div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 justify-center"><Icon name="drink" /> Boisson incluse</div>
                          <div className="flex items-center gap-2 justify-center"><Icon name="dessert" /> Dessert inclus</div>
                        </>
                      )
                    ) : menu.includes?.drink ? (
                      <div className="flex items-center gap-2 justify-center"><Icon name="drink" /> Boisson incluse</div>
                    ) : menu.includes?.dessert ? (
                      <div className="flex items-center gap-2 justify-center"><Icon name="dessert" /> Dessert inclus</div>
                    ) : (
                      <div className="italic">Juste la salade</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 2. SÉLECTION DES PRODUITS (Conditionnel) */}
        {order.menu && order.menu.name !== 'Solo' && order.menu.name !== 'Sans Menu' && (
          <div id="products-section" className="animate-[fadeIn_0.5s_ease-out]">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-sm">2</span>
              Faites votre choix
            </h2>

            {/* BOISSONS */}
            {order.menu.includes.drink && (
              <div className="mb-12">
                <h3 className="text-lg gelasio font-bold text-gray-600 mb-4 border-l-4 border-brand-400 pl-3">Boissons Fraîches</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {drinks.map(drink => (
                    <div key={drink._id} className="h-64">
                      <ProductCard
                        product={drink}
                        isSelected={order.products.some(p => p._id === drink._id)}
                        onClick={() => toggleProduct(drink)}
                        showMenuBadge
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DESSERTS */}
            {order.menu.includes.dessert && (
              <div className="mb-12">
                <h3 className="text-lg gelasio font-bold text-gray-600 mb-4 border-l-4 border-orange-400 pl-3">Douceurs Sucrées</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {desserts.map(dessert => (
                    <div key={dessert._id} className="h-64">
                      <ProductCard
                        product={dessert}
                        isSelected={order.products.some(p => p._id === dessert._id)}
                        onClick={() => toggleProduct(dessert)}
                        showMenuBadge
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* FOOTER STICKY (Total & Validation) */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-40 backdrop-blur-sm bg-white/95">
        <div className="container mx-auto flex justify-between items-center max-w-4xl">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-bold uppercase">Total à payer</span>
            <span className="text-3xl font-extrabold text-brand-600">{totalPrice.toFixed(2)}€</span>
          </div>
          
          <button
            onClick={() => navigate('/summary')}
            className="flex items-center gap-2 bg-gray-900 text-white px-8 py-3 rounded-xl font-bold text-lg shadow-lg hover:bg-brand-600 hover:shadow-brand-300 transition-all duration-300 transform hover:-translate-y-1"
          >
            Vérifier ma commande
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default MenuSelection;