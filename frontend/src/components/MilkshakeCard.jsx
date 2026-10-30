import { clickable } from '../utils/a11y';
import { getImageUrl } from '../utils/imageUtils';
import Icon from './Icon';

const MilkshakeCard = ({ ms, onClick }) => {
  const unavailable = ms.isAvailable === false;
  const catCount = (ms.categories || []).filter(c => c.enabled !== false).length;

  const inner = (
    <>
      <div className="absolute top-4 left-4 px-4 py-2 rounded-full font-bold text-xs uppercase tracking-wider z-10 shadow-lg flex items-center gap-2 bg-brand-600 text-white">
        <Icon name="milkshake" className="text-sm" />
        Milkshake
      </div>
      <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm text-gray-900 px-4 py-2 rounded-full font-serif text-xl font-bold z-10 shadow-lg">
        {(ms.price || 0).toFixed(2)}€
      </div>

      <div className="h-48 overflow-hidden bg-gray-100">
        {ms.image ? (
          <img
            src={getImageUrl(ms.image)}
            alt={ms.name}
            className={`w-full h-full object-cover transition-transform duration-700 ${!unavailable ? 'group-hover:scale-110' : ''}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-r from-gray-100 to-gray-200 text-gray-400">
            <Icon name="milkshake" className="text-6xl" />
          </div>
        )}
      </div>

      <div className="p-6 flex flex-col flex-1">
        <h3 className="text-2xl font-serif font-bold text-gray-900 mb-2">{ms.name}</h3>
        {ms.description && <p className="text-gray-600 text-sm mb-4 line-clamp-2">{ms.description}</p>}
        {catCount > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">
              {catCount} option(s) à composer
            </span>
          </div>
        )}
        <button
          disabled={unavailable}
          className={`w-full py-3 rounded-xl font-bold uppercase tracking-widest text-xs mt-auto transition-all duration-300 ${
            unavailable ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gray-900 text-white group-hover:bg-brand-600'
          }`}
        >
          {unavailable ? 'Non disponible' : 'Composer'}
        </button>
      </div>
    </>
  );

  if (unavailable) {
    return (
      <div className="group relative bg-white rounded-2xl overflow-hidden shadow-xl border border-gray-100 opacity-60 cursor-not-allowed flex flex-col h-full">
        {inner}
      </div>
    );
  }
  return (
    <div
      {...clickable(() => onClick?.(ms))}
      className="group relative bg-white rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-500 cursor-pointer transform hover:-translate-y-2 border border-gray-100 flex flex-col h-full"
    >
      {inner}
    </div>
  );
};

export default MilkshakeCard;
