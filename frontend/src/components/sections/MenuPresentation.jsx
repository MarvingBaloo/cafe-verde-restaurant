import React from 'react';
import { clickable } from '../../utils/a11y';
import imgSalad from '../../assets/images/presentation_salad.webp';
import imgHotDish from '../../assets/images/hot-dish-hero.webp';
import imgBoisson from '../../assets/images/boisson-hero.webp';
import imgDessert from '../../assets/images/dessert-hero.webp';
import MenuCard from './MenuCard';

const CARDS = [
  {
    key: 'salad',
    title: 'La Salade Café Verde',
    description: 'Fraîcheur croquante aux accents des îles. Composez votre bol avec des ingrédients sélectionnés chaque matin.',
    badge: 'Fraîcheur',
    cta: 'Créer ma salade',
    image: imgSalad,
    tags: ['Bases au choix', 'Protéines premium', 'Sauces'],
    handlerKey: 'onSaladClick',
  },
  {
    key: 'hot_dish',
    title: 'Les Plats Chauds',
    description: 'Saveurs des îles à chaque bouchée. Plats antillais mijotés, généreux et réconfortants.',
    badge: 'Saveurs des îles',
    cta: 'Voir les plats',
    image: imgHotDish,
    tags: ['Cuisine antillaise', 'Fait maison', 'Servi chaud'],
    handlerKey: 'onHotDishClick',
  },
  {
    key: 'desserts',
    title: 'Plaisirs Sucrés',
    description: 'Douceurs gourmandes et milkshakes à composer pour finir le repas en beauté.',
    badge: 'Gourmandise',
    cta: 'Découvrir',
    image: imgDessert,
    tags: ['Desserts maison', 'Milkshakes', 'Glaces'],
    handlerKey: 'onDessertsClick',
  },
  {
    key: 'drinks',
    title: 'Nos Boissons',
    description: 'Fraîcheur et évasion dans chaque verre. Jus naturels, boissons fraîches et bien plus.',
    badge: 'Fraîcheur',
    cta: 'Découvrir',
    image: imgBoisson,
    tags: ['Jus naturels', 'Boissons fraîches', 'Sans alcool'],
    handlerKey: 'onDrinksClick',
  },
];

const MenuPresentation = ({ onSaladClick, onHotDishClick, onDrinksClick, onDessertsClick }) => {
  const handlers = { onSaladClick, onHotDishClick, onDrinksClick, onDessertsClick };

  return (
    <section id="menu" className="bg-gradient-to-b from-white to-gray-50 relative filigrane">
      <div className="mx-auto px-4 md:px-6 relative z-[10]">

        <div className="text-center mb-12">
          <h3 className="macchiato-title mb-2">Notre Carte</h3>
          <h2 className="section-title mb-8">
            Notre Univers Gourmand
          </h2>
          <div className="separator" />
          <p className="menu-section-headline">
            Des salades fraîches aux plats antillais qui réconfortent.
          </p>
        </div>

        <div className="menu-card-grid mx-auto">
          {CARDS.map(card => (
            <MenuCard key={card.key} cardObject={card} clickableFnc={clickable(handlers[card.handlerKey])} />
          ))}
        </div>

      </div>
    </section>
  );
};

export default MenuPresentation;
