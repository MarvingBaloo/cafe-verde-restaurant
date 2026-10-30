import React from 'react';
import { MOOD_OPTIONS } from '../../constants/homeConstants';

/**
 * @description Section Mood Food avec sélection d'humeur pour l'IA
 * @param {Object} props
 * @param {string|null} props.moodLoading - ID du mood en cours de chargement
 * @param {Function} props.onMoodClick - Callback au clic sur un mood
 */
const MoodFoodSection = ({ moodLoading, onMoodClick }) => {
  /**
   * Rendu des icônes SVG selon le nom de l'icône
   */
  const renderIcon = (iconName) => {
    switch (iconName) {
      case 'sport':
        return (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 8.5l7-4 7 4m-14 0l7 4m-7-4v8l7 4m0-12l7 4m-7-4v12m7-8v8l-7 4" />
          </svg>
        );
      case 'fatigue':
        return (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
      case 'focus':
        return (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        );
      case 'comfort':
        return (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <section className="py-16 bg-gradient-to-b from-gray-50 to-white relative z-20 -mt-10 mx-4 md:mx-auto max-w-6xl rounded-3xl shadow-2xl border border-gray-100">
      <div className="text-center mb-10">
        <h3 className="text-brand-600 font-bold tracking-widest text-xs uppercase mb-2">Intelligence Artificielle</h3>
        <h2 className="text-3xl gelasio font-bold text-gray-900">Quelle est votre humeur ?</h2>
        <p className="text-gray-500 mt-2">Laissez notre Chef IA composer le bol parfait pour vous.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 md:px-12">
        {MOOD_OPTIONS.map((mood) => (
          <button
            key={mood.id}
            onClick={() => onMoodClick(mood.id)}
            disabled={moodLoading !== null}
            className={`
              group flex flex-col items-center p-6 rounded-2xl transition-all duration-300 transform hover:-translate-y-1 hover:shadow-lg
              ${mood.color}
              ${moodLoading !== null && moodLoading !== mood.id ? 'opacity-50' : 'opacity-100'}
            `}
          >
            <div className="mb-3 transform group-hover:scale-110 transition-transform">
              {moodLoading === mood.id ? (
                <div className="animate-spin h-8 w-8 border-2 border-current border-t-transparent rounded-full" />
              ) : (
                renderIcon(mood.iconName)
              )}
            </div>
            <div className="font-bold text-lg mb-1">{mood.label}</div>
            <div className="text-xs opacity-75">{mood.desc}</div>
          </button>
        ))}
      </div>
    </section>
  );
};

export default MoodFoodSection;
