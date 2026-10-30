// src/pages/Configurator.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../context/ConfigContext';
import { fetchIngredients, fetchAiSuggestion } from '../services/api';
import IngredientCard from '../components/IngredientCard';
import VisualBuilder from '../components/VisualBuilder';
import AiAssistant from '../components/AiAssistant';
import SkeletonCard from '../components/SkeletonCard';
import MenuSelectionModal from '../components/modals/MenuSelectionModal';
import SupplementModal from '../components/modals/SupplementModal';
import { hapticIngredientToggle, HAPTIC_PATTERNS, vibrate } from '../utils/haptic';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { socket } from '../socket';

// --- DÉFINITION DES ÉTAPES DU WIZARD ---
// topping_legume et topping_fruit sont fusionnés sur une seule étape car ils partagent
// la même limite de formule ('topping'). Les séparer bloquerait le second step dès le départ.

const STEP_ORDER = [
  { category: 'base_salade',                      label: 'Votre base',     limitKey: 'base' },
  { category: 'proteine',                          label: 'Votre protéine', limitKey: 'protein' },
  { category: ['topping_legume', 'topping_fruit'], label: 'Vos toppings',   limitKey: 'topping' },
  { category: 'sauce',                             label: 'Votre sauce',    limitKey: 'sauce' },
];

// Mapping catégorie d'ingrédient → clé de limite dans la formule
const CATEGORY_TO_LIMIT_KEY = {
  base_salade:    'base',
  proteine:       'protein',
  topping_legume: 'topping',
  topping_fruit:  'topping',
  sauce:          'sauce'
};

const Configurator = () => {
  const navigate = useNavigate();
  const { order, toggleIngredient, totalPrice, totalCalories, setMenu } = useConfig();

  const {
    trackIngredientAdded,
    trackIngredientRemoved,
    trackAIInteraction
  } = useActivityTracker();

  const [availableIngredients, setAvailableIngredients] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notification, setNotification] = useState(null);

  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [isSupplementModalOpen, setIsSupplementModalOpen] = useState(false);

  // Chargement des ingrédients
  useEffect(() => {
    const loadIngredients = async () => {
      try {
        const response = await fetchIngredients();
        // Masque côté client tout ingrédient désactivé par le gérant (isAvailable === false)
        setAvailableIngredients((response.data || []).filter(ing => ing.isAvailable !== false));
      } catch (err) {
        setError('Erreur lors du chargement des ingrédients.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadIngredients();
  }, []);

  // Mise à jour temps réel de la disponibilité des ingrédients
  useEffect(() => {
    const handleIngredientUpdated = (updated) => {
      setAvailableIngredients(prev => {
        if (updated.isAvailable === false) {
          return prev.filter(ing => ing._id !== updated._id && ing.id !== updated._id);
        }
        const exists = prev.some(ing => ing._id === updated._id || ing.id === updated._id);
        if (exists) {
          return prev.map(ing =>
            (ing._id === updated._id || ing.id === updated._id) ? { ...ing, ...updated } : ing
          );
        }
        return [...prev, { ...updated, _id: updated._id || updated.id }];
      });
    };
    const handleIngredientDeleted = (e) => {
      const id = e._id || e.id;
      setAvailableIngredients(prev => prev.filter(ing => ing._id !== id && ing.id !== id));
    };
    socket.on('ingredient_updated', handleIngredientUpdated);
    socket.on('ingredient_deleted', handleIngredientDeleted);
    return () => {
      socket.off('ingredient_updated', handleIngredientUpdated);
      socket.off('ingredient_deleted', handleIngredientDeleted);
    };
  }, []);

  // Timer notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Garde de sécurité
  if (!order.formula) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 text-center px-4">
        <h1 className="text-2xl font-bold mb-2 text-gray-800">Panier Vide</h1>
        <button onClick={() => navigate('/')} className="bg-brand-600 text-white font-bold py-3 px-6 rounded-xl hover:bg-brand-700 transition">
          Choisir une formule
        </button>
      </div>
    );
  }

  // --- LOGIQUE METIER ---

  const currentStep = STEP_ORDER[currentStepIndex] ?? STEP_ORDER[STEP_ORDER.length - 1];

  // Ingrédients visibles : supporte catégorie string ou tableau (toppings)
  const filteredIngredients = availableIngredients.filter(ing =>
    Array.isArray(currentStep.category)
      ? currentStep.category.includes(ing.category)
      : ing.category === currentStep.category
  );

  // Limite de l'étape courante
  const limitKey = currentStep.limitKey;
  const limitMax = order.formula.limits[limitKey] || 0;

  // Compte de sélections pour la limite courante (toutes catégories partageant la clé)
  const currentSelectionCount = order.ingredients.filter(
    ing => CATEGORY_TO_LIMIT_KEY[ing.category] === limitKey
  ).length;

  // Validation pour le bouton Suivant : au moins une base sélectionnée
  const isReady = order.ingredients.some(i => i.category === 'base_salade');

  const handleIngredientClick = (ingredient) => {
    const isSelected = order.ingredients.some(i => i._id === ingredient._id);

    hapticIngredientToggle(!isSelected);
    toggleIngredient(ingredient);

    if (isSelected) {
      trackIngredientRemoved(ingredient);
    } else {
      trackIngredientAdded(ingredient);

      // Auto-avance : si cet ajout complète l'étape courante, chercher la prochaine étape incomplète
      const newCount = currentSelectionCount + 1;
      if (newCount >= limitMax) {
        // Simuler l'état des ingrédients après le toggle (React ne l'a pas encore mis à jour)
        const ingredientsAfter = [...order.ingredients, ingredient];

        let nextIdx = currentStepIndex + 1;
        while (nextIdx < STEP_ORDER.length) {
          const nextStep = STEP_ORDER[nextIdx];
          const nextLimitMax = order.formula.limits[nextStep.limitKey] || 0;
          if (nextLimitMax === 0) { nextIdx++; continue; } // étape sans slots → skip
          const nextCount = ingredientsAfter.filter(
            ing => CATEGORY_TO_LIMIT_KEY[ing.category] === nextStep.limitKey
          ).length;
          if (nextCount >= nextLimitMax) { nextIdx++; continue; } // déjà complet → skip
          break; // étape incomplète trouvée
        }
        if (nextIdx < STEP_ORDER.length) {
          setCurrentStepIndex(nextIdx);
        }
        // Si nextIdx >= STEP_ORDER.length → tout est complet, le bouton Suivant s'active
      }
    }
  };

  // Précédent : navigation pure sans retrait d'ingrédients
  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(i => i - 1);
    }
  };

  // Suivant : avance d'une étape, ouvre SupplementModal à la dernière étape
  const handleNext = () => {
    const isLastStep = currentStepIndex === STEP_ORDER.length - 1;
    if (isLastStep) {
      setIsSupplementModalOpen(true);
    } else {
      setCurrentStepIndex(i => i + 1);
    }
  };

  const handleSupplementConfirm = () => {
    setIsSupplementModalOpen(false);
    setIsMenuModalOpen(true);
  };

  // Handlers IA
  const handleRequestSuggestion = async () => {
    if (!order.formula || order.ingredients.length === 0) {
      setNotification("Ajoutez d'abord quelques ingrédients pour obtenir une suggestion !");
      return;
    }
    trackAIInteraction('opened', {
      ingredientsCount: order.ingredients.length,
      formulaType: order.formula.type
    });
    setAiLoading(true);
    try {
      const response = await fetchAiSuggestion({
        currentIngredients: order.ingredients,
        formulaType: order.formula.type
      });
      if (response.data && response.data.suggestion) {
        const suggestion = response.data.suggestion;
        const alreadySelected = order.ingredients.some(i => i._id === suggestion._id);
        if (!alreadySelected) {
          vibrate(HAPTIC_PATTERNS.success);
          setAiSuggestion(suggestion);
        } else {
          setNotification("Le Chef pense que votre composition est déjà parfaite !");
        }
      }
    } catch (err) {
      console.warn("L'IA fait une sieste (Erreur):", err);
      setNotification("Le Chef est en pause café... Réessayez dans un instant.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAcceptSuggestion = (ingredient) => {
    vibrate(HAPTIC_PATTERNS.success);
    toggleIngredient(ingredient);
    trackAIInteraction('suggestion_applied', {
      ingredientId: ingredient._id,
      ingredientName: ingredient.name,
      category: ingredient.category
    });
    setAiSuggestion(null);
    setNotification(`Excellent choix ! ${ingredient.name} ajouté.`);
  };

  const handleDismissSuggestion = () => setAiSuggestion(null);

  const handleMenuSelect = (menu) => {
    setMenu(menu);
    if (menu.name === 'Solo' || menu.name === 'Sans Menu' || (!menu.includes.drink && !menu.includes.dessert)) {
      navigate('/summary');
    } else {
      navigate('/menu-selection');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-36 font-sans">

      {/* === HEADER === */}
      <div className="bg-white border-b border-gray-200 sticky top-16 z-30 shadow-sm transition-all">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-end">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded bg-green-100 text-green-600">
                Bar à Salade
              </span>
              <h1 className="text-2xl font-extrabold text-gray-900 mt-2 leading-none">
                {order.formula.name}
              </h1>
            </div>
            <div className="text-right">
               <div className="text-xl font-bold text-gray-900">{order.formula.base_price.toFixed(2)}€</div>
            </div>
          </div>
        </div>
      </div>

      {/* === LAYOUT 2 COLONNES (DESKTOP) === */}
      <div className="container mx-auto px-4 py-6">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">

          {/* ====== COLONNE GAUCHE - STICKY (Visual Builder + Calories) ====== */}
          <div className="lg:col-span-4 mb-8 lg:mb-0">
            <div className="lg:sticky lg:top-32 space-y-6">

              <VisualBuilder ingredients={order.ingredients} />

              {/* Badge Calories */}
              <div className="bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-200 rounded-2xl p-5 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 uppercase font-bold tracking-wider">Total Calories</p>
                      <p className="text-3xl font-extrabold text-orange-600">{totalCalories}</p>
                    </div>
                  </div>
                  <div className="text-orange-600 font-bold text-sm">kcal</div>
                </div>
                <div className="mt-4">
                  <div className="w-full bg-orange-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-orange-400 to-red-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min((totalCalories / 800) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2 text-center">Apport énergétique estimé</p>
                </div>
              </div>
            </div>
          </div>

          {/* ====== COLONNE DROITE - Wizard + Grille d'ingrédients ====== */}
          <div className="lg:col-span-8">

            {/* Header Wizard */}
            <div className="mb-6">
              <p className="text-sm text-honey font-semibold tracking-widest uppercase">
                Étape {currentStepIndex + 1} / {STEP_ORDER.length}
              </p>
              <h2 className="text-2xl md:text-3xl gelasio text-wood mb-1">
                {currentStep.label}
              </h2>
              <p className="text-sm text-stone-500">
                {limitMax === 1
                  ? 'Sélectionnez 1 option'
                  : `${currentSelectionCount} / ${limitMax} sélectionné${currentSelectionCount > 1 ? 's' : ''}`
                }
              </p>

              {/* Barre de progression */}
              <div className="mt-4 h-1 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-700 transition-all duration-500"
                  style={{ width: `${((currentStepIndex + 1) / STEP_ORDER.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Grille d'ingrédients */}
            {loading && (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            )}

            {error && <div className="text-center text-red-500 py-10">{error}</div>}

            {!loading && !error && filteredIngredients.length === 0 && (
              <div className="text-center py-10 text-gray-400 italic">Aucune option disponible pour cette catégorie.</div>
            )}

            {!loading && !error && filteredIngredients.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredIngredients.map((ingredient) => {
                  const isSelected = order.ingredients.some(selected => selected._id === ingredient._id);
                  const isOverLimit = !isSelected && limitMax > 1 && currentSelectionCount >= limitMax;
                  const supplementCost = isOverLimit ? (order.formula.extra_cost_per_component || 0) : null;
                  return (
                    <div key={ingredient._id} className="h-full">
                      <IngredientCard
                        ingredient={ingredient}
                        isSelected={isSelected}
                        supplementCost={supplementCost}
                        onClick={() => handleIngredientClick(ingredient)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === TOAST NOTIFICATION === */}
      {notification && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl z-50 animate-[fadeIn_0.3s_ease-out]">
          <span className="text-sm font-bold">{notification}</span>
        </div>
      )}

      {/* === UNDO/REDO + SUGGESTION CHEF === */}
      <div className="fixed bottom-36 left-4 z-30 flex flex-col gap-3">
        <button
          onClick={handleRequestSuggestion}
          disabled={aiLoading || order.ingredients.length === 0}
          aria-label="Demander une suggestion au Chef"
          title="Suggestion du Chef"
          className={`
            group relative px-4 py-3 bg-gradient-to-r from-brand-600 to-brand-500 text-white rounded-xl shadow-lg
            flex items-center gap-2 transition-all duration-300 font-bold text-sm
            ${aiLoading || order.ingredients.length === 0
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:scale-105 hover:shadow-2xl hover:shadow-brand-500/50'
            }
          `}
        >
          {aiLoading ? (
            <>
              <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              <span>Réflexion...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span>Suggestion du Chef</span>
            </>
          )}
        </button>

      </div>

      {/* === AI ASSISTANT === */}
      <AiAssistant
        suggestion={aiSuggestion}
        onAdd={handleAcceptSuggestion}
        onClose={handleDismissSuggestion}
      />

      {/* === FOOTER === */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-40 backdrop-blur-sm bg-white/95">
        <div className="container mx-auto flex justify-between items-center max-w-4xl">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500 font-bold uppercase">Total</span>
            <span className="text-3xl font-extrabold text-brand-600">
              {totalPrice.toFixed(2)}€
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Précédent : visible à partir de l'étape 2 */}
            {currentStepIndex > 0 && (
              <button
                onClick={handlePrev}
                className="px-6 py-3 rounded-xl border-2 border-brand-700 text-brand-700 hover:bg-brand-700 hover:text-white transition-colors font-semibold"
              >
                ← Précédent
              </button>
            )}

            {/* Suivant / Valider */}
            <button
              onClick={handleNext}
              disabled={!isReady}
              className={`
                flex items-center gap-2 px-8 py-3 rounded-xl font-bold text-lg shadow-lg transition-all duration-300 transform
                ${isReady
                  ? 'bg-brand-600 hover:bg-brand-700 shadow-brand-300 text-white hover:-translate-y-1'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'}
              `}
            >
              {currentStepIndex === STEP_ORDER.length - 1 ? 'Valider ma commande' : 'Suivant →'}
            </button>
          </div>
        </div>
      </footer>

      <SupplementModal
        isOpen={isSupplementModalOpen}
        onSkip={handleSupplementConfirm}
        onConfirm={handleSupplementConfirm}
        ingredients={availableIngredients}
        selectedIngredients={order.ingredients}
        extraCostPerComponent={order.formula?.extra_cost_per_component || 0}
        formulaLimits={order.formula?.limits || {}}
        onToggle={toggleIngredient}
      />

      <MenuSelectionModal
        isOpen={isMenuModalOpen}
        onClose={() => setIsMenuModalOpen(false)}
        onSelect={handleMenuSelect}
      />
    </div>
  );
};

export default Configurator;
