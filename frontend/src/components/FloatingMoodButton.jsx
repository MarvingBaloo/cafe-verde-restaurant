import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMoodRecommendation } from '../services/api';
import { useConfig } from '../context/ConfigContext';
import Icon from './Icon';
import { useActivityTracker } from '../hooks/useActivityTracker';
import MoodFoodSection from './sections/MoodFoodSection';
import { useToast } from '../context/ToastContext';

/**
 * Bouton flottant fixe (FAB) en bas à droite qui ouvre un modal contenant la section Mood Food (IA).
 * Auto-suffisant : gère son propre état et ses propres appels API.
 */
const FloatingMoodButton = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [moodLoading, setMoodLoading] = useState(null);
  const navigate = useNavigate();
  const { startOrder } = useConfig();
  const { trackAIInteraction } = useActivityTracker();
  const { toast } = useToast();

  const handleMoodClick = async (moodKey) => {
    setMoodLoading(moodKey);
    trackAIInteraction('mood_selection', { mood: moodKey });
    try {
      const response = await fetchMoodRecommendation(moodKey);
      if (response.data.success) {
        const { formula, ingredients } = response.data.data;
        startOrder(formula, ingredients);
        setIsOpen(false);
        navigate('/configurator');
      }
    } catch (error) {
      console.error('Erreur Mood:', error);
      toast.warning("Notre IA est en pause café. Veuillez choisir une formule classique.");
    } finally {
      setMoodLoading(null);
    }
  };

  return (
    <>
      {/* Bouton flottant */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-16 h-16 rounded-full bg-gradient-to-br from-honey to-amber-400 shadow-2xl shadow-honey/40 flex items-center justify-center text-3xl hover:scale-110 transition-transform duration-300 ring-4 ring-honey/20"
        aria-label="Suggestion IA selon votre humeur"
        title="Que vous propose l'IA aujourd'hui ?"
      >
        <Icon name="idea" fill='white' />
      </button>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-brand-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Bouton fermeture */}
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center text-xl hover:bg-gray-100 transition-colors"
              aria-label="Fermer"
            >
              <Icon name="close" />
            </button>

            {/* mt-10 annule le -mt-10 natif de MoodFoodSection (prévu pour chevaucher le hero) */}
            <div className="mt-10">
              <MoodFoodSection moodLoading={moodLoading} onMoodClick={handleMoodClick} />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingMoodButton;
