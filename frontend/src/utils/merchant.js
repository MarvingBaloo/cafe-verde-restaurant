// Identité de l'établissement — SOURCE UNIQUE pour tout document remis au client
// (ticket de caisse, facture). Une adresse ou un SIRET qui diverge d'un document
// à l'autre est un défaut de conformité, pas une coquille : ne jamais recopier
// ces valeurs en dur ailleurs.
export const MERCHANT = {
  name: 'Café Verde',
  addressLines: ['10, Les Poiriers de la Marina,', 'Marina Bas-du-Fort', '97110 Pointe-à-Pitre'],
  website: 'www.cafeverde.gp',
  phone: '0590 02 07 23',
  siret: '10640501200027',
  vat: 'FR76106405012',
};
