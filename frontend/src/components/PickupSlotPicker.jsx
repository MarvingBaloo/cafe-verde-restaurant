// frontend/src/components/PickupSlotPicker.jsx
// Heure de retrait d'une commande en ligne.
//
// Trois situations, un seul composant :
//  — commande ouverte : le client choisit quand il vient chercher sa commande. Le plus tôt
//    possible est pré-sélectionné par la page, jamais en deçà du délai que la cuisine s'est
//    donné (15 min après l'ouverture, ou après l'instant de la commande) ;
//  — journée close mais le service suivant est demain : on propose de commander pour demain,
//    et le client doit choisir son heure explicitement ;
//  — rien n'est possible (dimanche, avant la pré-ouverture, coupure du gérant) : on explique
//    et on s'arrête.
import React from 'react';
import PropTypes from 'prop-types';
import Icon from './Icon';
import { humanTime, zonedToUtc } from '../utils/hours';

const PickupSlotPicker = ({ offer, closed, selectedPickup, onSelectPickup, message }) => {
  // Fermé sans repli possible : il n'y a rien à choisir, seulement à expliquer.
  if (!offer) {
    if (!closed) return null;
    return (
      <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-gray-500"><Icon name="time" /></span>
          <div className="flex-1">
            <p className="font-bold text-gray-900">Commandes en ligne fermées</p>
            <p className="mt-1 text-sm text-gray-600">{message}</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedSlot = offer.slots.find(
    (s) => zonedToUtc(offer.date, s)?.toISOString() === selectedPickup
  );

  return (
    <div className={`mb-5 rounded-xl border p-4 ${closed ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <span className={closed ? 'text-amber-600' : 'text-brand-600'}>
          <Icon name="time" />
        </span>
        <div className="flex-1">
          <p className="font-bold text-gray-900">
            {closed ? "Les commandes pour aujourd'hui sont closes" : 'Heure de retrait'}
          </p>
          {closed && <p className="mt-1 text-sm text-gray-600">{message}</p>}

          <p className="mt-3 text-sm font-semibold text-gray-900">
            {closed
              ? `Vous pouvez commander pour ${offer.weekdayName}. À quelle heure venez-vous la chercher ?`
              : 'À quelle heure venez-vous chercher votre commande ?'}
          </p>

          {/* La liste couvre tout le service : on la borne en hauteur plutôt que de repousser
              le formulaire de paiement sous une trentaine de boutons. */}
          <div className="mt-3 flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {offer.slots.map((slot) => {
              const iso = zonedToUtc(offer.date, slot)?.toISOString();
              const active = selectedPickup === iso;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => onSelectPickup(active ? null : iso)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    active
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white border-gray-200 text-gray-700 hover:border-brand-400'
                  }`}
                >
                  {humanTime(slot)}
                </button>
              );
            })}
          </div>

          {selectedSlot && (
            <p className="mt-3 text-sm text-brand-700 font-semibold">
              {closed
                ? `Retrait ${offer.weekdayName} à ${humanTime(selectedSlot)}. Vous réglez maintenant, votre commande est préparée pour cette heure.`
                : `Retrait à ${humanTime(selectedSlot)}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

PickupSlotPicker.propTypes = {
  offer: PropTypes.object,
  closed: PropTypes.bool,
  selectedPickup: PropTypes.string,
  onSelectPickup: PropTypes.func.isRequired,
  message: PropTypes.string,
};

export default PickupSlotPicker;
