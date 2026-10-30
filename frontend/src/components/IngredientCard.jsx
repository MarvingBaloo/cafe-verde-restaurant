// src/components/IngredientCard.jsx
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Tooltip } from 'react-tooltip';
import { getImageUrl, hasImage } from '../utils/imageUtils';
import Icon from './Icon';

/**
 * Affiche une carte premium pour un ingrédient.
 * Gère les états de survol, de sélection, et l'affichage des badges (Premium, Prix).
 */
const IngredientCard = ({ ingredient, isSelected, onClick, supplementCost }) => {
  // Image de remplacement si aucune image n'est fournie (motif subtil)
  const PLACEHOLDER_IMAGE = "https://www.transparenttextures.com/patterns/food.png";
  
  // État pour gérer le chargement progressif de l'image
  const [imageLoaded, setImageLoaded] = useState(false);

  // Gestion de la navigation clavier
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onClick) onClick();
    }
  };

  return (
    <div
      role="checkbox"
      aria-checked={isSelected}
      aria-label={`${ingredient.name}${ingredient.extra_price > 0 ? `, supplément de ${ingredient.extra_price.toFixed(2)} euros` : ''}${ingredient.is_premium ? ', ingrédient premium' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyPress}
      onClick={onClick}
      className={`relative group h-full flex flex-col bg-white rounded-2xl transition-all duration-300 cursor-pointer overflow-hidden
        ${isSelected
          ? 'ring-[3px] ring-brand-500 shadow-md' // État Actif : Anneau épais + ombre
          : 'border border-gray-100 shadow-soft hover:shadow-xl hover:border-brand-200 hover:-translate-y-1' // État Inactif : Survol léger
        }`}
    >
      {/* === Conteneur Image === */}
      <div className={`relative h-36 overflow-hidden ${!hasImage(ingredient.image) ? 'bg-gray-50 flex items-center justify-center' : 'bg-gray-100'}`}>
        
        {/* Image réelle ou Placeholder texturé */}
        {hasImage(ingredient.image) ? (
          <img
            src={getImageUrl(ingredient.image)}
            alt={ingredient.name}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={(e) => {
              // Si l'image ne charge pas, on cache l'élément et affiche le placeholder
              e.target.style.display = 'none';
              setImageLoaded(false);
            }}
            className={`w-full h-full object-cover transition-all duration-500 ${!imageLoaded ? 'blur-sm opacity-70' : 'blur-0 opacity-100'} ${isSelected ? 'scale-105' : 'group-hover:scale-110'}`}
          />
        ) : (
           // Si pas d'image, on met un fond texturé et une icône générique
           <div className="text-gray-300 flex flex-col items-center" style={{backgroundImage: `url(${PLACEHOLDER_IMAGE})`}}>
             <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 opacity-50 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h18v18H3zM12 8v8m-4-4h8" />
             </svg>
             <span className="text-xs font-medium uppercase tracking-wider">Ingrédient</span>
           </div>
        )}

        {/* Overlay subtil pour faire ressortir le texte si besoin */}
        <div className={`absolute inset-0 bg-black/0 transition-colors ${isSelected ? 'bg-brand-900/5' : 'group-hover:bg-black/5'}`}></div>

        {/* Badge Premium (Coin supérieur gauche) */}
        {ingredient.is_premium && (
          <div className="absolute top-3 left-3 bg-accent-500 text-white text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-lg shadow-sm flex items-center gap-1 z-10">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
              <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.651l-4.752-.382-1.831-4.401z" clipRule="evenodd" />
            </svg>
            Premium
          </div>
        )}

        {/* Badge Calories (Coin inférieur gauche - Toujours visible si calories > 0) */}
        {ingredient.nutritional_info && ingredient.nutritional_info.calories > 0 && (
          <div className="absolute bottom-3 left-3 bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-lg shadow-md flex items-center gap-1 z-10 backdrop-blur-sm">
            <span className="text-sm"><Icon name="fire" /></span>
            <span>{ingredient.nutritional_info.calories} kcal</span>
          </div>
        )}

        {/* Coche de Sélection (Coin supérieur droit - Visible uniquement si sélectionné) */}
        {isSelected && (
          <div className="absolute top-3 right-3 bg-brand-500 text-white rounded-full p-1.5 shadow-sm z-10 animate-[scaleIn_0.2s_ease-out]">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>

      {/* === Contenu Texte === */}
      <div className="p-5 flex flex-col flex-grow items-center text-center bg-white">
        <div className="flex items-center gap-2 justify-center mb-2">
          <h3 className={`font-bold text-gray-800 text-lg leading-tight transition-colors ${isSelected ? 'text-brand-700' : ''}`}>
            {ingredient.name}
          </h3>
          {ingredient.nutritional_info && ingredient.nutritional_info.calories > 0 && (
            <>
              <button
                data-tooltip-id={`tooltip-${ingredient._id}`}
                className="inline-flex items-center justify-center w-6 h-6 bg-gradient-to-br from-blue-100 to-blue-50 hover:from-blue-200 hover:to-blue-100 text-blue-600 rounded-full cursor-help transition-all hover:scale-110 shadow-sm hover:shadow-md"
                aria-label="Voir les informations nutritionnelles détaillées"
                onClick={(e) => e.stopPropagation()} // Empêcher la sélection de l'ingrédient
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                </svg>
              </button>
              <Tooltip 
                id={`tooltip-${ingredient._id}`}
                place="top"
                className="z-50 !bg-gradient-to-br !from-gray-900 !to-gray-800 !text-white !rounded-xl !shadow-2xl !border !border-gray-700"
              >
                <div className="text-left space-y-2 p-2 min-w-[200px]">
                  <div className="font-bold text-center border-b border-gray-600 pb-2 mb-2 text-sm flex items-center justify-center gap-1.5">
                    <Icon name="chart" /> Valeurs Nutritionnelles
                    <div className="text-xs text-gray-400 font-normal mt-0.5">(pour 100g)</div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center bg-orange-900/20 rounded px-2 py-1">
                      <span className="text-sm flex items-center gap-1.5">
                        <span className="text-base"><Icon name="fire" /></span>
                        Calories
                      </span>
                      <span className="font-bold text-orange-400">{ingredient.nutritional_info.calories} kcal</span>
                    </div>
                    <div className="flex justify-between items-center bg-blue-900/20 rounded px-2 py-1">
                      <span className="text-sm flex items-center gap-1.5">
                        <span className="text-base"><Icon name="muscle" /></span>
                        Protéines
                      </span>
                      <span className="font-bold text-blue-400">{ingredient.nutritional_info.proteins}g</span>
                    </div>
                    <div className="flex justify-between items-center bg-yellow-900/20 rounded px-2 py-1">
                      <span className="text-sm flex items-center gap-1.5">
                        <span className="text-base"><Icon name="bread" /></span>
                        Glucides
                      </span>
                      <span className="font-bold text-yellow-400">{ingredient.nutritional_info.carbs}g</span>
                    </div>
                    <div className="flex justify-between items-center bg-green-900/20 rounded px-2 py-1">
                      <span className="text-sm flex items-center gap-1.5">
                        <span className="text-base"><Icon name="avocado" /></span>
                        Lipides
                      </span>
                      <span className="font-bold text-green-400">{ingredient.nutritional_info.fat}g</span>
                    </div>
                  </div>
                </div>
              </Tooltip>
            </>
          )}
        </div>

        {/* Indicateur de Prix Supplémentaire */}
        {ingredient.extra_price > 0 ? (
          <p className="mt-auto inline-block bg-accent-50 text-accent-700 text-sm font-bold px-3 py-1 rounded-full">
            +{ingredient.extra_price.toFixed(2)} €
          </p>
        ) : supplementCost > 0 ? (
          <p className="mt-auto inline-block bg-orange-50 text-orange-600 text-sm font-bold px-3 py-1 rounded-full border border-orange-200">
            +{supplementCost.toFixed(2)} € supplément
          </p>
        ) : (
          <div className="mt-auto h-7"></div>
        )}
      </div>
    </div>
  );
};

// Définition des PropTypes pour la validation
IngredientCard.propTypes = {
  ingredient: PropTypes.shape({
    image: PropTypes.string,
    name: PropTypes.string.isRequired,
    extra_price: PropTypes.number,
    is_premium: PropTypes.bool,
  }).isRequired,
  isSelected: PropTypes.bool.isRequired,
  onClick: PropTypes.func,
  supplementCost: PropTypes.number,
};

export default IngredientCard;
