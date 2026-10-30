// Modale « Facture » réutilisable (Caisse, Espace Gérant, Espace client, Espace DEV).
// Édite à la demande la facture d'une commande : détaillée ou non, avec les coordonnées
// de facturation saisies sur place. Rien n'est persisté — cf. `utils/invoice.js`.
import React, { useState } from 'react';
import Invoice from '../Invoice';
import PrintArea from '../PrintArea';
import Icon from '../Icon';
import { orderToInvoice } from '../../utils/invoice';
import PropTypes from 'prop-types';

const field = 'w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-400 outline-none';

// Défini hors du composant : imbriqué, il était recréé à chaque rendu et React
// remontait les deux boutons au lieu de les mettre à jour.
const ModeButton = ({ value, label, detail, onPick }) => (
  <button
    onClick={() => onPick(value)}
    className={`flex-1 py-3 border-2 rounded-lg font-bold text-sm transition ${
      detail === value
        ? 'border-brand-600 bg-brand-50 text-brand-700'
        : 'border-gray-200 text-gray-500 hover:bg-gray-50'
    }`}
  >
    {label}
  </button>
);

ModeButton.propTypes = {
  value: PropTypes.bool.isRequired,
  label: PropTypes.string.isRequired,
  detail: PropTypes.bool.isRequired,
  onPick: PropTypes.func.isRequired,
};

const InvoiceModal = ({ order, onClose }) => {
  const [detail, setDetail] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [billing, setBilling] = useState({
    name: order?.customerName || '',
    address: '',
    zipCity: '',
    siret: '',
    vat: '',
  });

  if (!order) return null;

  const set = (k) => (e) => setBilling((b) => ({ ...b, [k]: e.target.value }));
  const invoiceProps = orderToInvoice(order, { detail, billing });

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-800 inline-flex items-center gap-2">
              <Icon name="invoice" className="text-brand-600" /> Facture
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fermer">
              <Icon name="close" className="w-5 h-5 inline" />
            </button>
          </div>

          <div className="p-4 grid md:grid-cols-2 gap-4">
            {/* Paramètres */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Type de facture</p>
              <div className="flex gap-2 mb-4">
                <ModeButton value={true} label="Détaillée" detail={detail} onPick={setDetail} />
                <ModeButton value={false} label="Non détaillée" detail={detail} onPick={setDetail} />
              </div>
              <p className="text-xs text-gray-500 mb-4">
                {detail
                  ? 'Chaque article figure sur la facture.'
                  : 'Une ligne unique « Prestation de restauration » avec le nombre d’articles.'}
              </p>

              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Client</p>
              <label className="block text-sm font-semibold text-gray-600 mb-1">Nom ou raison sociale</label>
              <input value={billing.name} onChange={set('name')} placeholder="Nom du client" className={field} />

              {!showDetails ? (
                <button
                  onClick={() => setShowDetails(true)}
                  className="mt-3 text-sm font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
                >
                  <Icon name="add" /> Ajouter les coordonnées de facturation
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <input value={billing.address} onChange={set('address')} placeholder="Adresse" className={field} />
                  <input value={billing.zipCity} onChange={set('zipCity')} placeholder="Code postal et ville" className={field} />
                  <input value={billing.siret} onChange={set('siret')} placeholder="SIRET" className={field} />
                  <input value={billing.vat} onChange={set('vat')} placeholder="TVA intracommunautaire" className={field} />
                  <p className="text-xs text-gray-400">
                    Champs facultatifs — au-delà de 25 €, une facture doit porter l’identité complète de l’acheteur.
                  </p>
                </div>
              )}
            </div>

            {/* Aperçu */}
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Aperçu</p>
              <div className="bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto">
                <Invoice {...invoiceProps} />
              </div>
            </div>
          </div>

          <div className="flex gap-2 p-4 border-t border-gray-100">
            <button
              onClick={() => window.print()}
              className="flex-1 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold inline-flex items-center justify-center gap-2 transition"
            >
              <Icon name="print" /> Imprimer la facture
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>

      {/* Zone d'impression hors #root : seule à s'imprimer */}
      <PrintArea>
        <Invoice {...invoiceProps} />
      </PrintArea>
    </>
  );
};

export default InvoiceModal;
