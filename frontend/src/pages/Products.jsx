// src/pages/Products.jsx
import React, { useState, useEffect } from 'react';
import { clickable } from '../utils/a11y';
import { useNavigate, useLocation } from 'react-router-dom';
import { fetchFormulas, fetchProducts, fetchDishes, fetchBubbleTeas, fetchMilkshakes, fetchProductCategories } from '../services/api';
import { useConfig } from '../context/ConfigContext';
import { useActivityTracker } from '../hooks/useActivityTracker';
import ProductCard from '../components/ProductCard';
import DishCard from '../components/DishCard';
import BubbleTeaCard from '../components/BubbleTeaCard';
import MilkshakeCard from '../components/MilkshakeCard';
import BubbleTeaModal from '../components/modals/BubbleTeaModal';
import MilkshakeModal from '../components/modals/MilkshakeModal';
import ProductExtrasModal from '../components/modals/ProductExtrasModal';
import Icon from '../components/Icon';
import ProductCategories from '../components/sections/ProductCategories';
import { socket } from '../socket';
import { upsertAvailable, removeFromList } from '../utils/liveCatalog';

// Placeholder images par catégorie
const CATEGORY_PLACEHOLDERS = {
  side: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop",
  drink: "https://images.unsplash.com/photo-1551024709-8f23befc6f87?q=80&w-800&auto=format&fit=crop",
  dessert: "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?q=80&w-800&auto=format&fit=crop"
};

// Tri d'une fratrie de catégories : par `order` puis par nom.
const sortNodes = (nodes) => [...nodes].sort((a, b) => {
  const oa = typeof a.order === 'number' ? a.order : 0;
  const ob = typeof b.order === 'number' ? b.order : 0;
  if (oa !== ob) return oa - ob;
  return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
});

// Compte récursif des produits sous un nœud (lui + ses descendants).
const countDeep = (nodeId, childrenByParent, productsByCatId) => {
  let total = (productsByCatId[nodeId] || []).length;
  (childrenByParent[nodeId] || []).forEach(child => {
    total += countDeep(child.id, childrenByParent, productsByCatId);
  });
  return total;
};

/**
 * @description Nœud d'arbre de catégories rendu en accordéon repliable (récursif).
 * Affiche ses sous-catégories disponibles puis ses produits directs.
 */
const CategoryNode = ({ node, depth, childrenByParent, productsByCatId, openCats, toggle, onProductClick }) => {
  const isOpen = openCats.has(node.id);
  const kids = sortNodes((childrenByParent[node.id] || []).filter(c => c.isAvailable !== false));
  const prods = [...(productsByCatId[node.id] || [])].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  const total = countDeep(node.id, childrenByParent, productsByCatId);

  return (
    <div className="mb-3">
      <div
        {...clickable(() => toggle(node.id))}
        className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm hover:border-brand-300 hover:shadow transition-all"
      >
        <Icon name={isOpen ? 'arrow-down' : 'arrow-right'} className="text-brand-600 text-lg" />
        <span className={`flex-grow font-serif font-bold text-gray-900 ${depth === 0 ? 'text-xl' : 'text-lg'}`}>
          {node.name}
        </span>
        <span className="text-sm text-gray-500">{total} produit{total > 1 ? 's' : ''}</span>
      </div>

      {isOpen && (
        <div className="pl-4 md:pl-6 mt-3 border-l-2 border-gray-100">
          {kids.map(child => (
            <CategoryNode
              key={child.id}
              node={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              productsByCatId={productsByCatId}
              openCats={openCats}
              toggle={toggle}
              onProductClick={onProductClick}
            />
          ))}

          {prods.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-4">
              {prods.map(p => (
                <ProductCard key={p._id} product={p} isSelected={false} onClick={() => onProductClick(p)} />
              ))}
            </div>
          )}

          {kids.length === 0 && prods.length === 0 && (
            <p className="text-sm text-gray-400 italic mb-3">Aucun produit pour le moment.</p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * @description Page catalogue complet : Formules + Produits à l'unité
 */
const Products = () => {
  const [formulas, setFormulas] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [bubbleTeas, setBubbleTeas] = useState([]);
  const [selectedTea, setSelectedTea] = useState(null);
  const [milkshakes, setMilkshakes] = useState([]);
  const [selectedMilkshake, setSelectedMilkshake] = useState(null);
  const [extrasProduct, setExtrasProduct] = useState(null);
  const [productCategories, setProductCategories] = useState([]);
  const [openCats, setOpenCats] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [selectedUniverse, setSelectedUniverse] = useState(null);
  const navigate = useNavigate();
  const { state: locationState } = useLocation();
  const { startOrder, order, addProductToCart } = useConfig();
  const { trackFormulaSelection, track } = useActivityTracker();

  const cartCount = (order.cartProducts || []).reduce((s, p) => s + p.quantity, 0)
    + (order.bubbleTeas || []).reduce((s, b) => s + (b.quantity || 1), 0)
    + (order.milkshakes || []).reduce((s, m) => s + (m.quantity || 1), 0);
  const cartTotal = (order.cartProducts || []).reduce((s, p) => s + p.price * p.quantity, 0)
    + (order.bubbleTeas || []).reduce((s, b) => s + (b.subtotal || 0) * (b.quantity || 1), 0)
    + (order.milkshakes || []).reduce((s, m) => s + (m.subtotal || 0) * (m.quantity || 1), 0);

  // Titres et descriptions des univers
  const UNIVERSES = {
    salad: {
      title: "Nos Salades",
      subtitle: "Composez sur mesure",
      description: "Créez votre salade avec des ingrédients frais de saison.",
      icon: "salad",
      color: "bg-brand-600",
      textColor: "text-brand-600",
      borderColor: "border-brand-200",
      hoverColor: "hover:bg-brand-700",
      gradient: "from-green-500 to-emerald-600"
    },
    hot_dish: {
      title: "Les Plats Chauds",
      subtitle: "Saveurs des îles",
      description: "Saveurs antillaises pour réchauffer le cœur.",
    },
    drinks: {
      title: "Nos Boissons",
      subtitle: "Fraîcheur & Évasion",
      description: "Jus frais, infusions et boissons maison pour accompagner votre repas.",
    },
    desserts: {
      title: "Plaisirs Sucrés",
      subtitle: "Douceurs & Gourmandises",
      description: "Desserts maison et milkshakes à composer pour finir en beauté.",
    }
  };

  useEffect(() => {
    if (locationState?.category) {
      setSelectedUniverse(locationState.category);
    }
  }, [locationState]);

  const handleCategorySelect = (categoryKey) => {
    setSelectedUniverse(categoryKey);
  };

  // Filtrer les formules par univers sélectionné
  const filteredFormulas = selectedUniverse 
    ? formulas.filter(formula => formula.type === selectedUniverse)
    : formulas;

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [formulasRes, productsRes, dishesRes, bubbleTeasRes, milkshakesRes, categoriesRes] = await Promise.all([
          fetchFormulas(),
          fetchProducts(),
          fetchDishes(),
          fetchBubbleTeas(),
          fetchMilkshakes(),
          fetchProductCategories()
        ]);

        // Fonction d'extraction robuste (Gère les incohérences backend)
        const extractData = (response) => {
          if (Array.isArray(response.data)) return response.data;
          if (response.data && Array.isArray(response.data.message)) return response.data.message;
          if (response.data && Array.isArray(response.data.data)) return response.data.data;
          return [];
        };

        // Masque côté client tout item désactivé par le gérant (isAvailable === false)
        const onlyAvailable = (arr) => arr.filter(item => item.isAvailable !== false);

        // Extraction sécurisée
        const formulasData = extractData(formulasRes);
        // Note: Si formulasRes contient {formulas: ...}, adapter l'extraction
        if (formulasRes.data && formulasRes.data.formulas) {
          setFormulas(onlyAvailable(formulasRes.data.formulas));
        } else {
          setFormulas(onlyAvailable(formulasData));
        }

        setAllProducts(onlyAvailable(extractData(productsRes)));
        setDishes(onlyAvailable(Array.isArray(dishesRes.data) ? dishesRes.data : []));
        setBubbleTeas(onlyAvailable(extractData(bubbleTeasRes)));
        setMilkshakes(onlyAvailable(extractData(milkshakesRes)));
        setProductCategories(extractData(categoriesRes));

        // Tracking: Vue de la page catalogue via l'événement personnalisé
        track('catalog_view', { 
          productsCount: extractData(productsRes).length, 
          formulasCount: formulasData.length 
        });
      } catch (err) {
        console.error('Erreur chargement catalogue:', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [track]);

  // Masquage temps réel : suit les (dés)activations/suppressions faites par le gérant
  useEffect(() => {
    const onFormula = (f) => setFormulas(prev => upsertAvailable(prev, f));
    const onFormulaDel = (e) => setFormulas(prev => removeFromList(prev, e));
    const onProduct = (p) => setAllProducts(prev => upsertAvailable(prev, p));
    const onProductDel = (e) => setAllProducts(prev => removeFromList(prev, e));
    const onDish = (d) => setDishes(prev => upsertAvailable(prev, d));
    const onDishDel = (e) => setDishes(prev => removeFromList(prev, e));
    const onTea = (t) => setBubbleTeas(prev => upsertAvailable(prev, t));
    const onTeaDel = (e) => setBubbleTeas(prev => removeFromList(prev, e));
    const onShake = (m) => setMilkshakes(prev => upsertAvailable(prev, m));
    const onShakeDel = (e) => setMilkshakes(prev => removeFromList(prev, e));

    socket.on('formula_created', onFormula);
    socket.on('formula_updated', onFormula);
    socket.on('formula_deleted', onFormulaDel);
    socket.on('product_created', onProduct);
    socket.on('product_updated', onProduct);
    socket.on('product_availability_toggled', onProduct);
    socket.on('product_deleted', onProductDel);
    socket.on('dish_created', onDish);
    socket.on('dish_updated', onDish);
    socket.on('dish_deleted', onDishDel);
    socket.on('bubbletea_created', onTea);
    socket.on('bubbletea_updated', onTea);
    socket.on('bubbletea_deleted', onTeaDel);
    socket.on('milkshake_created', onShake);
    socket.on('milkshake_updated', onShake);
    socket.on('milkshake_deleted', onShakeDel);
    return () => {
      socket.off('formula_created', onFormula);
      socket.off('formula_updated', onFormula);
      socket.off('formula_deleted', onFormulaDel);
      socket.off('product_created', onProduct);
      socket.off('product_updated', onProduct);
      socket.off('product_availability_toggled', onProduct);
      socket.off('product_deleted', onProductDel);
      socket.off('dish_created', onDish);
      socket.off('dish_updated', onDish);
      socket.off('dish_deleted', onDishDel);
      socket.off('bubbletea_created', onTea);
      socket.off('bubbletea_updated', onTea);
      socket.off('bubbletea_deleted', onTeaDel);
      socket.off('milkshake_created', onShake);
      socket.off('milkshake_updated', onShake);
      socket.off('milkshake_deleted', onShakeDel);
    };
  }, []);

  // Mise à jour temps réel de l'arbre de catégories (gérant).
  useEffect(() => {
    const reload = async () => {
      try {
        const res = await fetchProductCategories();
        const data = Array.isArray(res.data) ? res.data
          : (res.data && Array.isArray(res.data.data) ? res.data.data : []);
        setProductCategories(data);
      } catch (err) {
        console.error('Erreur rechargement catégories:', err);
      }
    };
    socket.on('product_category_created', reload);
    socket.on('product_category_updated', reload);
    socket.on('product_category_deleted', reload);
    return () => {
      socket.off('product_category_created', reload);
      socket.off('product_category_updated', reload);
      socket.off('product_category_deleted', reload);
    };
  }, []);

  const toggleCat = (id) => setOpenCats(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Index de l'arbre : enfants par parentId, produits par categoryId.
  const childrenByParent = {};
  productCategories.forEach(cat => {
    const key = cat.parentId || 'root';
    if (!childrenByParent[key]) childrenByParent[key] = [];
    childrenByParent[key].push(cat);
  });
  const productsByCatId = {};
  allProducts.forEach(p => {
    if (p.categoryId) {
      if (!productsByCatId[p.categoryId]) productsByCatId[p.categoryId] = [];
      productsByCatId[p.categoryId].push(p);
    }
  });
  // Racines d'une catégorie fixe (drink/coffee/dessert/side), disponibles et triées.
  const rootsForCategory = (fixedCategory) => sortNodes(
    (childrenByParent['root'] || []).filter(n => n.rootCategory === fixedCategory && n.isAvailable !== false)
  );

  const handleFormulaClick = (formula) => {
    // Tracking: Sélection de formule depuis catalogue
    trackFormulaSelection(formula);
    
    startOrder(formula);
    navigate('/configurator');
  };

  const handleProductClick = (product) => {
    // Produit avec suppléments → modale de sélection ; sinon ajout direct.
    if (product.extras?.length) {
      setExtrasProduct(product);
      return;
    }
    addProductToCart(product);
    track('product_added_unit', { productId: product._id, productName: product.name, price: product.price });
  };

  /**
   * Vue d'un univers « configurable » (Boissons, Plaisirs Sucrés) :
   * configurateurs en grille en haut, catégories du gérant en accordéon replié,
   * puis les produits non classés dans une section dépliable.
   */
  const renderConfigurableUniverse = ({ rootCategories, configTitle, configItems, renderConfigCard, otherLabel, otherKey, emptyTitle, emptySubtitle, hideRootNames }) => {
    // Masque certaines catégories racines par nom (ex: "Bubble Tea" — doublon de la grille configurable).
    const hidden = new Set((hideRootNames || []).map(n => n.trim().toLowerCase()));
    const roots = rootCategories
      .flatMap(rc => rootsForCategory(rc))
      .filter(n => !hidden.has(String(n.name || '').trim().toLowerCase()));
    const unclassified = allProducts
      .filter(p => rootCategories.includes(p.category) && !p.categoryId)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    const isEmpty = configItems.length === 0 && roots.length === 0 && unclassified.length === 0;
    const otherOpen = openCats.has(otherKey);

    return (
      <div>
        {isEmpty ? (
          <div className="text-center py-20">
            <p className="text-2xl font-serif text-brand-700 mb-4">{emptyTitle}</p>
            <p className="text-gray-500">{emptySubtitle}</p>
          </div>
        ) : (
          <>
            {/* Configurateurs (bubble teas / milkshakes) — toujours visibles en grille */}
            {configItems.length > 0 && (
              <div className="mb-12">
                <h3 className="text-2xl font-serif font-bold text-gray-900 mb-6">{configTitle}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {configItems.map(renderConfigCard)}
                </div>
              </div>
            )}

            {/* Catégories du gérant (accordéon replié) */}
            {roots.length > 0 && (
              <div className="mb-8">
                {roots.map(node => (
                  <CategoryNode
                    key={node.id}
                    node={node}
                    depth={0}
                    childrenByParent={childrenByParent}
                    productsByCatId={productsByCatId}
                    openCats={openCats}
                    toggle={toggleCat}
                    onProductClick={handleProductClick}
                  />
                ))}
              </div>
            )}

            {/* Produits non classés : section dépliable */}
            {unclassified.length > 0 && (
              <div className="mb-3">
                <div
                  {...clickable(() => toggleCat(otherKey))}
                  className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-gray-200 shadow-sm hover:border-brand-300 hover:shadow transition-all"
                >
                  <Icon name={otherOpen ? 'arrow-down' : 'arrow-right'} className="text-brand-600 text-lg" />
                  <span className="flex-grow font-serif font-bold text-gray-900 text-xl">{otherLabel}</span>
                  <span className="text-sm text-gray-500">{unclassified.length} produit{unclassified.length > 1 ? 's' : ''}</span>
                </div>
                {otherOpen && (
                  <div className="pl-4 md:pl-6 mt-3 border-l-2 border-gray-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-4">
                      {unclassified.map(product => (
                        <ProductCard
                          key={product._id}
                          product={product}
                          isSelected={false}
                          onClick={() => handleProductClick(product)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <div className="mt-8 text-center">
          <button
            onClick={() => setSelectedUniverse(null)}
            className="px-6 py-3 bg-brand-700 text-ivory rounded-lg hover:bg-brand-800 transition-colors"
          >
            ← Retour aux univers
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center text-gray-900 tracking-widest font-bold">
        CHARGEMENT DU CATALOGUE...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans text-gray-900 selection:bg-brand-200 selection:text-brand-900 pt-8 pb-24 filigrane relative">
      {/* Hero de la page */}
      <section className="container mx-auto px-4 py-12 text-center">
        <h1 className="text-5xl md:text-6xl font-serif font-bold text-gray-900 mb-6">
          Nos <span className="text-brand-600">Produits</span>
        </h1>
      </section>

      {/* Section Formules avec navigation à 2 niveaux */}
      {selectedUniverse === null ? (
        // Niveau 1 : Sélecteur d'Univers
        <section id="formulas" className="container mx-auto px-4 py-16 relative z-10">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-serif font-bold text-gray-900 mb-4">Choisissez votre univers</h2>
            <div className="w-20 h-1 bg-brand-500 mx-auto mt-6"></div>
          </div>

          {/* Grille des univers */}
          <ProductCategories onCategorySelect={handleCategorySelect} />
        </section>
      ) : (
        // Niveau 2 : Formules filtrées
        <section id="formulas" className="container mx-auto px-4 py-16">
          {/* Bouton retour */}
          <div className="mb-8">
            <button
              onClick={() => setSelectedUniverse(null)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
            >
              <Icon name="arrow-left" className="text-lg" />
              Retour aux univers
            </button>
          </div>

          <div className="text-center mb-12">
            <h2 className="text-4xl font-serif font-bold text-gray-900 mb-4">
              {UNIVERSES[selectedUniverse]?.title || 'Nos Formules'}
            </h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              {UNIVERSES[selectedUniverse]?.description || 'Choisissez une formule et personnalisez‑la selon vos envies.'}
            </p>
            <div className="w-20 h-1 bg-brand-500 mx-auto mt-6"></div>
          </div>

          {/* Carte des boissons : bubble teas en grille, puis catégories en accordéon (repliées) */}
          {selectedUniverse === 'drinks' && renderConfigurableUniverse({
            rootCategories: ['drink', 'coffee'],
            configTitle: 'Bubble Teas',
            configItems: [...bubbleTeas].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
            renderConfigCard: (tea) => <BubbleTeaCard key={tea._id} tea={tea} onClick={setSelectedTea} />,
            otherLabel: 'Autres boissons',
            otherKey: '__drink_other__',
            emptyTitle: 'Nos boissons arrivent bientôt',
            emptySubtitle: 'Découvrez prochainement notre carte de boissons fraîches.',
            hideRootNames: ['Bubble Tea', 'Bubble Teas'],
          })}

          {/* Plaisirs Sucrés : milkshakes en grille, puis catégories de desserts en accordéon */}
          {selectedUniverse === 'desserts' && renderConfigurableUniverse({
            rootCategories: ['dessert'],
            configTitle: 'Milkshakes',
            configItems: [...milkshakes].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
            renderConfigCard: (ms) => <MilkshakeCard key={ms._id} ms={ms} onClick={setSelectedMilkshake} />,
            otherLabel: 'Autres desserts',
            otherKey: '__dessert_other__',
            emptyTitle: 'Nos desserts arrivent bientôt',
            emptySubtitle: 'Découvrez prochainement nos douceurs gourmandes.',
          })}

          {/* Grille des plats chauds */}
          {selectedUniverse === 'hot_dish' && (
            <div>
              {dishes.length === 0 ? (
                <div className="text-center py-20">
                  <p className="text-2xl font-serif text-brand-700 mb-4">Nos plats arrivent bientôt</p>
                  <p className="text-wood/70">Découvrez prochainement notre carte de plats antillais.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {[...dishes]
                    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
                    .map(dish => (
                      <DishCard key={dish._id} dish={dish} />
                    ))}
                </div>
              )}

              <div className="mt-8 text-center">
                <button
                  onClick={() => setSelectedUniverse(null)}
                  className="px-6 py-3 bg-brand-700 text-ivory rounded-lg hover:bg-brand-800 transition-colors"
                >
                  ← Retour aux univers
                </button>
              </div>
            </div>
          )}

          {/* Grille des formules filtrées */}
          {selectedUniverse !== 'hot_dish' && selectedUniverse !== 'drinks' && selectedUniverse !== 'desserts' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredFormulas.map((formula) => (
                  <div
                    key={formula._id}
                    {...clickable(() => handleFormulaClick(formula))}
                    className="group relative bg-white rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-500 cursor-pointer transform hover:-translate-y-2 border border-gray-100"
                  >
                    {/* Badge Type avec icône */}
                    <div className="absolute top-4 left-4 px-4 py-2 rounded-full font-bold text-xs uppercase tracking-wider z-10 shadow-lg flex items-center gap-2 bg-brand-600 text-white">
                      <Icon name="salad" className="text-sm" />
                      Salade
                    </div>

                    {/* Badge Prix */}
                    <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm text-gray-900 px-4 py-2 rounded-full font-serif text-xl font-bold z-10 shadow-lg">
                      {formula.base_price}€
                    </div>

                    {/* Image */}
                    <div className="h-48 overflow-hidden bg-gray-100">
                      {formula.image ? (
                        <img
                          src={formula.image}
                          alt={formula.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-r from-gray-100 to-gray-200 text-gray-400">
                          <Icon name="rice" className="text-6xl" />
                        </div>
                      )}
                    </div>

                    {/* Contenu */}
                    <div className="p-6">
                      <h3 className="text-2xl font-serif font-bold text-gray-900 mb-2">{formula.name}</h3>
                      <p className="text-gray-600 text-sm mb-4">{formula.description}</p>

                      {/* Badges Limites */}
                      <div className="flex flex-wrap gap-2 mb-6">
                        {Object.entries(formula.limits).map(([key, value]) => (
                          value > 0 && (
                            <span key={key} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">
                              {value} {key}
                            </span>
                          )
                        ))}
                      </div>

                      {/* Bouton */}
                      <button className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold uppercase tracking-widest text-xs group-hover:bg-brand-600 transition-all duration-300">
                        Personnaliser cette formule
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Message si aucune formule */}
              {filteredFormulas.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-gray-400 text-lg">Aucune formule disponible pour cet univers.</p>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Bouton flottant panier à l'unité */}
      {cartCount > 0 && (
        <button
          onClick={() => navigate('/summary')}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-6 py-4 bg-brand-600 text-white rounded-full font-bold shadow-2xl hover:bg-brand-700 transition-all"
        >
          <span className="flex items-center justify-center w-7 h-7 bg-white/25 rounded-full text-sm">{cartCount}</span>
          Voir mon panier
          <span className="font-mono">{cartTotal.toFixed(2)} €</span>
        </button>
      )}

      {/* Modale de composition d'un bubble tea */}
      {selectedTea && (
        <BubbleTeaModal tea={selectedTea} onClose={() => setSelectedTea(null)} />
      )}

      {/* Modale de composition d'un milkshake */}
      {selectedMilkshake && (
        <MilkshakeModal ms={selectedMilkshake} onClose={() => setSelectedMilkshake(null)} />
      )}

      {/* Modale de sélection des suppléments d'un produit */}
      {extrasProduct && (
        <ProductExtrasModal
          product={extrasProduct}
          onClose={() => setExtrasProduct(null)}
          onConfirm={(product, selectedExtras) => {
            addProductToCart(product, selectedExtras);
            track('product_added_unit', { productId: product._id, productName: product.name, price: product.price });
          }}
        />
      )}

    </div>
  );
};

export default Products;
