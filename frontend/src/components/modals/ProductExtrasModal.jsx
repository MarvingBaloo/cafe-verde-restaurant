// src/components/modals/ProductExtrasModal.jsx
// Modale de sélection des suppléments / extras d'un produit (facultatifs, oui/non par extra).
// Générique : la modale ne connaît pas le panier, elle remonte la sélection via onConfirm.
// Utilisée côté boutique (Products.jsx) et côté caisse (Caisse.jsx).

import { useState } from 'react';
import { getImageUrl } from '../../utils/imageUtils';
import Icon from '../Icon';

const ProductExtrasModal = ({ product, onClose, onConfirm }) => {
  const [selectedIds, setSelectedIds] = useState([]);

  if (!product) return null;

  const extras = (product.extras || []);

  const toggle = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectedExtras = extras
    .filter(ex => selectedIds.includes(ex.id))
    .map(ex => ({ name: ex.name, price: ex.price || 0 }));

  const extrasTotal = selectedExtras.reduce((sum, ex) => sum + (ex.price || 0), 0);
  const total = (product.price || 0) + extrasTotal;

  const handleAdd = () => {
    onConfirm(product, selectedExtras);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
          <h3 className="text-2xl font-serif font-bold text-gray-900">{product.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-3xl leading-none">×</button>
        </div>

        <div className="p-6">
          {/* Image + prix de base */}
          <div className="flex gap-4 mb-5">
            <div className="w-24 h-24 rounded-xl bg-gray-100 overflow-hidden shrink-0">
              {product.image ? (
                <img src={getImageUrl(product.image)} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl"><Icon name="cold_drink" /></div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-brand-700 font-bold mt-1">{(product.price || 0).toFixed(2)} €</p>
            </div>
          </div>

          {/* Suppléments à choisir */}
          <h4 className="text-lg font-serif text-wood mb-1">Suppléments</h4>
          <p className="text-xs text-stone-500 mb-2">Ajoutez ce que vous voulez (facultatif).</p>
          <div className="grid grid-cols-2 gap-2">
            {extras.map((ex) => {
              const isSelected = selectedIds.includes(ex.id);
              return (
                <button
                  key={ex.id}
                  onClick={() => toggle(ex.id)}
                  className={`text-left px-3 py-2 rounded-lg border-2 transition-all ${
                    isSelected ? 'border-brand-700 bg-brand-50' : 'border-gray-200 hover:border-brand-300'
                  }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <span className="font-medium text-sm">{ex.name}</span>
                    {(ex.price || 0) > 0 && (
                      <span className="text-xs text-amber-600 whitespace-nowrap">+{(ex.price || 0).toFixed(2)} €</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
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

export default ProductExtrasModal;
