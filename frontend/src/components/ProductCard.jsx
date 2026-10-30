// src/components/ProductCard.jsx
import React, { useRef } from 'react';
import PropTypes from 'prop-types';
import { getImageUrl } from '../utils/imageUtils';
import { clickable } from '../utils/a11y';

/**
 * @description Carte produit "Premium" pour les boissons et desserts.
 * Design cohérent avec IngredientCard : Ombre douce, Image mise en avant, Feedback tactile.
 */
const ProductCard = ({ product, isSelected, onClick, onImageUpload, showMenuBadge }) => {
  // Placeholder gourmand si pas d'image
  const PLACEHOLDER = "https://images.unsplash.com/photo-1551024709-8f23befc6f87?q=80&w=800&auto=format&fit=crop";
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && onImageUpload) {
      onImageUpload(product, file);
    }
    // Reset l'input pour permettre de sélectionner le même fichier à nouveau
    e.target.value = '';
  };

  const handleOverlayClick = () => {
    if (fileInputRef.current && onImageUpload) {
      fileInputRef.current.click();
    }
  };

  return (
    <div 
      {...clickable(onClick)}
      className={`group relative flex flex-col h-full bg-white rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 transform
        ${isSelected 
          ? 'ring-2 ring-brand-500 shadow-lg -translate-y-1' 
          : 'border border-gray-100 shadow-soft hover:shadow-xl hover:border-brand-200 hover:-translate-y-1'
        }`}
    >
      {/* Badge de sélection (Coche) */}
      {isSelected && (
        <div className="absolute top-3 right-3 z-20 bg-brand-500 text-white p-1.5 rounded-full shadow-md animate-[scaleIn_0.2s_ease-out]">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}

      {/* Conteneur Image */}
      <div className="relative h-40 overflow-hidden bg-gray-50">
        {/* Input file caché pour l'upload d'image */}
        {onImageUpload && (
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />
        )}
        <img 
          src={product.image ? getImageUrl(product.image) : PLACEHOLDER} 
          alt={product.name} 
          className={`w-full h-full object-cover transition-transform duration-700 ${isSelected ? 'scale-110' : 'group-hover:scale-110'}`}
          onError={(e) => {
            // Si l'image ne charge pas, utiliser le placeholder
            e.target.src = PLACEHOLDER;
          }}
        />
        {/* Overlay progressif pour lisibilité */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60"></div>
        
        {/* Prix flottant sur l'image */}
        <div className="absolute bottom-3 left-3 text-white font-bold text-shadow-sm z-10">
          {product.price.toFixed(2)} €
        </div>
        
        {/* Overlay d'upload d'image au survol */}
        {onImageUpload && (
          <div 
            // Faux positif : `clickable` (utils/a11y.js) ne fait que transmettre le
            // handler, elle ne l'appelle jamais pendant le rendu. Le ref n'est lu
            // qu'au clic.
            // eslint-disable-next-line react-hooks/refs
            {...clickable(handleOverlayClick)}
            className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-white font-semibold text-sm">Modifier</span>
          </div>
        )}
      </div>

      {/* Contenu Texte */}
      <div className="p-4 flex flex-col flex-grow text-center">
        <h3 className={`gelasio font-bold text-lg leading-tight mb-2 group-hover:text-brand-600 transition-colors ${isSelected ? 'text-brand-700' : 'text-gray-800'}`}>
          {product.name}
        </h3>
        
        {/* Supplément Menu (uniquement dans le contexte d'une sélection de menu) */}
        {showMenuBadge && (
          product.menu_surcharge > 0 ? (
            <p className="mt-auto text-xs font-bold text-orange-500 bg-orange-50 inline-block px-2 py-1 rounded-full mx-auto">
              + {product.menu_surcharge.toFixed(2)} € (Menu)
            </p>
          ) : (
            <p className="mt-auto text-xs font-bold text-emerald-600 bg-emerald-50 inline-block px-2 py-1 rounded-full mx-auto">
              Inclus
            </p>
          )
        )}
      </div>
    </div>
  );
};

ProductCard.propTypes = {
  product: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    image: PropTypes.string,
    price: PropTypes.number.isRequired,
    menu_surcharge: PropTypes.number,
  }).isRequired,
  isSelected: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  onImageUpload: PropTypes.func,
  showMenuBadge: PropTypes.bool,
};

ProductCard.defaultProps = {
  showMenuBadge: false,
};

export default ProductCard;