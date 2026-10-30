import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchDishes, fetchMenus, fetchProducts } from '../services/api';
import { socket } from '../socket';
import { useConfig } from '../context/ConfigContext';
import { getImageUrl } from '../utils/imageUtils';
import { useToast } from '../context/ToastContext';
import Icon from '../components/Icon';

const DishDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addDishToOrder } = useConfig();
  const { toast } = useToast();
  const [dish, setDish] = useState(null);
  const [selectedSides, setSelectedSides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menus, setMenus] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedMenu, setSelectedMenu] = useState(null);
  const [menuProducts, setMenuProducts] = useState([]);

  useEffect(() => {
    fetchDishes()
      .then(res => {
        const found = (Array.isArray(res.data) ? res.data : []).find(d => d._id === id);
        // Un plat désactivé par le gérant est traité comme introuvable côté client
        setDish(found && found.isAvailable !== false ? found : null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  // Menus (Solo/L/XL) + produits inclus (boissons/desserts) pour transformer le plat en menu
  useEffect(() => {
    const ex = r => Array.isArray(r.data) ? r.data
      : Array.isArray(r.data?.data) ? r.data.data
      : Array.isArray(r.data?.message) ? r.data.message : [];
    Promise.all([fetchMenus(), fetchProducts()])
      .then(([mRes, pRes]) => {
        const liste = ex(mRes).sort((a, b) => (a.price_addition || 0) - (b.price_addition || 0));
        setMenus(liste);
        setProducts(ex(pRes).filter(p => p.isAvailable !== false));
        // Sélection par défaut posée ici, à l'arrivée des données : la faire dans un
        // effet séparé provoquait un rendu de plus, avec un état transitoire sans menu.
        if (liste.length) setSelectedMenu(liste.find(m => m.name === 'Solo') || liste[0]);
      })
      .catch(console.error);
  }, []);

  // Masquage temps réel : si le gérant désactive/supprime ce plat pendant la visite
  useEffect(() => {
    const onUpdated = (d) => {
      if ((d._id || d.id) === id) setDish(d.isAvailable !== false ? d : null);
    };
    const onDeleted = (e) => {
      if ((e._id || e.id) === id) setDish(null);
    };
    socket.on('dish_updated', onUpdated);
    socket.on('dish_deleted', onDeleted);
    return () => {
      socket.off('dish_updated', onUpdated);
      socket.off('dish_deleted', onDeleted);
    };
  }, [id]);

  if (loading) return <div className="text-center py-20 text-gray-600 font-bold tracking-widest">Chargement...</div>;
  if (!dish) return (
    <div className="text-center py-20">
      <p className="text-2xl text-wood mb-4">Plat introuvable</p>
      <Link to="/products" className="text-brand-700 underline">← Retour aux produits</Link>
    </div>
  );

  const toggleSide = (side) => {
    const isSelected = selectedSides.some(s => s.name === side.name);
    if (isSelected) {
      setSelectedSides(selectedSides.filter(s => s.name !== side.name));
    } else {
      if (selectedSides.length >= dish.maxSides) {
        toast.warning(`Maximum ${dish.maxSides} accompagnement${dish.maxSides > 1 ? 's' : ''} autorisé${dish.maxSides > 1 ? 's' : ''}`);
        return;
      }
      setSelectedSides([...selectedSides, side]);
    }
  };

  const sidesTotal = selectedSides.reduce((sum, s) => sum + (s.priceAddition || 0), 0);
  const isUpgradeMenu = selectedMenu && selectedMenu.name !== 'Solo' && selectedMenu.name !== 'Sans Menu';
  const menuExtra = isUpgradeMenu
    ? (selectedMenu.price_addition || 0) + menuProducts.reduce((s, p) => s + (p.menu_surcharge || 0), 0)
    : 0;
  const total = dish.price + sidesTotal + menuExtra;

  const selectMenu = (m) => { setSelectedMenu(m); setMenuProducts([]); };

  // Règles : mode 'or' = un seul produit (boisson OU dessert) ; mode 'and' = une boisson ET un dessert (max 1/catégorie)
  const toggleMenuProduct = (product) => {
    setMenuProducts(prev => {
      const sel = prev.some(p => p._id === product._id);
      if (selectedMenu?.selectionMode === 'or') return sel ? [] : [product];
      if (sel) return prev.filter(p => p._id !== product._id);
      const canAdd = product.category === 'drink' ? selectedMenu?.includes?.drink : selectedMenu?.includes?.dessert;
      if (!canAdd) return prev;
      return [...prev.filter(p => p.category !== product.category), product];
    });
  };

  const handleAddToCart = () => {
    addDishToOrder(dish, selectedSides, isUpgradeMenu ? selectedMenu : null, isUpgradeMenu ? menuProducts : []);
    navigate('/summary');
  };

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <Link to="/products" className="inline-block mb-6 text-brand-700 hover:text-brand-900 font-semibold">
        ← Retour aux plats
      </Link>

      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Image */}
        <div className="h-64 md:h-80 bg-gray-100 overflow-hidden">
          {dish.image ? (
            <img src={getImageUrl(dish.image)} alt={dish.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-7xl"><Icon name="dish" /></div>
          )}
        </div>

        <div className="p-6 md:p-10">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl md:text-4xl gelasio font-bold text-gray-900 mb-2">{dish.name}</h1>
              {dish.dietaryTags?.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {dish.dietaryTags.map(tag => (
                    <span key={tag} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">{tag}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="text-3xl gelasio font-bold text-cherry">{dish.price.toFixed(2)} €</div>
          </div>

          {/* Description */}
          {dish.description && (
            <p className="text-gray-600 mb-6">{dish.description}</p>
          )}

          {/* Accompagnements */}
          {dish.sides?.length > 0 && dish.maxSides > 0 && (
            <div className="mb-8">
              <h2 className="text-xl gelasio text-wood mb-2">Accompagnements</h2>
              <p className="text-sm text-stone-500 mb-4">
                Choisissez jusqu'à {dish.maxSides} accompagnement{dish.maxSides > 1 ? 's' : ''} ({selectedSides.length}/{dish.maxSides})
              </p>
              <div className="space-y-2">
                {dish.sides.map((side, idx) => {
                  const isSelected = selectedSides.some(s => s.name === side.name);
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleSide(side)}
                      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-brand-700 bg-brand-50'
                          : 'border-gray-200 hover:border-brand-300'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{side.name}</span>
                        <span className="text-sm text-stone-600">
                          {side.priceAddition > 0 ? `+${side.priceAddition.toFixed(2)} €` : 'Gratuit'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Transformer en menu */}
          {menus.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl gelasio text-wood mb-2">Transformer en menu</h2>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {menus.map(m => {
                  const active = selectedMenu?._id === m._id;
                  return (
                    <button key={m._id} onClick={() => selectMenu(m)}
                      className={`p-3 rounded-xl border-2 text-center transition-all ${active ? 'border-brand-600 bg-brand-50' : 'border-gray-200 hover:border-brand-300'}`}>
                      <p className="font-bold text-gray-800 text-sm">{m.name}</p>
                      <p className="text-brand-700 font-bold text-sm">{(m.price_addition || 0) > 0 ? `+${m.price_addition.toFixed(2)}€` : 'inclus'}</p>
                    </button>
                  );
                })}
              </div>
              {isUpgradeMenu && (
                <>
                  <p className="text-sm text-stone-500 mb-3">{selectedMenu.selectionMode === 'or' ? 'Une boisson OU un dessert' : 'Une boisson ET un dessert'}</p>
                  {['drink', 'dessert'].filter(cat => selectedMenu.includes?.[cat]).map(cat => (
                    <div key={cat} className="mb-4">
                      <h3 className="text-sm font-bold text-stone-600 mb-2">{cat === 'drink' ? 'Boissons' : 'Desserts'}</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {products.filter(p => p.category === cat && (selectedMenu.allowedProductIds?.length ? selectedMenu.allowedProductIds.includes(p._id) : true)).map(p => {
                          const sel = menuProducts.some(mp => mp._id === p._id);
                          return (
                            <button key={p._id} onClick={() => toggleMenuProduct(p)}
                              className={`p-2 rounded-lg border-2 text-sm font-semibold transition-all ${sel ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 hover:border-brand-300 text-gray-700'}`}>
                              {p.name}
                              {(p.menu_surcharge || 0) > 0 && <span className="block text-xs text-amber-600">+{p.menu_surcharge.toFixed(2)}€</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Total + CTA */}
          <div className="border-t pt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="text-xl font-bold text-wood">
              Total : <span className="text-cherry">{total.toFixed(2)} €</span>
            </div>
            <button
              onClick={handleAddToCart}
              className="px-8 py-4 bg-gray-900 text-white rounded-xl font-bold uppercase tracking-widest text-sm hover:bg-cherry transition-colors"
            >
              Ajouter au panier
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DishDetail;
