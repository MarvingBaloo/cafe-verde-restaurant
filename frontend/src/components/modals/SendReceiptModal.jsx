import React, { useState } from 'react';
import { sendOrderReceipt } from '../../services/api';
import Icon from '../Icon';

// Modale partagée (Caisse + Espace client) : envoi du ticket d'une commande
// par email ou SMS. Destinataire pré-rempli mais éditable (envoi possible à un anonyme).
export default function SendReceiptModal({ orderId, channel, defaultTo = '', partIndex = null, onClose }) {
  const isEmail = channel === 'email';
  const [to, setTo] = useState(defaultTo);
  const [withoutDetail, setWithoutDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [success, setSuccess] = useState('');

  const send = async () => {
    const dest = to.trim();
    if (!dest) { setMsg(isEmail ? 'Email requis.' : 'Numéro requis.'); return; }
    setSending(true); setMsg('');
    try {
      await sendOrderReceipt(orderId, channel, dest, !withoutDetail, partIndex);
      setSuccess(isEmail ? 'Envoyé par email !' : 'Envoyé par SMS !');
      setTimeout(onClose, 1600);
    } catch (err) {
      setMsg(err.response?.data?.message || "Échec de l'envoi. Réessayez.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-2xl font-serif font-bold text-gray-900 mb-2 flex items-center gap-2">
          <Icon name={isEmail ? 'mail' : 'sms'} className="text-brand-600" />
          {isEmail ? 'Envoyer par email' : 'Envoyer par SMS'}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {partIndex
            ? `Le client recevra le justificatif de sa part (part ${partIndex}), pas la note de la table.`
            : 'Le client recevra le ticket de sa commande.'}
        </p>

        <label className="block text-sm font-bold text-gray-500 mb-1">
          {isEmail ? 'Adresse email' : 'Numéro de téléphone'}
        </label>
        <input
          type={isEmail ? 'email' : 'tel'}
          value={to}
          onChange={e => setTo(e.target.value)}
          placeholder={isEmail ? 'destinataire@email.com' : '0690 00 00 00'}
          autoFocus
          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-3 focus:ring-2 focus:ring-brand-400 outline-none" />

        <label className="flex items-center gap-2 text-sm text-gray-600 mb-2 cursor-pointer select-none">
          <input type="checkbox" checked={withoutDetail} onChange={e => setWithoutDetail(e.target.checked)}
            className="w-4 h-4 accent-brand-600" />
          Sans le détail des articles
        </label>

        {msg && <p className="text-sm text-red-600 mb-2">{msg}</p>}
        {success && <p className="text-sm text-brand-600 mb-2">{success}</p>}

        <div className="flex gap-3 justify-end mt-4">
          <button onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">Annuler</button>
          <button onClick={send} disabled={sending}
            className="px-5 py-2 bg-brand-600 text-white rounded-xl font-bold hover:bg-brand-700 transition-colors disabled:opacity-50">
            {sending ? 'Envoi...' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}
