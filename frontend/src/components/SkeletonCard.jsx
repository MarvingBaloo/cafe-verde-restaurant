// src/components/SkeletonCard.jsx
import React from 'react';

/**
 * Composant skeleton loader pour les cartes d'ingrédients
 * Améliore la perception du temps de chargement
 */
const SkeletonCard = () => {
  return (
    <div className="h-full flex flex-col bg-white rounded-2xl border border-gray-100 shadow-soft overflow-hidden">
      {/* Image skeleton */}
      <div className="h-36 bg-gray-200 animate-pulse" />
      
      {/* Contenu texte skeleton */}
      <div className="p-5 flex flex-col flex-grow items-center">
        {/* Nom de l'ingrédient */}
        <div className="h-5 bg-gray-200 rounded w-3/4 mb-2 animate-pulse" />
        
        {/* Prix */}
        <div className="h-4 bg-gray-200 rounded w-1/2 mt-auto animate-pulse" />
      </div>
    </div>
  );
};

export default SkeletonCard;
