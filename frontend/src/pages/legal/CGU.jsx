// frontend/src/pages/legal/CGU.jsx
import React from 'react';
import LegalPage, { LegalSection } from './LegalPage';
import legalInfo from '../../data/legalInfo';

const CGU = () => (
  <LegalPage title="Conditions Générales d'Utilisation" current="/cgu">
    <p>
      Les présentes Conditions Générales d'Utilisation (CGU) définissent les
      modalités d'accès et d'usage du site et de l'application {legalInfo.siteName},
      édités par {legalInfo.raisonSociale}. En accédant au service, l'utilisateur
      accepte sans réserve les présentes CGU.
    </p>

    <LegalSection title="1. Objet du service">
      <p>
        {legalInfo.siteName} permet de consulter une carte de restauration, de
        composer des produits, de passer commande et, le cas échéant, de gérer un
        compte client et un programme de fidélité.
      </p>
    </LegalSection>

    <LegalSection title="2. Accès au service">
      <p>
        Le service est accessible gratuitement à tout utilisateur disposant d'un
        accès à Internet. Les coûts liés à l'accès (matériel, connexion) restent
        à la charge de l'utilisateur. {legalInfo.siteName} s'efforce d'assurer la
        disponibilité du service mais ne garantit pas une accessibilité
        ininterrompue et peut suspendre l'accès pour maintenance.
      </p>
    </LegalSection>

    <LegalSection title="3. Compte utilisateur">
      <p>
        La création d'un compte peut s'effectuer par numéro de téléphone (code de
        vérification par SMS) ou par adresse e-mail et mot de passe.
        L'authentification est gérée via Firebase Authentication. L'utilisateur
        est responsable de la confidentialité de ses identifiants et de toute
        activité réalisée depuis son compte. Toute utilisation frauduleuse doit
        être signalée à {legalInfo.email}.
      </p>
    </LegalSection>

    <LegalSection title="4. Obligations de l'utilisateur">
      <p>L'utilisateur s'engage à&nbsp;:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>fournir des informations exactes lors de son inscription et de ses commandes ;</li>
        <li>ne pas utiliser le service à des fins illicites ou frauduleuses ;</li>
        <li>ne pas perturber le fonctionnement du service ni tenter d'y accéder de manière non autorisée ;</li>
        <li>respecter les droits de propriété intellectuelle de l'éditeur.</li>
      </ul>
    </LegalSection>

    <LegalSection title="5. Propriété intellectuelle">
      <p>
        L'ensemble des contenus du service (marque, logo, textes, visuels, code)
        est protégé. Aucune reproduction ou réutilisation n'est autorisée sans
        accord écrit préalable de {legalInfo.raisonSociale}.
      </p>
    </LegalSection>

    <LegalSection title="6. Responsabilité">
      <p>
        {legalInfo.siteName} ne saurait être tenue responsable des dommages
        résultant d'une mauvaise utilisation du service, d'une interruption, ou
        de la présence éventuelle d'un contenu erroné. Les conditions de vente
        des produits sont régies par les{' '}
        <a href="/cgv" className="text-brand-600 underline">CGV</a>.
      </p>
    </LegalSection>

    <LegalSection title="7. Données personnelles">
      <p>
        Le traitement des données personnelles est décrit dans la{' '}
        <a href="/confidentialite" className="text-brand-600 underline">
          Politique de confidentialité
        </a>
        .
      </p>
    </LegalSection>

    <LegalSection title="8. Modification des CGU">
      <p>
        {legalInfo.siteName} se réserve le droit de modifier les présentes CGU à
        tout moment. Les CGU applicables sont celles en vigueur à la date
        d'utilisation du service.
      </p>
    </LegalSection>

    <LegalSection title="9. Droit applicable">
      <p>
        Les présentes CGU sont soumises au droit français. Tout litige relève de
        la compétence des tribunaux français.
      </p>
    </LegalSection>
  </LegalPage>
);

export default CGU;
