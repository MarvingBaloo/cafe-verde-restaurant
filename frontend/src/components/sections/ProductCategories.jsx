import React from 'react';
import Icon from '../Icon';
import imgSalad from '../../assets/images/cat_salad.webp';
import hotDishImage from '../../assets/images/hot-dish-hero.webp';
import boissonImage from '../../assets/images/boisson-hero.webp';
import dessertImage from '../../assets/images/dessert-hero.webp';


/**
 * @description Composant de présentation visuelle des catégories de produits
 * @param {Function} onCategorySelect - Fonction appelée quand une catégorie est sélectionnée
 */
const ProductCategories = ({ onCategorySelect }) => {
  const CATEGORIES = [
    {
      key: 'salad',
      title: "Salades",
      description: "Fraîcheur et croquant",
      borderColor: 'border-brand-200',
      icon: 'salad',
      image: imgSalad
    },
    {
      key: 'hot_dish',
      title: 'Les Plats Chauds',
      description: 'Saveurs des îles',
      borderColor: 'border-brand-200',
      icon: 'fire',
      image: hotDishImage
    },
    {
      key: 'desserts',
      title: 'Plaisirs Sucrés',
      description: 'Douceurs & Gourmandises',
      borderColor: 'border-brand-200',
      icon: 'dessert',
      image: dessertImage
    },
    {
      key: 'drinks',
      title: 'Nos Boissons',
      description: 'Fraîcheur & Évasion',
      borderColor: 'border-brand-200',
      icon: 'cold_drink',
      image: boissonImage
    }
  ];

  const handleCategoryClick = (categoryKey) => {
    if (onCategorySelect) {
      onCategorySelect(categoryKey);
    }
  };

  return (
    <div className="menu-card-grid">
      {CATEGORIES.map((category) => (
        <button
          key={category.key}
          onClick={() => handleCategoryClick(category.key)}
          className="menu-card group bg-white rounded-3xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-500 cursor-pointer transform hover:-translate-y-2 flex flex-col"
          aria-label={`Sélectionner la catégorie ${category.title}`}
        >
          {/* Image en en-tête */}
          <div className="h-64 overflow-hidden bg-gray-100">
            {category.image ? (
              <img
                src={category.image}
                alt={category.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = '';
                  e.target.parentElement.classList.add('bg-gray-200');
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-400">
                <div className="text-4xl">
                  <Icon name="salad" />
                </div>
              </div>
            )}
            {/* Overlay de gradient pour le texte */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          </div>

          {/* Contenu texte */}
          <div className="p-6 flex flex-col flex-1">
            {/* Titre */}
            <h3 className="menu-card-title gelasio text-gray-900 font-bold mt-2 mb-4 text-left">
              {category.title}
            </h3>

            {/* Description */}
            <p className="leading-relaxed font-light mb-4 text-left">
              {category.description}
            </p>

            {/* Indicateur d'action */}
            <div className="flex justify-end items-center">
              <span className="mt-auto w-full py-3 rounded-full bg-gray-900 text-white font-bold text-sm uppercase tracking-wider hover:bg-brand-600 transition-all duration-300 shadow group-hover:shadow-lg">
                Découvrir
              </span>
            </div>
          </div>

          {/* Effet de bordure au survol */}
          <div className={`absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}></div>
        </button>
      ))}
    </div>
  );
};

export default ProductCategories;