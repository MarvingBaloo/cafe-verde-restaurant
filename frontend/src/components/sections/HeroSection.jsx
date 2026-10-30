import React from 'react';
import { IMG_SALAD_HERO, IMG_HOT_DISH_HERO, IMG_DRINKS_HERO, IMG_DESSERT_HERO } from '../../constants/homeConstants';
import HeroCard from '../HeroCard';

/**
 * @description Section héro : grille 2×2 de 576px à 1359px, 4 colonnes égales à partir de 1360px. Empilée en colonne en dessous.
 * @param {Function} props.onSaladClick - Callback au clic sur "Composer ma salade"
 * @param {Function} props.onHotDishClick - Callback au clic sur "Découvrir les plats"
 * @param {Function} props.onDrinksClick - Callback au clic sur "Boissons"
 * @param {Function} props.onDessertsClick - Callback au clic sur "Voir nos desserts"
 */
const HeroSection = ({ onSaladClick, onHotDishClick, onDrinksClick, onDessertsClick }) => {
  return (
    <section className="w-full h-[90vh] flex flex-col gap-1 p-0 min-[576px]:grid min-[576px]:grid-cols-2 min-[576px]:grid-rows-2 min-[576px]:gap-[2px] min-[1360px]:grid-cols-4 min-[1360px]:grid-rows-1">

      {/* Salade à composer */}
      <HeroCard
        backgroundImg={IMG_SALAD_HERO}
        yellowLabel='Healthy & fresh'
        sectionLabel='Salades'
        buttonLabel='Composer ma salade'
        action={onSaladClick}
      />

      {/* Plats Chauds */}
      <HeroCard
        backgroundImg={IMG_HOT_DISH_HERO}
        yellowLabel='Saveur des îles'
        sectionLabel='Plats chauds'
        buttonLabel='Découvrir les plats'
        action={onHotDishClick}
      />

      {/* Desserts */}
      <HeroCard
        backgroundImg={IMG_DESSERT_HERO}
        yellowLabel='Gourmandise'
        sectionLabel='Plaisirs Sucrés'
        buttonLabel='Voir nos desserts'
        action={onDessertsClick}
      />

      {/* Boissons */}
      <HeroCard
        backgroundImg={IMG_DRINKS_HERO}
        yellowLabel='Fraîcheur et évasion'
        sectionLabel='Boissons'
        buttonLabel='Voir nos boissons'
        action={onDrinksClick}
      />

    </section>
  );
};

export default HeroSection;
