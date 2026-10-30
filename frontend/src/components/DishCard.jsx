import { Link } from 'react-router-dom';
import { getImageUrl } from '../utils/imageUtils';
import Icon from './Icon';

const DishCard = ({ dish }) => {
  const unavailable = !dish.isAvailable;

  const content = (
    <>
      {/* Badge Type avec icône — pot (RiCookingPotLine) : 'dish' absent du mapping, 'pot' est le plus sémantique */}
      <div className="absolute top-4 left-4 px-4 py-2 rounded-full font-bold text-xs uppercase tracking-wider z-10 shadow-lg flex items-center gap-2 bg-cherry text-white">
        <Icon name="pot" className="text-sm" />
        Plat Chaud
      </div>

      {/* Badge Prix */}
      <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm text-gray-900 px-4 py-2 rounded-full gelasio text-xl font-bold z-10 shadow-lg">
        {dish.price}€
      </div>

      {/* Badge Indisponible */}
      {unavailable && (
        <div className="absolute bottom-[180px] left-4 bg-gray-900/80 text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider z-10 shadow-lg">
          Indisponible
        </div>
      )}

      {/* Image */}
      <div className="h-48 overflow-hidden bg-gray-100">
        {dish.image ? (
          <img
            src={getImageUrl(dish.image)}
            alt={dish.name}
            className={`w-full h-full object-cover transition-transform duration-700 ${!unavailable ? 'group-hover:scale-110' : ''}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-r from-gray-100 to-gray-200 text-gray-400">
            <Icon name="pot" className="text-6xl" />
          </div>
        )}
      </div>

      {/* Contenu */}
      <div className="p-6 flex flex-col flex-1">
        <h3 className="text-2xl gelasio font-bold text-gray-900 mb-2">{dish.name}</h3>
        {dish.description && (
          <p className="text-gray-600 text-sm mb-4 line-clamp-2">{dish.description}</p>
        )}

        {/* Tags diététiques (même style que badges limites salades) */}
        {dish.dietaryTags?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {dish.dietaryTags.map(tag => (
              <span key={tag} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Fallback : affiche le nb d'accompagnements si pas de tags */}
        {dish.dietaryTags?.length === 0 && dish.sides?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-full">
              {dish.sides.length} accompagnement(s)
            </span>
          </div>
        )}

        {/* Bouton */}
        {unavailable ? (
          <button
            disabled
            className="w-full py-3 rounded-xl bg-gray-300 text-gray-500 font-bold uppercase tracking-widest text-xs cursor-not-allowed mt-auto"
          >
            Non disponible
          </button>
        ) : (
          <button className="w-full py-3 rounded-xl bg-gray-900 text-white font-bold uppercase tracking-widest text-xs group-hover:bg-cherry transition-all duration-300 mt-auto">
            Découvrir ce plat
          </button>
        )}
      </div>
    </>
  );

  // Indisponible : la carte n'est plus un lien. Le contenu est rendu une seule fois
  // et réutilisé — définir le wrapper dans le rendu le recréait à chaque passe et
  // remontait toute la carte.
  if (unavailable) {
    return (
      <div className="group relative bg-white rounded-2xl overflow-hidden shadow-xl border border-gray-100 opacity-60 cursor-not-allowed flex flex-col h-full">
        {content}
      </div>
    );
  }

  return (
    <Link
      to={`/products/dish/${dish._id}`}
      className="group relative bg-white rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-500 cursor-pointer transform hover:-translate-y-2 border border-gray-100 flex flex-col h-full"
    >
      {content}
    </Link>
  );
};

export default DishCard;
