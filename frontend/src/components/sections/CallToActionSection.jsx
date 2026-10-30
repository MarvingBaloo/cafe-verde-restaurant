import React from 'react';
import coinLogo from '../../assets/svg/logo-coin.svg'

/**
 * @description Section Call-to-Action finale avec bouton principal
 * @param {Object} props
 * @param {Function} props.onStartOrder - Callback au clic sur "Commencer ma Commande"
 */
const CallToActionSection = ({ onStartOrder }) => {
  return (
    <section className="cta-section">
      <div className="relative z-10 container mx-auto px-2">
        <img src={coinLogo} alt="" className='mx-auto mb-12 coin-logo' />
        <h2 className="section-title gelasio mb-8">Prêt à déguster ?</h2>
        <p className="incentive-text max-w-2xl mx-auto mb-12">
          Fraîcheur et évasion dans chaque verre. <br />
          Jus naturels, boissons fraîches et bien plus.
        </p>
        <button
          onClick={onStartOrder}
          className="uppercase text-[--footerGreen] font-bold rounded-full shadow-2xl shadow-honey/0 hover:shadow-honey/20 hover:-translate-y-0.5 transition-all duration-300 cta-button"
        >
          Commencer ma Commande
        </button>
      </div>
    </section>
  );
};

export default CallToActionSection;