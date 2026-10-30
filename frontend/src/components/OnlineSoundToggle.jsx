import React from 'react';
import Icon from './Icon';

/**
 * Interrupteur global de l'alerte sonore « commandes en ligne » (Espace Gérant).
 * Le réglage est partagé par toutes les pages de la plateforme et tous les onglets ouverts.
 */
const OnlineSoundToggle = ({ alert }) => {
  const { enabled, toggle, needsUnlock, unlock } = alert;

  if (needsUnlock) {
    return (
      <button
        onClick={unlock}
        title="Le navigateur bloque le son tant que la page n'a pas été cliquée"
        className="text-sm bg-amber-400 hover:bg-amber-500 text-amber-950 border border-amber-500 px-3 py-2 rounded-lg shadow-sm font-medium flex items-center gap-2"
      >
        <Icon name="bell" />
        <span className="hidden sm:inline">Activer le son</span>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title={enabled
        ? 'Alerte sonore des commandes en ligne active — cliquer pour la couper partout'
        : 'Alerte sonore coupée — cliquer pour la réactiver partout'}
      className={`text-sm bg-white border px-3 py-2 rounded-lg hover:bg-gray-100 shadow-sm font-medium flex items-center gap-2 ${
        enabled ? 'border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400'
      }`}
    >
      <Icon name={enabled ? 'bell' : 'bell_off'} />
      <span className="hidden sm:inline">{enabled ? 'Son activé' : 'Son coupé'}</span>
    </button>
  );
};

export default OnlineSoundToggle;
