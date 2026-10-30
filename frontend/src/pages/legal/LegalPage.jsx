// frontend/src/pages/legal/LegalPage.jsx
import React from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import legalInfo from '../../data/legalInfo';

/**
 * Mise en page commune aux documents légaux (mentions, CGV, CGU, confidentialité).
 * Fournit un cadre lisible et la navigation croisée entre les pages légales.
 */
const LEGAL_LINKS = [
  { to: '/mentions-legales', label: 'Mentions légales' },
  { to: '/cgv', label: 'CGV' },
  { to: '/cgu', label: 'CGU' },
  { to: '/confidentialite', label: 'Confidentialité' },
];

const LegalPage = ({ title, children, current }) => {
  React.useEffect(() => {
    document.title = `${title} — ${legalInfo.siteName}`;
  }, [title]);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="container mx-auto px-4 py-10 md:py-16 max-w-3xl">
        {/* Navigation croisée */}
        <nav className="flex flex-wrap gap-2 text-xs font-medium mb-8">
          {LEGAL_LINKS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`px-3 py-1.5 rounded-full transition-colors ${
                current === to
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-gray-500 hover:text-brand-600 border border-gray-200'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <article className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-8 md:px-10 md:py-12">
          <h1 className="text-2xl md:text-3xl gelasio italic font-bold text-brand-800 mb-2">
            {title}
          </h1>
          <p className="text-xs text-gray-400 mb-8">
            Dernière mise à jour : {legalInfo.lastUpdated}
          </p>
          <div className="legal-content space-y-6 text-sm leading-relaxed text-gray-700">
            {children}
          </div>
        </article>

        <p className="text-[11px] text-gray-400 mt-6 text-center">
          {legalInfo.siteName} — document fourni à titre informatif.
        </p>
      </div>
    </div>
  );
};

LegalPage.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  current: PropTypes.string.isRequired,
};

/** Sous-titre de section réutilisable. */
export const LegalSection = ({ title, children }) => (
  <section className="space-y-2">
    {title && (
      <h2 className="text-base font-bold text-gray-900 mt-2">{title}</h2>
    )}
    {children}
  </section>
);

LegalSection.propTypes = {
  title: PropTypes.string,
  children: PropTypes.node.isRequired,
};

export default LegalPage;
