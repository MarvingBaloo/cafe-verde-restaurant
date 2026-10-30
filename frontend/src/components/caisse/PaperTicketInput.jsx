const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const PaperTicketInput = ({ value, onChange, due, autoFocus = false }) => {
  const given = round2(parseFloat(value) || 0);
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-gray-700">
        Montant des tickets remis (à régler {due.toFixed(2)} €)
      </label>
      <input
        type="number" step="0.01" min="0"
        value={value} onChange={e => onChange(e.target.value)}
        placeholder={due.toFixed(2)} autoFocus={autoFocus}
        className="w-full border rounded-lg px-4 py-3 text-lg font-bold focus:ring-2 focus:ring-orange-500 outline-none"
      />
      {given > 0 && given >= due - 0.001 && (
        <p className="text-sm text-gray-600">
          {given > due + 0.001
            ? <>Pas de monnaie rendue sur les tickets — <span className="font-semibold">{round2(given - due).toFixed(2)} € non rendus</span></>
            : 'Compte juste — pas de monnaie rendue sur les tickets'}
        </p>
      )}
      {given > 0 && given < due - 0.001 && (
        <p className="text-sm text-red-600 font-semibold">
          Manque {round2(due - given).toFixed(2)} € — complétez en « Mixte »
        </p>
      )}
    </div>
  );
};

export default PaperTicketInput;
