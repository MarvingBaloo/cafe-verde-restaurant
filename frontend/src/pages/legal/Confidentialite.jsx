// frontend/src/pages/legal/Confidentialite.jsx
import React from 'react';
import LegalPage, { LegalSection } from './LegalPage';
import legalInfo from '../../data/legalInfo';

const Confidentialite = () => (
  <LegalPage title="Politique de confidentialité" current="/confidentialite">
    <p>
      La présente politique décrit la manière dont {legalInfo.raisonSociale}{' '}
      (« {legalInfo.siteName} ») collecte et traite les données personnelles des
      utilisateurs, conformément au Règlement Général sur la Protection des
      Données (RGPD) et à la loi Informatique et Libertés.
    </p>

    <LegalSection title="1. Responsable du traitement">
      <p>
        {legalInfo.raisonSociale}, {legalInfo.adresse}. Contact pour toute
        question relative aux données : {legalInfo.dpoContact}.
      </p>
    </LegalSection>

    <LegalSection title="2. Données collectées">
      <p>Selon les usages, {legalInfo.siteName} est susceptible de collecter :</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>données d'identification : nom, numéro de téléphone, adresse e-mail ;</li>
        <li>données de compte : identifiant Firebase, rôle, points de fidélité ;</li>
        <li>données de commande : produits commandés, montants, horodatage ;</li>
        <li>données techniques et d'usage : pages consultées, événements d'activité (analytics).</li>
      </ul>
    </LegalSection>

    <LegalSection title="3. Finalités et bases légales">
      <ul className="list-disc pl-5 space-y-1">
        <li>Gestion des comptes et authentification — exécution du contrat ;</li>
        <li>Traitement et suivi des commandes — exécution du contrat ;</li>
        <li>Programme de fidélité — exécution du contrat / consentement ;</li>
        <li>Amélioration du service et statistiques d'usage — intérêt légitime ;</li>
        <li>Respect des obligations légales et comptables — obligation légale.</li>
      </ul>
    </LegalSection>

    <LegalSection title="4. Sous-traitants et hébergement">
      <p>
        Les données sont hébergées et traitées via les services Google Firebase
        (Authentication, Firestore, Storage) et Google Cloud Run, ainsi que
        Vercel pour l'hébergement du site. Ces prestataires agissent en qualité
        de sous-traitants. Certaines données peuvent être hébergées en dehors de
        l'Union européenne, encadrées par les clauses contractuelles types de la
        Commission européenne. [Préciser tout autre sous-traitant, ex :
        prestataire de paiement, service SMS.]
      </p>
    </LegalSection>

    <LegalSection title="5. Durée de conservation">
      <p>
        Les données de compte sont conservées tant que le compte est actif. Les
        données de commande sont conservées pour la durée nécessaire aux
        obligations légales (notamment comptables). [Préciser les durées exactes,
        ex : factures conservées 10 ans.]
      </p>
    </LegalSection>

    <LegalSection title="6. Vos droits">
      <p>
        Conformément au RGPD, l'utilisateur dispose d'un droit d'accès, de
        rectification, d'effacement, de limitation, d'opposition et de
        portabilité de ses données. Ces droits s'exercent auprès de{' '}
        {legalInfo.dpoContact}. L'utilisateur peut également introduire une
        réclamation auprès de la CNIL (www.cnil.fr).
      </p>
    </LegalSection>

    <LegalSection title="7. Cookies et traceurs">
      <p>
        Le service peut utiliser des cookies et technologies similaires
        nécessaires à son fonctionnement (session, authentification) et, le cas
        échéant, à des fins de mesure d'audience. [Décrire ici les cookies
        utilisés et, si des traceurs non essentiels sont présents, mettre en
        place une bannière de consentement.]
      </p>
    </LegalSection>

    <LegalSection title="8. Sécurité">
      <p>
        {legalInfo.siteName} met en œuvre des mesures techniques et
        organisationnelles appropriées pour protéger les données contre tout
        accès non autorisé, perte ou altération. Les mots de passe sont gérés par
        Firebase Authentication et ne sont jamais stockés en clair.
      </p>
    </LegalSection>

    <LegalSection title="9. Modification de la politique">
      <p>
        La présente politique peut être mise à jour à tout moment. La version
        applicable est celle publiée à la date de consultation.
      </p>
    </LegalSection>
  </LegalPage>
);

export default Confidentialite;
