// frontend/src/pages/legal/CGV.jsx
import React from 'react';
import LegalPage, { LegalSection } from './LegalPage';
import legalInfo from '../../data/legalInfo';

const CGV = () => (
  <LegalPage title="Conditions Générales de Vente" current="/cgv">
    <p>
      Les présentes Conditions Générales de Vente (CGV) régissent les ventes de
      produits et services de restauration proposés par {legalInfo.raisonSociale}{' '}
      (« {legalInfo.siteName} ») via son site et son application. Toute commande
      implique l'acceptation pleine et entière des présentes CGV.
    </p>

    <LegalSection title="1. Produits et prix">
      <p>
        Les produits proposés (salades à composer, plats chauds, petits
        déjeuners, goûters, boissons) sont décrits sur le site avec leur prix en
        euros, toutes taxes comprises (TTC). {legalInfo.siteName} se réserve le
        droit de modifier ses prix à tout moment ; le prix appliqué est celui en
        vigueur au moment de la validation de la commande.
      </p>
    </LegalSection>

    <LegalSection title="2. Commande">
      <p>
        Le client compose sa commande puis la valide. Un récapitulatif est
        présenté avant confirmation. La vente est réputée conclue à la
        confirmation de la commande. {legalInfo.siteName} se réserve le droit de
        refuser ou d'annuler toute commande en cas de litige, de rupture de
        stock ou de motif légitime.
      </p>
    </LegalSection>

    <LegalSection title="3. Paiement">
      <p>
        Le paiement s'effectue [PRÉCISER LES MOYENS DE PAIEMENT — ex : en ligne
        par carte bancaire, sur place à la caisse]. Les paiements en ligne sont
        sécurisés via [PRESTATAIRE DE PAIEMENT — ex : Stripe]. La commande n'est
        considérée comme effective qu'après encaissement complet du prix.
      </p>
    </LegalSection>

    <LegalSection title="4. Retrait et livraison">
      <p>
        Les commandes sont [À PRÉCISER : à retirer sur place / à consommer sur
        place / livrées dans la zone définie]. Les horaires de retrait suivent
        les horaires d'ouverture : lundi au samedi 12h–21h en continu (fermé le
        dimanche). Les délais de préparation sont donnés à titre
        indicatif.
      </p>
    </LegalSection>

    <LegalSection title="5. Droit de rétractation">
      <p>
        Conformément à l'article L221-28 du Code de la consommation, le droit de
        rétractation ne s'applique pas aux denrées alimentaires périssables ni
        aux prestations de restauration fournies à une date déterminée. Une
        commande de produits alimentaires confirmée ne peut donc faire l'objet
        d'une rétractation. [ADAPTER SELON LA POLITIQUE D'ANNULATION RÉELLE.]
      </p>
    </LegalSection>

    <LegalSection title="6. Allergènes et information produit">
      <p>
        Les informations relatives aux allergènes sont disponibles [À PRÉCISER :
        sur demande / sur les fiches produit]. Il appartient au client de
        signaler toute allergie ou intolérance avant de finaliser sa commande.
      </p>
    </LegalSection>

    <LegalSection title="7. Réclamations">
      <p>
        Toute réclamation peut être adressée à {legalInfo.email} ou par
        téléphone au {legalInfo.telephone}. {legalInfo.siteName} s'engage à
        répondre dans les meilleurs délais.
      </p>
    </LegalSection>

    <LegalSection title="8. Médiation de la consommation">
      <p>
        Conformément aux articles L611-1 et suivants du Code de la consommation,
        le client peut recourir gratuitement à un médiateur de la consommation
        en vue de la résolution amiable d'un litige. Médiateur compétent :{' '}
        {legalInfo.mediateur}.
      </p>
    </LegalSection>

    <LegalSection title="9. Droit applicable">
      <p>
        Les présentes CGV sont soumises au droit français. Tout litige relève de
        la compétence des tribunaux français, sous réserve des règles
        protectrices applicables aux consommateurs.
      </p>
    </LegalSection>
  </LegalPage>
);

export default CGV;
