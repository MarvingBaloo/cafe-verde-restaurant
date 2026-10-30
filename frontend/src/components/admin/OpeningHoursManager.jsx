// frontend/src/components/admin/OpeningHoursManager.jsx
// Réglage des horaires d'ouverture et de la fenêtre de commande en ligne.
//
// Ce qui se règle ici décide de ce que le site accepte : un jour fermé, une heure
// changée ou l'interrupteur coupé ferment la commande en ligne immédiatement, pour
// tout le monde. Le serveur applique la même règle — l'écran n'est pas une décoration.
import React, { useCallback, useEffect, useState } from 'react';
import { fetchOpeningHours, updateOpeningHours } from '../../services/api';
import { WEEKDAY_NAMES, capitalize, humanTime, getOnlineOrderingStatus, closedMessage } from '../../utils/hours';
import Icon from '../Icon';

// Lundi → dimanche : l'ordre dans lequel une gérante lit sa semaine.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const OpeningHoursManager = () => {
  const [config, setConfig] = useState(null);
  const [days, setDays] = useState({});
  const [preOrderLead, setPreOrderLead] = useState('60');
  const [lastOrderMargin, setLastOrderMargin] = useState('30');
  const [enabled, setEnabled] = useState(true);
  const [closedDates, setClosedDates] = useState([]);
  const [newClosedDate, setNewClosedDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'ok' | 'error', text }

  const applyConfig = useCallback((cfg) => {
    setConfig(cfg);
    setDays(cfg.days || {});
    setPreOrderLead(String(cfg.preOrderLead ?? 60));
    setLastOrderMargin(String(cfg.lastOrderMargin ?? 30));
    setEnabled(cfg.onlineOrderingEnabled !== false);
    setClosedDates(cfg.closedDates || []);
  }, []);

  useEffect(() => {
    fetchOpeningHours()
      .then((res) => applyConfig(res.data.config))
      .catch(() => setFeedback({ type: 'error', text: 'Impossible de lire les horaires.' }))
      .finally(() => setLoading(false));
  }, [applyConfig]);

  const setDayOpen = (index, open) => {
    setDays((prev) => ({
      ...prev,
      [index]: open ? (prev[index] || { open: '12:00', close: '21:00' }) : null,
    }));
  };

  const setDayTime = (index, field, value) => {
    setDays((prev) => ({ ...prev, [index]: { ...(prev[index] || {}), [field]: value } }));
  };

  const addClosedDate = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newClosedDate)) return;
    setClosedDates((prev) => [...new Set([...prev, newClosedDate])].sort());
    setNewClosedDate('');
  };

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await updateOpeningHours({
        days,
        preOrderLead: Number(preOrderLead),
        lastOrderMargin: Number(lastOrderMargin),
        onlineOrderingEnabled: enabled,
        closedDates,
      });
      applyConfig(res.data.config);
      setFeedback({ type: 'ok', text: 'Horaires enregistrés.' });
    } catch (err) {
      setFeedback({ type: 'error', text: err?.response?.data?.message || "Enregistrement impossible." });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Chargement des horaires…</div>;

  // Aperçu calculé sur la saisie en cours : le gérant voit l'effet avant d'enregistrer.
  const preview = config
    ? getOnlineOrderingStatus(
        { ...config, days, preOrderLead: Number(preOrderLead), lastOrderMargin: Number(lastOrderMargin),
          onlineOrderingEnabled: enabled, closedDates },
        new Date(),
      )
    : null;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Horaires &amp; commandes en ligne</h2>
      <p className="text-sm text-gray-500 mb-6">
        Ces horaires pilotent le site : hors de ces créneaux, un client ne peut pas commander.
        La caisse, elle, n&apos;est jamais bloquée.
      </p>

      {/* Interrupteur global — l'imprévu du jour */}
      <div className={`mb-6 rounded-xl border p-4 ${enabled ? 'bg-gray-50 border-gray-200' : 'bg-red-50 border-red-200'}`}>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-5 h-5" />
          <span className="font-bold text-gray-900">
            {enabled ? 'Commandes en ligne ouvertes' : 'Commandes en ligne coupées'}
          </span>
        </label>
        <p className="mt-1 ml-8 text-sm text-gray-600">
          Décochez pour fermer immédiatement la commande en ligne, sans toucher aux horaires
          (panne, cuisine surchargée, imprévu).
        </p>
      </div>

      {/* Semaine */}
      <div className="space-y-2 mb-6">
        {WEEK_ORDER.map((index) => {
          const slot = days[index] || null;
          return (
            <div key={index} className="flex flex-wrap items-center gap-3 py-2 border-b border-gray-100 last:border-0">
              <label className="flex items-center gap-2 w-40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!slot}
                  onChange={(e) => setDayOpen(index, e.target.checked)}
                  className="w-4 h-4"
                />
                <span className={`font-semibold ${slot ? 'text-gray-900' : 'text-gray-400'}`}>
                  {capitalize(WEEKDAY_NAMES[index])}
                </span>
              </label>
              {slot ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={slot.open || ''}
                    onChange={(e) => setDayTime(index, 'open', e.target.value)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg"
                  />
                  <span className="text-gray-400">→</span>
                  <input
                    type="time"
                    value={slot.close || ''}
                    onChange={(e) => setDayTime(index, 'close', e.target.value)}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg"
                  />
                </div>
              ) : (
                <span className="text-sm text-gray-400 italic">Fermé</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Fenêtre de prise de commande */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label htmlFor="preOrderLead" className="block text-sm font-bold text-gray-700 mb-1">
            Commandes ouvertes avant le service
          </label>
          <div className="flex items-center gap-2">
            <input
              id="preOrderLead"
              type="number" min="0" max="720"
              value={preOrderLead}
              onChange={(e) => setPreOrderLead(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-200 rounded-lg"
            />
            <span className="text-sm text-gray-500">minutes</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Un client peut commander avant l&apos;ouverture. À 60, une ouverture à 12h laisse
            commander dès 11h.
          </p>
        </div>
        <div>
          <label htmlFor="lastOrderMargin" className="block text-sm font-bold text-gray-700 mb-1">
            Dernière commande avant la fermeture
          </label>
          <div className="flex items-center gap-2">
            <input
              id="lastOrderMargin"
              type="number" min="0" max="720"
              value={lastOrderMargin}
              onChange={(e) => setLastOrderMargin(e.target.value)}
              className="w-24 px-3 py-2 border border-gray-200 rounded-lg"
            />
            <span className="text-sm text-gray-500">minutes</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Temps laissé à la cuisine. À 30, une fermeture à 21h arrête les commandes à 20h30.
            C&apos;est aussi le moment où une commande réservée s&apos;affiche en cuisine.
          </p>
        </div>
      </div>

      {/* Fermetures exceptionnelles */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-gray-700 mb-2">Fermetures exceptionnelles</h3>
        <p className="text-xs text-gray-500 mb-3">
          Jours fériés, congés, fermeture ponctuelle. Ces dates restent fermées quels que
          soient les horaires de la semaine.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {closedDates.length === 0 && <span className="text-sm text-gray-400 italic">Aucune</span>}
          {closedDates.map((d) => (
            <span key={d} className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-sm font-semibold">
              {d}
              <button
                type="button"
                onClick={() => setClosedDates((prev) => prev.filter((x) => x !== d))}
                className="text-red-500 hover:text-red-700"
                aria-label={`Retirer la fermeture du ${d}`}
              >
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={newClosedDate}
            onChange={(e) => setNewClosedDate(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg"
          />
          <button
            type="button"
            onClick={addClosedDate}
            disabled={!newClosedDate}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg font-semibold disabled:bg-gray-300 flex items-center gap-2"
          >
            <Icon name="add" />
            Ajouter
          </button>
        </div>
      </div>

      {/* Aperçu — ce que verrait un client en ce moment */}
      {preview && (
        <div className={`mb-6 rounded-xl border p-4 ${preview.open ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <p className="text-sm font-bold text-gray-900 mb-1">En ce moment, un client verrait :</p>
          <p className="text-sm text-gray-700">
            {preview.open
              ? `Commandes ouvertes${preview.lastOrderTime ? ` jusqu'à ${humanTime(preview.lastOrderTime)}` : ''}.`
              : closedMessage(preview)}
          </p>
        </div>
      )}

      {feedback && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-bold ${
          feedback.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
        }`}>
          {feedback.text}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold disabled:bg-gray-400"
      >
        {saving ? 'Enregistrement…' : 'Enregistrer les horaires'}
      </button>
    </div>
  );
};

export default OpeningHoursManager;
