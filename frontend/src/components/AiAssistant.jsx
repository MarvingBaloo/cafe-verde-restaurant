// src/components/AiAssistant.jsx
import React from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon';

/**
 * @component AiAssistant
 * @description Composant de notification intelligente ("Toast" riche).
 * Affiche une suggestion du chef avec une animation fluide en bas de l'écran.
 */
const AiAssistant = ({ suggestion, onAdd, onClose }) => {
  // Si aucune suggestion n'est active, on ne rend rien (le AnimatePresence gère la sortie)
  if (!suggestion) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="ai-assistant-bubble"
        initial={{ y: 100, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 100, opacity: 0, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed bottom-24 right-4 md:right-8 z-50 max-w-sm w-full"
      >
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-2 border-brand-100 flex flex-col">
            
            {/* Header / Banner */}
            <div className="bg-gradient-to-r from-brand-600 to-brand-500 p-3 flex justify-between items-center text-white shadow-sm">
                <div className="flex items-center gap-2">
                    <span className="text-xl bg-white/20 p-1 rounded-full"><Icon name="chef" /></span>
                    <span className="font-bold text-sm tracking-wide uppercase">Le Chef Suggère</span>
                </div>
                <button
                    onClick={onClose}
                    className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-colors"
                    aria-label="Fermer la suggestion du chef"
                    title="Fermer"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>

            {/* Content Body */}
            <div className="p-4 flex gap-4 items-center bg-white">
                {/* Image de l'ingrédient */}
                <div className="flex-shrink-0 w-16 h-16 bg-gray-50 rounded-xl overflow-hidden shadow-inner border border-gray-100">
                    {suggestion.image ? (
                        <img 
                            src={suggestion.image} 
                            alt={suggestion.name} 
                            className="w-full h-full object-cover transform hover:scale-110 transition-transform duration-500" 
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl opacity-50"><Icon name="restaurant" /></div>
                    )}
                </div>

                {/* Texte et Message */}
                <div className="flex-grow">
                     <p className="text-sm text-gray-500 italic mb-1 leading-snug">
                        "{suggestion.suggestionMessage}"
                     </p>
                     <div className="flex items-center gap-2">
                         <p className="font-bold text-gray-900">{suggestion.name}</p>
                         {suggestion.extra_price > 0 && (
                             <span className="text-[10px] text-brand-700 font-bold bg-brand-100 px-2 py-0.5 rounded-full border border-brand-200">
                                +{suggestion.extra_price.toFixed(2)}€
                             </span>
                         )}
                     </div>
                </div>
            </div>

            {/* Actions Footer */}
            <div className="p-3 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
                    aria-label="Refuser la suggestion"
                >
                    Non merci
                </button>
                <button
                    onClick={() => onAdd(suggestion)}
                    className="px-5 py-2 text-sm font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-md transition-all duration-200 transform hover:-translate-y-0.5 active:scale-95 flex items-center gap-2"
                    aria-label={`Ajouter ${suggestion.name} à ma composition`}
                >
                    <span>Ajouter</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

// Validation des props pour la sécurité
AiAssistant.propTypes = {
  suggestion: PropTypes.shape({
    _id: PropTypes.string,
    name: PropTypes.string.isRequired,
    image: PropTypes.string,
    suggestionMessage: PropTypes.string,
    extra_price: PropTypes.number,
  }),
  onAdd: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default AiAssistant;