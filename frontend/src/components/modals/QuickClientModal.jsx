import { useState } from 'react';
import PhoneInput from 'react-phone-number-input';
import { registerQuick } from '../../services/api';
import Icon from '../Icon';

const EMPTY = { name: '', phone: '', email: '' };

const QuickClientModal = ({ isOpen, onClose, onCreated }) => {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const close = () => {
    setForm(EMPTY);
    setError('');
    onClose();
  };

  const handleSubmit = async () => {
    setError('');
    const { name, phone, email } = form;
    if (!name.trim() || (!phone?.trim() && !email.trim())) {
      setError('Nom et (téléphone ou email) requis');
      return;
    }
    setSubmitting(true);
    try {
      const res = await registerQuick(form);
      const client = res.data?.data?.user || res.data?.user;
      setForm(EMPTY);
      onCreated(client);
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur création client');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md animate-in fade-in-50 zoom-in-90 duration-300">
        <div className="p-6 pb-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-2xl"><Icon name="account" /></span>
          <h2 className="font-serif font-bold text-xl text-gray-900">Nouveau client</h2>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Nom *</label>
            <input type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Prénom Nom" autoFocus
              className="w-full border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Téléphone</label>
            <PhoneInput
              international
              defaultCountry="GP"
              value={form.phone || undefined}
              onChange={value => setForm(f => ({ ...f, phone: value || '' }))}
              placeholder="Numéro (tous pays)"
              className="w-full border rounded-lg px-4 py-2 text-sm focus-within:ring-2 focus-within:ring-emerald-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
            <input type="email" value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="client@mail.com"
              className="w-full border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={close}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-bold hover:bg-gray-200 transition-colors">
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={submitting}
            className="px-6 py-3 bg-emerald-600 text-white rounded-full font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60">
            {submitting ? 'Création…' : 'Créer & rattacher'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickClientModal;
