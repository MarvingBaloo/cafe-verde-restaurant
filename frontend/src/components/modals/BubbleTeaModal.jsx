// src/components/modals/BubbleTeaModal.jsx
// Modale de composition d'un bubble tea côté client (ouverte depuis la carte Boissons).
// Sélection unique par catégorie (facultative) ; le prix évolue avec les suppléments.

import { useState } from 'react';
import { getImageUrl } from '../../utils/imageUtils';
import { useConfig } from '../../context/ConfigContext';
import { useToast } from '../../context/ToastContext';
import Icon from '../Icon';

const BubbleTeaModal = ({ tea, onClose }) => {
  const { addBubbleTeaToOrder } = useConfig();
  const { toast } = useToast();
  // Multi-sélection : liste plate [{ category, name, supplementPrice }] (plusieurs options par catégorie possibles)
  const [selected, setSelected] = useState([]);

  if (!tea) return null;

  // Catégories et ingrédients actifs uniquement
  const categories = (tea.categories || [])
    .filter(c => c.enabled !== false)
    .map(c => ({ ...c, ingredients: (c.ingredients || []).filter(i => i.enabled !== false) }))
    .filter(c => c.ingredients.length > 0);

  const isPicked = (categoryName, ing) => selected.some(s => s.category === categoryName && s.name === ing.name);

  const toggleIngredient = (categoryName, ing) => {
    setSelected(prev => {
      if (isPicked(categoryName, ing)) {
        return prev.filter(s => !(s.category === categoryName && s.name === ing.name));
      }
      return [...prev, { category: categoryName, name: ing.name, supplementPrice: ing.isSupplement ? (ing.supplementPrice || 0) : 0 }];
    });
  };

  const selections = selected;
  const supplementsTotal = selections.reduce((sum, s) => sum + s.supplementPrice, 0);
  const total = (tea.price || 0) + supplementsTotal;

  const handleAdd = () => {
    addBubbleTeaToOrder(tea, selections);
    toast.success(`${tea.name} ajouté au panier`);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
          <h3 className="text-2xl font-serif font-bold text-gray-900">{tea.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl leading-none">×</button>
        </div>

        <div className="p-6">
          {/* Image + prix de base */}
          <div className="flex gap-4 mb-5">
            <div className="w-24 h-24 rounded-xl bg-gray-100 overflow-hidden shrink-0">
              {tea.image ? (
                <img src={getImageUrl(tea.image)} alt={tea.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl"><Icon name="cocktail" /></div>
              )}
            </div>
            <div className="flex-1">
              {tea.description && <p className="text-gray-600 text-sm">{tea.description}</p>}
              <p className="text-brand-700 font-bold mt-1">{(tea.price || 0).toFixed(2)} €</p>
            </div>
          </div>

          {/* Catégories à composer */}
          {categories.map((cat) => (
            <div key={cat.name} className="mb-5">
              <h4 className="text-lg font-serif text-wood mb-1">{cat.name}</h4>
              <p className="text-xs text-stone-500 mb-2">Choisissez une ou plusieurs options (facultatif)</p>
              <div className="grid grid-cols-2 gap-2">
                {cat.ingredients.map((ing, idx) => {
                  const isSelected = isPicked(cat.name, ing);
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleIngredient(cat.name, ing)}
                      className={`text-left px-3 py-2 rounded-lg border-2 transition-all ${
                        isSelected ? 'border-brand-700 bg-brand-50' : 'border-gray-200 hover:border-brand-300'
                      }`}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-medium text-sm">{ing.name}</span>
                        {ing.isSupplement && (ing.supplementPrice || 0) > 0 && (
                          <span className="text-xs text-amber-600 whitespace-nowrap">+{ing.supplementPrice.toFixed(2)} €</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {categories.length === 0 && (
            <p className="text-stone-500 italic mb-4">Ce bubble tea n'a pas d'option à composer.</p>
          )}
        </div>

        {/* Footer total + CTA */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-4">
          <div className="text-lg font-bold text-wood">
            Total : <span className="text-brand-700">{total.toFixed(2)} €</span>
          </div>
          <button
            onClick={handleAdd}
            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold uppercase tracking-widest text-xs transition-colors"
          >
            Ajouter au panier
          </button>
        </div>
      </div>
    </div>
  );
};

export default BubbleTeaModal;
