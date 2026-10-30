import React from 'react';
// import { IMG_CONCEPT } from '../../constants/homeConstants';
import imgFarm from '../../assets/images/farm-products.webp';
import imgSaladBowl from '../../assets/images/salad-bowl.webp';

const TABS = [
  {
    key: 'naturel',
    label: '100% Naturel',
    paragraphs: [
      "Nous croyons que la restauration rapide ne doit pas sacrifier la qualité. Chaque matin, nos maraîchers partenaires nous livrent des produits bruts que nous découpons sur place.",
      "Des produits frais, sélectionnés avec soin et préparés sur place. Juste le goût authentique des bonnes choses."
    ]
  },
  {
    key: 'plastique',
    label: 'Zéro Plastique',
    paragraphs: [
      "Chez Café Verdé, nous avons banni le plastique à usage unique. Nos emballages sont 100 % compostables ou recyclables, du bol à la fourchette.",
      "Chaque commande est un geste pour la planète. Parce que manger bien ne doit pas coûter cher à la Terre."
    ]
  },
  {
    key: 'maison',
    label: 'Fait Maison',
    paragraphs: [
      "Nos plats antillais, nos marinades et nos sauces signature sont préparés dans notre cuisine, au fil de la journée.",
      "Du colombo mijoté au punch maison, c'est le savoir-faire de nos cuisiniers qui fait la différence dans chaque assiette."
    ]
  }
];

const ManifestoSection = () => {
  return (
    <section className="bg-white filigrane relative">
      <div className="mx-auto px-6 md:px-10 z-[2] relative promise-section-container">
        <div className="flex flex-col">
          <div className="">
            <h3 className="macchiato-title mb-2">Notre Promesse</h3>
            <h2 className="section-title mb-8 md:w-3/4">
              De la Terre <br />à votre assiette,<br />sans escale.
            </h2>
            <div className="promise-row-grid earth-grown relative">
              <div className="promise-img-ctn">
                <img
                  src={imgFarm}
                  alt="Produits locaux provenant de l'agriculture locale"
                  className="rounded-[4px] lg:grayscale lg:hover:grayscale-0 transition-all duration-700"
                />
              </div>
              <div className="promise-row-block">
                <h3 className='promise-block-title'>{TABS[0].label}</h3>
                <p className='promise-paragraph'>{TABS[0].paragraphs[0]} <br /><br />{TABS[0].paragraphs[1]}</p>
              </div>
            </div>
            <div className="promise-row-center">
              <div className="promise-row-block">
                <h3 className='promise-block-title'>{TABS[1].label}</h3>
                <p className='promise-paragraph'>{TABS[1].paragraphs[0]} <br /><br />{TABS[1].paragraphs[1]}</p>
              </div>
            </div>
            <div className="promise-row-grid housemade relative">
              <div className="promise-row-block">
                <h3 className='promise-block-title'>{TABS[2].label}</h3>
                <p className='promise-paragraph'>{TABS[2].paragraphs[0]} <br /><br />{TABS[2].paragraphs[1]} </p>
              </div>
              <div className="promise-img-ctn">
                <img
                  src={imgSaladBowl}
                  alt="De la production locale à votre assiette"
                  className="rounded-[4px] lg:grayscale lg:hover:grayscale-0 transition-all duration-700"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section >
  );
};

export default ManifestoSection;