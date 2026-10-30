/** Lien « Annuler » tant que le montant attend sur le TPE : la caissière reprend la main (mauvais montant…). */
const TerminalCancelButton = ({ terminalStatus, onCancel }) => {
  if (!onCancel || (terminalStatus !== 'collecting' && terminalStatus !== 'processing')) return null;
  return (
    <div className="text-center">
      <button type="button" onClick={onCancel} className="mt-1 text-xs text-red-600 underline">Annuler</button>
    </div>
  );
};

export default TerminalCancelButton;
