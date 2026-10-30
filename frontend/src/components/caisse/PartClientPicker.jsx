import { useState, useEffect, useRef } from 'react';
import { searchUsers } from '../../services/api';
import Icon from '../Icon';

// Sélecteur de client au niveau d'une part de split : recherche locale (indépendante des autres parts)
// + bouton « Nouveau client ». La part sans client hérite du client global (affiché en repère).
const PartClientPicker = ({ client, globalClient, onSelect, onClear, onNewClient, disabled }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (q.length < 2) { setResults([]); return; }
    debRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchUsers(q);
        const data = res.data?.data;
        setResults(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('searchUsers (part) error:', err);
        setResults([]);
      } finally { setSearching(false); }
    }, 350);
  }, [q]);

  const pick = (c) => { onSelect(c); setQ(''); setResults([]); };

  // Client explicitement rattaché à la part.
  if (client) {
    return (
      <div className="mt-2 ml-10 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between">
        <p className="text-sm text-emerald-800 inline-flex items-center gap-1.5">
          <Icon name="account" /> <span className="font-semibold">{client.name}</span>
          <span className="text-emerald-600">· {client.loyaltyPoints || 0} pts</span>
        </p>
        {!disabled && (
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-red-500">Retirer</button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 ml-10">
      {globalClient && (
        <p className="text-xs text-gray-500 mb-1 inline-flex items-center gap-1">
          <Icon name="account" /> Fidélité : <span className="font-semibold text-gray-700">{globalClient.name}</span> (client global)
        </p>
      )}
      <input
        type="text" value={q} disabled={disabled}
        onChange={e => setQ(e.target.value)}
        placeholder={globalClient ? 'Attribuer à un autre client…' : 'Identifier un client (points)…'}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none disabled:bg-gray-100" />
      {searching && <p className="text-xs text-gray-400 mt-1">Recherche…</p>}
      {!searching && q.length >= 2 && results.length === 0 && (
        <p className="text-xs text-gray-400 mt-1">Aucun résultat.</p>
      )}
      {results.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto mt-1.5">
          {results.map(c => (
            <button key={c._id} onClick={() => pick(c)}
              className="w-full p-2 border rounded-lg text-left hover:bg-emerald-50 hover:border-emerald-300 transition-all">
              <p className="text-sm font-semibold text-gray-800">{c.name}</p>
              <p className="text-xs text-gray-500">{c.phone || c.email} · {c.loyaltyPoints || 0} pts</p>
            </button>
          ))}
        </div>
      )}
      {!disabled && (
        <button onClick={onNewClient}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800">
          <Icon name="add" /> Nouveau client
        </button>
      )}
    </div>
  );
};

export default PartClientPicker;
