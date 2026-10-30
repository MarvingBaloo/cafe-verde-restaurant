import React from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../Icon';

const CATEGORY_TO_LIMIT_KEY = {
  base_salade: 'base',
  proteine: 'protein',
  topping_legume: 'topping',
  topping_fruit: 'topping',
  sauce: 'sauce',
};

const CAT_ICON = {
  base_salade: 'vegetable',
  proteine: 'meat',
  topping_legume: 'vegetable',
  topping_fruit: 'fruit',
  sauce: 'sauce',
};

const SupplementModal = ({
  isOpen,
  onSkip,
  onConfirm,
  ingredients = [],
  selectedIngredients = [],
  extraCostPerComponent = 0,
  formulaLimits = {},
  onToggle,
}) => {
  // Ingrédients non sélectionnés qui seraient en supplément
  const supplementIngredients = ingredients.filter((ing) => {
    const isAlreadySelected = selectedIngredients.some((s) => s._id === ing._id);
    if (isAlreadySelected) return false;
    const limitKey = CATEGORY_TO_LIMIT_KEY[ing.category];
    if (!limitKey) return false;
    const limit = formulaLimits[limitKey] || 0;
    if (limit <= 0) return false;
    const countInGroup = selectedIngredients.filter(
      (s) => CATEGORY_TO_LIMIT_KEY[s.category] === limitKey
    ).length;
    return countInGroup >= limit;
  });

  const isEmpty = supplementIngredients.length === 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onSkip}
        >
          <motion.div
            className="bg-white rounded-t-3xl md:rounded-3xl w-full md:max-w-lg p-6 max-h-[85vh] flex flex-col"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <div className="text-4xl mb-2 flex justify-center text-amber-400"><Icon name="star" /></div>
              <h2 className="gelasio text-2xl text-stone-800">Envie de plus ?</h2>
              <p className="text-sm text-stone-500 mt-1">
                Ajoutez des ingrédients en supplément
              </p>
            </div>

            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {isEmpty ? (
                <div className="text-center py-10">
                  <div className="text-5xl mb-3 flex justify-center text-brand-400"><Icon name="new" /></div>
                  <p className="text-stone-600 font-medium">
                    Votre salade est déjà complète et parfaite !
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {supplementIngredients.map((ing) => {
                    const isSelected = selectedIngredients.some((s) => s._id === ing._id);
                    return (
                      <button
                        key={ing._id}
                        type="button"
                        onClick={() => onToggle && onToggle(ing)}
                        className={`text-left rounded-xl p-3 transition-all ${
                          isSelected
                            ? 'bg-brand-50 border-2 border-brand-400 ring-2 ring-brand-400'
                            : 'bg-orange-50 border border-orange-200 hover:border-orange-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg"><Icon name={CAT_ICON[ing.category] || 'salad'} /></span>
                          <span className="text-sm font-semibold text-stone-800 truncate">
                            {ing.name}
                          </span>
                        </div>
                        <span className="inline-block text-xs font-bold text-orange-600">
                          +{extraCostPerComponent.toFixed(2)} €
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-stone-100 flex gap-3">
              {isEmpty ? (
                <button
                  type="button"
                  onClick={onConfirm}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 rounded-xl transition-colors"
                >
                  Continuer
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onSkip}
                    className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-3 rounded-xl transition-colors"
                  >
                    Passer
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    className="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-bold py-3 rounded-xl transition-colors"
                  >
                    Ajouter et continuer
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

SupplementModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSkip: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  ingredients: PropTypes.array,
  selectedIngredients: PropTypes.array,
  extraCostPerComponent: PropTypes.number,
  formulaLimits: PropTypes.object,
  onToggle: PropTypes.func,
};

export default SupplementModal;
