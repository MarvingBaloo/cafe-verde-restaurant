/* eslint-disable react-refresh/only-export-components --
   Provider et hook `use…` vivent dans le même fichier : c'est le motif
   standard d'un contexte React. Les séparer ne gagnerait que le confort du
   rechargement à chaud en développement, au prix de dizaines d'imports. */
// src/context/ConfigContext.jsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import { socket } from '../socket';
import { useToast } from './ToastContext';

// 1. Création du Contexte
const ConfigContext = createContext();

// État initial pour une commande vide
const initialOrderState = {
  formula: null,
  ingredients: [],
  menu: null,
  products: [],
  dishes: [],
  formulaQuantity: 1, // quantité de la salade composée
  cartProducts: [], // produits achetés à l'unité (indépendants d'une formule), avec quantité
  bubbleTeas: [], // bubble teas composés [{ bubbleTeaId, name, price, selections, subtotal, quantity }]
  milkshakes: [], // milkshakes composés [{ milkshakeId, name, price, selections, subtotal, quantity }]
};



// 2. Création du Provider
export const ConfigProvider = ({ children }) => {
  const { toast } = useToast();

  // State pour la commande en cours
  const [order, setOrder] = useState(initialOrderState);

  // State pour le prix total, calculé dynamiquement
  const [totalPrice, setTotalPrice] = useState(0);

  // State pour les calories totales
  const [totalCalories, setTotalCalories] = useState(0);

  // States pour l'historique Undo/Redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // --- GESTION DU SOCKET (ÉCOUTE ÉVÉNEMENTS) ---
  useEffect(() => {
    const onIngredientUpdated = (updatedIngredient) => {
      if (updatedIngredient.isAvailable === false) {
        setOrder((currentOrder) => {
          const isPresentInIngredients = currentOrder.ingredients.some(ing => ing._id === updatedIngredient._id);
          if (isPresentInIngredients) {
            toast.warning(`L'ingrédient "${updatedIngredient.name}" n'est plus disponible et a été retiré de votre commande.`);
            const newIngredients = currentOrder.ingredients.filter(ing => ing._id !== updatedIngredient._id);
            return { ...currentOrder, ingredients: newIngredients };
          }
          return currentOrder;
        });
      }
    };

    socket.on('ingredient_updated', onIngredientUpdated);
    return () => {
      socket.off('ingredient_updated', onIngredientUpdated);
    };
  }, []);


  /**
   * Fonction pour enrichir un ingrédient avec des calories fictives (Fallback si pas de DB)
   * Note: En Phase 2/3, on utilise les données DB, cette fonction sert de sécurité.
   */
  const enrichIngredientWithCalories = (ingredient) => {
    if (ingredient.nutritional_info && ingredient.nutritional_info.calories > 0) {
        return ingredient;
    }
    // Fallback si la donnée manque (ancien ingrédient ou erreur de seed)
    if (!ingredient.calories) {
      ingredient.calories = 50; // Valeur par défaut
    }
    return ingredient;
  };

  /**
   * Sauvegarde l'état actuel dans l'historique pour undo/redo
   * Limite à 20 états pour éviter la surcharge mémoire
   */
  const saveToHistory = (newOrder) => {
    // Clone profond pour éviter les références
    const orderSnapshot = JSON.parse(JSON.stringify(newOrder));
    
    // Couper l'historique après l'index actuel (si on a undo puis fait une nouvelle action)
    const newHistory = history.slice(0, historyIndex + 1);
    
    // Ajouter le nouvel état
    newHistory.push(orderSnapshot);
    
    // Limiter à 20 états max
    if (newHistory.length > 20) {
      newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    } else {
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  /**
   * Annuler la dernière action (Undo)
   */
  const undo = () => {
    if (historyIndex > 0) {
      const previousState = history[historyIndex - 1];
      setOrder(previousState);
      setHistoryIndex(historyIndex - 1);
    }
  };

  /**
   * Refaire l'action annulée (Redo)
   */
  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextState = history[historyIndex + 1];
      setOrder(nextState);
      setHistoryIndex(historyIndex + 1);
    }
  };

  /**
   * Démarre une nouvelle commande en enregistrant la formule choisie.
   * 🆕 Accepte désormais une liste d'ingrédients initiaux (pour le Mood Food).
   * @param {object} formula - L'objet complet de la formule sélectionnée.
   * @param {Array} initialIngredients - (Optionnel) Ingrédients pré-sélectionnés par l'IA.
   */
  const startOrder = (formula, initialIngredients = []) => {
    // Si on a des ingrédients initiaux, on s'assure qu'ils ont les infos caloriques
    const processedIngredients = initialIngredients.map(ing => 
        enrichIngredientWithCalories({ ...ing })
    );

    setOrder({
      ...initialOrderState,
      formula: formula,
      ingredients: processedIngredients
    });
  };

  /**
   * Ajoute ou retire un ingrédient de la commande.
   * @param {object} ingredient - L'ingrédient à manipuler.
   */
  const toggleIngredient = (ingredient) => {
    if (!order.formula) return;

    // Sécurité Stock côté client au clic
    if (ingredient.isAvailable === false) {
        toast.warning("Cet ingrédient est en rupture de stock.");
        return;
    }

    // Table de mappage pour lier les catégories d'ingrédients aux clés de l'objet 'limits'
    const categoryToLimitKey = {
      base_salade: 'base',
      proteine: 'protein',
      topping_legume: 'topping',
      topping_fruit: 'topping',
      sauce: 'sauce',
    };

    setOrder(currentOrder => {
      const isSelected = currentOrder.ingredients.some(i => i._id === ingredient._id);
      let newIngredients = [...currentOrder.ingredients];
      
      const limitKey = categoryToLimitKey[ingredient.category];
      const limit = currentOrder.formula.limits[limitKey] || 1;

      if (isSelected) {
        // Retirer l'ingrédient s'il est déjà sélectionné
        newIngredients = newIngredients.filter(i => i._id !== ingredient._id);
      } else {
        if (limit === 1) {
          // Si la limite est 1, on remplace l'ingrédient existant dans le même groupe
          const otherIngredients = newIngredients.filter(
            i => categoryToLimitKey[i.category] !== limitKey
          );
          newIngredients = [...otherIngredients, ingredient];
        } else {
          // Toujours autoriser — les suppléments au-delà de la limite sont facturés automatiquement
          newIngredients.push(ingredient);
        }
      }
      
      const updatedOrder = { ...currentOrder, ingredients: newIngredients };
      saveToHistory(updatedOrder);
      return updatedOrder;
    });
  };

  /**
   * Sélectionne un menu.
   * @param {object} menu - Le menu sélectionné.
   */
  const setMenu = (menu) => {
    setOrder(currentOrder => {
      const updatedOrder = { ...currentOrder, menu, products: [] };
      saveToHistory(updatedOrder);
      return updatedOrder;
    });
  };

  /**
   * Ajoute ou retire un produit (boisson/dessert).
   * @param {object} product - Le produit à manipuler.
   */
  const toggleProduct = (product) => {
    setOrder(currentOrder => {
      const isSelected = currentOrder.products.some(p => p._id === product._id);
      let newProducts = [...currentOrder.products];

      // --- LOGIQUE OU EXCLUSIF (une boisson OU un dessert) ---
      if (currentOrder.menu?.selectionMode === 'or') {
        if (isSelected) {
            // Si on clique sur un produit déjà sélectionné, on le retire (panier vide)
            newProducts = [];
        } else {
            // Si on clique sur un nouveau produit, ON REMPLACE TOUT
            // Cela garantit qu'on a soit une boisson, soit un dessert, jamais les deux
            newProducts = [product];
        }
        const updatedOrder = { ...currentOrder, products: newProducts };
        saveToHistory(updatedOrder);
        return updatedOrder;
      }

      // --- LOGIQUE STANDARD (MENU XL ou autre) ---
      if (isSelected) {
        newProducts = newProducts.filter(p => p._id !== product._id);
      } else {
        // Vérification des inclusions du menu
        const canAddDrink = currentOrder.menu?.includes.drink;
        const canAddDessert = currentOrder.menu?.includes.dessert;
        
        // Compter les existants
        const drinksCount = newProducts.filter(p => p.category === 'drink').length;
        const dessertsCount = newProducts.filter(p => p.category === 'dessert').length;

        if (product.category === 'drink' && canAddDrink && drinksCount < 1) {
            newProducts.push(product);
        } else if (product.category === 'dessert' && canAddDessert && dessertsCount < 1) {
            newProducts.push(product);
        } else {
            // Si on essaie d'ajouter un 2ème produit de la même catégorie, on remplace l'ancien
            // (Ex: J'ai Coca, je clique Sprite -> ça devient Sprite)
            if (product.category === 'drink' && canAddDrink) {
                 newProducts = newProducts.filter(p => p.category !== 'drink');
                 newProducts.push(product);
            } else if (product.category === 'dessert' && canAddDessert) {
                 newProducts = newProducts.filter(p => p.category !== 'dessert');
                 newProducts.push(product);
            }
        }
      }
      const updatedOrder = { ...currentOrder, products: newProducts };
      saveToHistory(updatedOrder);
      return updatedOrder;
    });
  };

  /**
   * Ajoute un plat chaud à la commande avec les accompagnements choisis.
   * @param {object} dish - L'objet plat complet.
   * @param {Array} selectedSides - Accompagnements sélectionnés [{name, priceAddition}].
   */
  const addDishToOrder = (dish, selectedSides = [], menu = null, menuProducts = []) => {
    const sidesTotal = selectedSides.reduce((sum, s) => sum + (s.priceAddition || 0), 0);
    const isUpgrade = menu && menu.name !== 'Solo' && menu.name !== 'Sans Menu';
    const menuExtra = isUpgrade
      ? (menu.price_addition || 0) + (menuProducts || []).reduce((sum, p) => sum + (p.menu_surcharge || 0), 0)
      : 0;
    const subtotal = dish.price + sidesTotal + menuExtra;
    const dishItem = {
      dishId: dish._id,
      name: dish.name,
      price: dish.price,
      selectedSides,
      menu: isUpgrade ? menu : null,
      menuProducts: isUpgrade ? menuProducts : [],
      subtotal,
      quantity: 1
    };
    setOrder(prev => ({
      ...prev,
      dishes: [...(prev.dishes || []), dishItem]
    }));
  };

  /**
   * Ajoute un bubble tea composé à la commande.
   * @param {object} tea - L'objet bubble tea complet (avec prix de base).
   * @param {Array} selections - Ingrédients choisis [{ category, name, supplementPrice }].
   */
  const addBubbleTeaToOrder = (tea, selections = []) => {
    const supplementsTotal = selections.reduce((sum, s) => sum + (s.supplementPrice || 0), 0);
    const subtotal = (tea.price || 0) + supplementsTotal;
    const item = {
      bubbleTeaId: tea._id,
      name: tea.name,
      price: tea.price || 0,
      selections,
      subtotal,
      quantity: 1,
    };
    setOrder(prev => ({
      ...prev,
      bubbleTeas: [...(prev.bubbleTeas || []), item]
    }));
  };

  /**
   * Ajuste la quantité d'un bubble tea par son index (+1 / -1). À 0, retire la ligne.
   */
  const incrementBubbleTea = (index) => {
    setOrder(prev => ({
      ...prev,
      bubbleTeas: (prev.bubbleTeas || []).map((b, i) => i === index ? { ...b, quantity: (b.quantity || 1) + 1 } : b)
    }));
  };
  const decrementBubbleTea = (index) => {
    setOrder(prev => ({
      ...prev,
      bubbleTeas: (prev.bubbleTeas || [])
        .map((b, i) => i === index ? { ...b, quantity: (b.quantity || 1) - 1 } : b)
        .filter(b => b.quantity > 0)
    }));
  };

  /**
   * Retire un bubble tea de la commande par son index.
   */
  const removeBubbleTeaFromOrder = (index) => {
    setOrder(prev => ({
      ...prev,
      bubbleTeas: (prev.bubbleTeas || []).filter((_, i) => i !== index)
    }));
  };

  /**
   * Ajoute un milkshake composé à la commande.
   * @param {object} shake - L'objet milkshake complet (avec prix de base).
   * @param {Array} selections - Ingrédients choisis [{ category, name, supplementPrice }].
   */
  const addMilkshakeToOrder = (shake, selections = []) => {
    const supplementsTotal = selections.reduce((sum, s) => sum + (s.supplementPrice || 0), 0);
    const subtotal = (shake.price || 0) + supplementsTotal;
    const item = {
      milkshakeId: shake._id,
      name: shake.name,
      price: shake.price || 0,
      selections,
      subtotal,
      quantity: 1,
    };
    setOrder(prev => ({
      ...prev,
      milkshakes: [...(prev.milkshakes || []), item]
    }));
  };

  /**
   * Ajuste la quantité d'un milkshake par son index (+1). À 0, retire la ligne.
   */
  const incrementMilkshake = (index) => {
    setOrder(prev => ({
      ...prev,
      milkshakes: (prev.milkshakes || []).map((m, i) => i === index ? { ...m, quantity: (m.quantity || 1) + 1 } : m)
    }));
  };
  const decrementMilkshake = (index) => {
    setOrder(prev => ({
      ...prev,
      milkshakes: (prev.milkshakes || [])
        .map((m, i) => i === index ? { ...m, quantity: (m.quantity || 1) - 1 } : m)
        .filter(m => m.quantity > 0)
    }));
  };

  /**
   * Retire un milkshake de la commande par son index.
   */
  const removeMilkshakeFromOrder = (index) => {
    setOrder(prev => ({
      ...prev,
      milkshakes: (prev.milkshakes || []).filter((_, i) => i !== index)
    }));
  };

  /**
   * Ajuste la quantité de la salade composée (+1 / -1). À 0, retire la salade.
   */
  const incrementFormula = () => {
    setOrder(prev => prev.formula ? { ...prev, formulaQuantity: (prev.formulaQuantity || 1) + 1 } : prev);
  };
  const decrementFormula = () => {
    setOrder(prev => {
      if (!prev.formula) return prev;
      const q = (prev.formulaQuantity || 1) - 1;
      if (q <= 0) {
        return { ...prev, formula: null, ingredients: [], menu: null, products: [], formulaQuantity: 1 };
      }
      return { ...prev, formulaQuantity: q };
    });
  };

  /**
   * Ajuste la quantité d'un plat chaud par son index (+1 / -1). À 0, retire la ligne.
   */
  const incrementDish = (index) => {
    setOrder(prev => ({
      ...prev,
      dishes: (prev.dishes || []).map((d, i) => i === index ? { ...d, quantity: (d.quantity || 1) + 1 } : d)
    }));
  };
  const decrementDish = (index) => {
    setOrder(prev => ({
      ...prev,
      dishes: (prev.dishes || [])
        .map((d, i) => i === index ? { ...d, quantity: (d.quantity || 1) - 1 } : d)
        .filter(d => d.quantity > 0)
    }));
  };

  /**
   * Retire un plat chaud de la commande par son index.
   * @param {number} index - Index du plat dans order.dishes.
   */
  const removeDishFromOrder = (index) => {
    setOrder(prev => ({
      ...prev,
      dishes: prev.dishes.filter((_, i) => i !== index)
    }));
  };

  /**
   * Identifiant de ligne panier : un même produit avec des extras différents = 2 lignes distinctes.
   * Sans extra → `${_id}::` (fusion à l'identique préservée, zéro régression).
   */
  const productLineId = (productId, selectedExtras = []) =>
    `${productId}::${(selectedExtras || []).map(e => e.name).sort().join('|')}`;

  /**
   * Ajoute un produit au panier à l'unité (ou incrémente la ligne identique s'il y est déjà).
   * @param {object} product - Le produit (boisson, dessert, side) avec son prix de base.
   * @param {Array} selectedExtras - Suppléments choisis [{ name, price }] (facultatif).
   */
  const addProductToCart = (product, selectedExtras = []) => {
    const extrasTotal = (selectedExtras || []).reduce((sum, e) => sum + (e.price || 0), 0);
    const lineId = productLineId(product._id, selectedExtras);
    setOrder(prev => {
      const existing = (prev.cartProducts || []).find(p => p.lineId === lineId);
      let cartProducts;
      if (existing) {
        cartProducts = prev.cartProducts.map(p =>
          p.lineId === lineId ? { ...p, quantity: p.quantity + 1 } : p
        );
      } else {
        cartProducts = [...(prev.cartProducts || []), {
          ...product,
          lineId,
          selectedExtras: selectedExtras || [],
          basePrice: product.price || 0,
          price: (product.price || 0) + extrasTotal, // prix unitaire ajusté (base + extras)
          quantity: 1,
        }];
      }
      return { ...prev, cartProducts };
    });
    toast.success(`${product.name} ajouté au panier`);
  };

  /**
   * Incrémente la quantité d'une ligne panier existante (+1).
   * @param {string} lineId
   */
  const incrementProductInCart = (lineId) => {
    setOrder(prev => ({
      ...prev,
      cartProducts: (prev.cartProducts || []).map(p =>
        p.lineId === lineId ? { ...p, quantity: p.quantity + 1 } : p
      )
    }));
  };

  /**
   * Diminue la quantité d'une ligne panier (la retire si quantité atteint 0).
   * @param {string} lineId
   */
  const decrementProductInCart = (lineId) => {
    setOrder(prev => {
      const cartProducts = (prev.cartProducts || [])
        .map(p => p.lineId === lineId ? { ...p, quantity: p.quantity - 1 } : p)
        .filter(p => p.quantity > 0);
      return { ...prev, cartProducts };
    });
  };

  /**
   * Retire complètement une ligne du panier à l'unité.
   * @param {string} lineId
   */
  const removeProductFromCart = (lineId) => {
    setOrder(prev => ({
      ...prev,
      cartProducts: (prev.cartProducts || []).filter(p => p.lineId !== lineId)
    }));
  };

  /**
   * Réinitialise complètement la commande à son état initial.
   */
  const resetOrder = () => {
    setOrder(initialOrderState);
  };

  // LOGIQUE DE PRIX
  useEffect(() => {
    let newTotal = 0;

    // --- Partie Salade (sous-total unitaire × quantité) ---
    if (order.formula) {
      let saladeSubtotal = order.formula.base_price;
      const ingredientCounts = {};

      order.ingredients.forEach(ing => {
        const categoryToLimitKey = {
          base_salade: 'base',
          proteine: 'protein',
          topping_legume: 'topping',
          topping_fruit: 'topping',
          sauce: 'sauce',
        };
        const key = categoryToLimitKey[ing.category];
        if (key) ingredientCounts[key] = (ingredientCounts[key] || 0) + 1;
        saladeSubtotal += (ing.extra_price || 0);
      });

      for (const category in ingredientCounts) {
        const count = ingredientCounts[category];
        const limit = order.formula.limits[category] || 0;
        if (count > limit) saladeSubtotal += (count - limit) * order.formula.extra_cost_per_component;
      }

      if (order.menu) {
        saladeSubtotal += (order.menu.price_addition || 0);
        order.products.forEach(p => { saladeSubtotal += (p.menu_surcharge || 0); });
      }

      newTotal += saladeSubtotal * (order.formulaQuantity || 1);
    }

    // --- Partie Plats Chauds (sous-total unitaire × quantité) ---
    (order.dishes || []).forEach(d => { newTotal += (d.subtotal || 0) * (d.quantity || 1); });

    // --- Partie Produits à l'unité ---
    (order.cartProducts || []).forEach(p => { newTotal += (p.price || 0) * (p.quantity || 1); });

    // --- Partie Bubble Teas (sous-total unitaire × quantité) ---
    (order.bubbleTeas || []).forEach(b => { newTotal += (b.subtotal || 0) * (b.quantity || 1); });

    // --- Partie Milkshakes (sous-total unitaire × quantité) ---
    (order.milkshakes || []).forEach(m => { newTotal += (m.subtotal || 0) * (m.quantity || 1); });

    // Dette assumée : totalPrice est un état dérivé du panier, qui devrait être calculé
    // pendant le rendu (useMemo) plutôt que dans un effet. Le refactor touche le CALCUL
    // DU PRIX, consommé par le récapitulatif, le panier et la caisse — il demande sa
    // propre session et une vérification de bout en bout, pas un coup de linter.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTotalPrice(newTotal);
  }, [order]);

  // LOGIQUE DE CALCUL DES CALORIES TOTALES
  useEffect(() => {
    if (!order.formula) {
      // Même dette que totalPrice ci-dessus : état dérivé calculé dans un effet.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTotalCalories(0);
      return;
    }

    // Calories des ingrédients sélectionnés depuis la base de données
    const caloriesFromIngredients = order.ingredients.reduce((sum, ing) => {
      // Utilise nutritional_info.calories depuis la DB, avec fallback sécurisé
      const calories = ing.nutritional_info?.calories || 0;
      return sum + calories;
    }, 0);

    // Calories des produits (boissons/desserts) depuis la base de données
    const caloriesFromProducts = order.products.reduce((sum, product) => {
      // Utilise nutritional_info.calories depuis la DB, avec fallback sécurisé
      const calories = product.nutritional_info?.calories || 0;
      return sum + calories;
    }, 0);

    setTotalCalories(caloriesFromIngredients + caloriesFromProducts);
  }, [order]);

  const value = {
    order,
    totalPrice,
    totalCalories,
    startOrder,
    toggleIngredient,
    setMenu,
    toggleProduct,
    addDishToOrder,
    removeDishFromOrder,
    addBubbleTeaToOrder,
    incrementBubbleTea,
    decrementBubbleTea,
    removeBubbleTeaFromOrder,
    addMilkshakeToOrder,
    incrementMilkshake,
    decrementMilkshake,
    removeMilkshakeFromOrder,
    incrementFormula,
    decrementFormula,
    incrementDish,
    decrementDish,
    addProductToCart,
    incrementProductInCart,
    decrementProductInCart,
    removeProductFromCart,
    resetOrder,
    socket,
    undo,
    redo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
  };

  return (
    <ConfigContext.Provider value={value}>
      {children}
    </ConfigContext.Provider>
  );
};

// 3. Hook personnalisé
export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig doit être utilisé au sein d\'un ConfigProvider');
  }
  return context;
};