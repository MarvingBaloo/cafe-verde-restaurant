// frontend/src/pages/legal/MentionsLegales.jsx
import React from 'react';
import LegalPage, { LegalSection } from './LegalPage';
import legalInfo from '../../data/legalInfo';

const MentionsLegales = () => (
  <LegalPage title="Mentions légales" current="/mentions-legales">
    <p>
      Conformément à l'article 6 III de la loi n° 2004-575 du 21 juin 2004 pour
      la confiance dans l'économie numérique (LCEN), il est porté à la
      connaissance des utilisateurs du site {legalInfo.siteName} les présentes
      mentions légales.
    </p>

    <LegalSection title="1. Éditeur du site">
      <p>
        Le site {legalInfo.siteName} est édité par&nbsp;:
      </p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Raison sociale : {legalInfo.raisonSociale}</li>
        <li>Forme juridique : {legalInfo.formeJuridique}</li>
        <li>Capital social : {legalInfo.capitalSocial}</li>
        <li>Siège social : {legalInfo.adresse}</li>
        <li>SIRET : {legalInfo.siret}</li>
        <li>{legalInfo.rcs}</li>
        <li>N° TVA intracommunautaire : {legalInfo.tvaIntra}</li>
        <li>Adresse e-mail : {legalInfo.email}</li>
        <li>Téléphone : {legalInfo.telephone}</li>
      </ul>
    </LegalSection>

    <LegalSection title="2. Directeur de la publication">
      <p>{legalInfo.directeurPublication}</p>
    </LegalSection>

    <LegalSection title="3. Hébergement">
      <p>Le site et ses services sont hébergés par&nbsp;:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Site (frontend) : {legalInfo.hebergeurFront}</li>
        <li>API (backend) : {legalInfo.hebergeurBack}</li>
        <li>Base de données et fichiers : {legalInfo.hebergeurData}</li>
      </ul>
    </LegalSection>

    <LegalSection title="4. Propriété intellectuelle">
      <p>
        L'ensemble des éléments du site (textes, visuels, logo, charte
        graphique, photographies, code) est protégé par le droit de la propriété
        intellectuelle et reste la propriété exclusive de {legalInfo.raisonSociale},
        sauf mention contraire. Toute reproduction, représentation,
        modification ou exploitation, totale ou partielle, sans autorisation
        écrite préalable est interdite et constitue une contrefaçon.
      </p>
    </LegalSection>

    <LegalSection title="5. Responsabilité">
      <p>
        {legalInfo.raisonSociale} s'efforce d'assurer l'exactitude des
        informations diffusées sur le site mais ne saurait être tenue
        responsable des erreurs, omissions ou d'une indisponibilité temporaire
        du service. Les liens vers des sites tiers n'engagent pas la
        responsabilité de l'éditeur quant à leur contenu.
      </p>
    </LegalSection>

    <LegalSection title="6. Données personnelles">
      <p>
        Le traitement des données personnelles est détaillé dans la{' '}
        <a href="/confidentialite" className="text-brand-600 underline">
          Politique de confidentialité
        </a>
        . Pour toute question : {legalInfo.dpoContact}.
      </p>
    </LegalSection>

    <LegalSection title="7. Droit applicable">
      <p>
        Les présentes mentions légales sont soumises au droit français. En cas
        de litige, et à défaut de résolution amiable, les tribunaux français
        sont seuls compétents.
      </p>
    </LegalSection>
  </LegalPage>
);

export default MentionsLegales;
