/**
 * @file Constantes pour la page d'accueil (Home)
 * Contient les images, métadonnées et configurations partagées entre les sections.
 */

import saladHero from '../assets/images/salad-hero.webp';
import hotDishHero from '../assets/images/hot-dish-hero.webp';
import boissonHero from '../assets/images/boisson-hero.webp';
import dessertHero from '../assets/images/dessert2-hero.webp';

import riceIcon from '../assets/svg/rice-icon.svg';
import pastaIcon from '../assets/svg/pasta-icon.svg';
import saladIcon from '../assets/svg/salad-icon.svg';
import beefIcon from '../assets/svg/meat-icon.svg';
import chickenIcon from '../assets/svg/chicken-icon.svg';
import salmonIcon from '../assets/svg/salmon-icon.svg';
import saltIcon from '../assets/svg/salt-icon.svg';
import seedsIcon from '../assets/svg/toppings-icon.svg';
import bowlIcon from '../assets/svg/bowl-icon.svg';


// --- ASSETS PREMIUM (Images Haute Définition) ---
export const IMG_SALAD_HERO = saladHero;
export const IMG_HOT_DISH_HERO = hotDishHero;
export const IMG_DRINKS_HERO = boissonHero;
export const IMG_DESSERT_HERO = dessertHero;
export const IMG_CONCEPT = "https://images.unsplash.com/photo-1466637574441-749b8f19452f?q=80&w=2080&auto=format&fit=crop";
export const IMG_PRESENTATION_SALAD = "https://images.unsplash.com/photo-1543339308-43e59d6b73a6?q=80&w=2070&auto=format&fit=crop";

// Images pour les formules par type
export const FORMULA_IMAGES = {
  salad: {
    standard: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=2080&auto=format&fit=crop",
    medium: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?q=80&w=2070&auto=format&fit=crop",
    big: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=2070&auto=format&fit=crop"
  }
};

// Métadonnées des formules
export const FORMULA_META = {
  salad: {
    standard: {
      badge: { text: "Découverte", color: "bg-blue-500" },
      description: "Parfait pour une pause légère ou un accompagnement",
      calories: "~350 kcal",
      tag: "Léger"
    },
    medium: {
      badge: { text: "Populaire", color: "bg-orange-500" },
      description: "L'équilibre idéal entre gourmandise et nutrition",
      calories: "~550 kcal",
      tag: "Équilibré"
    },
    big: {
      badge: { text: "Meilleur Rapport", color: "bg-brand-600" },
      description: "Pour les grands appétits ou les sportifs",
      calories: "~750 kcal",
      tag: "Gourmand"
    }
  }
};

// Options pour le Mood Food (icônes définies dans le composant MoodFoodSection)
export const MOOD_OPTIONS = [
  {
    id: 'sport',
    iconName: 'sport',
    label: 'Retour de Sport',
    desc: 'Protéines & Récupération',
    color: 'bg-orange-50 hover:bg-orange-100 text-orange-700'
  },
  {
    id: 'fatigue',
    iconName: 'fatigue',
    label: 'Coup de barre',
    desc: 'Vitamines & Boost',
    color: 'bg-yellow-50 hover:bg-yellow-100 text-yellow-700'
  },
  {
    id: 'focus',
    iconName: 'focus',
    label: 'Concentration',
    desc: 'Léger & Omega-3',
    color: 'bg-blue-50 hover:bg-blue-100 text-blue-700'
  },
  {
    id: 'comfort',
    iconName: 'comfort',
    label: 'Réconfort',
    desc: 'Douceur & Plaisir',
    color: 'bg-purple-50 hover:bg-purple-100 text-purple-700'
  }
];

// Étapes pour "Comment ça marche"
export const HOW_IT_WORKS_STEPS = [
  { icon: "1", title: "Choisissez votre Base", text: "Riz vinaigré, Quinoa, Salade ou Pâtes.", illustrations: [{ url: riceIcon }, { url: pastaIcon }, { url: saladIcon }] },
  { icon: "2", title: "Ajoutez la Protéine", text: "Boeuf, Poulet ou Saumon.", illustrations: [{ url: beefIcon }, { url: chickenIcon }, { url: salmonIcon }] },
  { icon: "3", title: "Sublimez le tout", text: "Toppings croquants et sauces.", illustrations: [{ url: saltIcon }, { url: seedsIcon }, { url: bowlIcon }] }
];

// Témoignages
export const TESTIMONIALS = [
  { name: "Julie D.", text: "Le saumon mariné est une tuerie. Et le Bubble Tea Taro... mon nouveau péché mignon !" },
  { name: "Marc A.", text: "Enfin un bar à salade où on n'a pas faim 2h après. Les portions 'Big' sont vraiment généreuses." },
  { name: "Sophie L.", text: "Rapide, frais, et l'interface de commande est super fluide. Je recommande !" }
];

// FAQ par type de formule
export const FAQ_BY_TYPE = {
  salad: [
    {
      icon: "salad",
      title: "Standard",
      description: "Idéale pour une pause légère ou un déjeuner sans trop de calories."
    },
    {
      icon: "bento",
      title: "Medium",
      description: "Le choix parfait pour un repas complet et équilibré. Notre formule la plus populaire !"
    },
    {
      icon: "pot",
      title: "Big",
      description: "Pour les grosses faims ou les sportifs. Le meilleur rapport qualité-prix !"
    }
  ]
};