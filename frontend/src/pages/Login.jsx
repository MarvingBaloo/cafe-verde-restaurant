// src/pages/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PhoneAuthForm from '../components/PhoneAuthForm';

const Login = () => {
  const [staffMode, setStaffMode] = useState(false);
  const [clientMethod, setClientMethod] = useState('phone'); // 'phone' | 'email'
  const [emailSubMode, setEmailSubMode] = useState('login'); // 'login' | 'register'

  // Champs email client
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Champs staff
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [phoneSubMode, setPhoneSubMode] = useState('login'); // 'login' | 'register'

  const { user, loading, loginStaff, loginWithEmail, registerWithEmail, registerWithPhone } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      const role = user?.role;
      if (role === 'kitchen') navigate('/kitchen');
      else if (role === 'admin' || role === 'superadmin') navigate('/admin');
      else navigate('/');
    }
  }, [user, loading, navigate]);

  // ---------- Staff ----------

  const handleStaffLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!staffEmail || !staffPassword) { setError('Veuillez remplir tous les champs.'); return; }
    setSubmitting(true);
    try {
      await loginStaff(staffEmail, staffPassword);
    } catch (err) {
      const code = err?.code;
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Email ou mot de passe incorrect.');
      } else {
        setError('Erreur de connexion. Réessayez.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Client — Email ----------

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Veuillez remplir tous les champs.'); return; }
    if (emailSubMode === 'register' && !name.trim()) { setError('Le nom est obligatoire.'); return; }
    setSubmitting(true);
    try {
      if (emailSubMode === 'login') {
        await loginWithEmail(email, password);
      } else {
        const result = await registerWithEmail(name.trim(), email, password);
        if (!result.success) { setError(result.message); }
      }
    } catch (err) {
      const code = err?.code;
      if (code === 'auth/email-already-in-use') {
        setError('Un compte existe déjà avec cet email.');
      } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Email ou mot de passe incorrect.');
      } else if (code === 'auth/weak-password') {
        setError('Le mot de passe doit contenir au moins 6 caractères.');
      } else {
        setError('Erreur de connexion. Réessayez.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Client — Téléphone ----------

  // Inscription : crée le profil côté backend
  const handlePhoneRegister = async (firebaseIdToken, name) => {
    setError('');
    const result = await registerWithPhone(firebaseIdToken, name);
    if (!result.success) setError(result.message || "Erreur d'inscription");
  };

  // Connexion : Firebase a déjà restauré la session, onAuthStateChanged gère /users/me
  const handlePhoneLogin = async () => {
    // Rien à faire ici — onAuthStateChanged se déclenche automatiquement
  };

  // ---------- Styles ----------

  const inputCls = 'w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all';
  const labelCls = 'block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1';
  const btnPrimaryCls = 'w-full bg-brand-600 text-white font-bold py-4 rounded-xl hover:bg-brand-700 transition-all duration-300 transform hover:-translate-y-1 shadow-lg shadow-brand-200 flex justify-center items-center gap-2 disabled:opacity-60 disabled:pointer-events-none';
  const tabActive = 'bg-white text-brand-600 shadow-sm';
  const tabInactive = 'text-gray-500 hover:text-gray-700';
  const spinner = <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />;

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-gray-100">

        {/* HEADER */}
        <div className="bg-brand-600 p-8 text-center">
          <h2 className="text-3xl gelasio font-bold text-white mb-2">
            {staffMode ? 'Accès staff' : 'Bon retour !'}
          </h2>
          <p className="text-brand-100 text-sm">
            {staffMode
              ? 'Connectez-vous avec votre compte staff.'
              : 'Connectez-vous ou créez votre compte.'}
          </p>
        </div>

        {/* MODE CLIENT */}
        {!staffMode && (
          <>
            {/* Toggle Téléphone / Email */}
            <div className="flex p-2 m-6 bg-gray-100 rounded-xl gap-1">
              {[
                { key: 'phone', label: 'Téléphone' },
                { key: 'email', label: 'Email' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setClientMethod(key); setError(''); }}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-300 ${clientMethod === key ? tabActive : tabInactive}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Téléphone */}
            {clientMethod === 'phone' && (
              <>
                {/* Toggle connexion / inscription */}
                <div className="flex p-1 mx-6 bg-gray-100 rounded-xl gap-1 -mt-2">
                  {[
                    { key: 'login',    label: 'Connexion'   },
                    { key: 'register', label: 'Inscription' },
                  ].map(({ key, label }) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => { setPhoneSubMode(key); setError(''); }}
                      className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-300 ${phoneSubMode === key ? tabActive : tabInactive}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {error && <div className="px-8 mt-2"><ErrorBanner message={error} /></div>}
                <PhoneAuthForm
                  mode={phoneSubMode}
                  onSuccess={phoneSubMode === 'register' ? handlePhoneRegister : handlePhoneLogin}
                />
              </>
            )}

            {/* Email */}
            {clientMethod === 'email' && (
              <form onSubmit={handleEmailSubmit} className="px-8 pb-8 space-y-5">

                {/* Toggle connexion / inscription */}
                <div className="flex p-1 bg-gray-100 rounded-xl gap-1">
                  {[
                    { key: 'login',    label: 'Connexion'   },
                    { key: 'register', label: 'Inscription' },
                  ].map(({ key, label }) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => { setEmailSubMode(key); setError(''); }}
                      className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-300 ${emailSubMode === key ? tabActive : tabInactive}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {emailSubMode === 'register' && (
                  <div>
                    <label className={labelCls}>Votre nom</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                      className={inputCls} placeholder="Jean Dupont" autoComplete="name" />
                  </div>
                )}

                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className={inputCls} placeholder="jean@example.com" autoComplete="email" />
                </div>

                <div>
                  <label className={labelCls}>Mot de passe</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    className={inputCls} placeholder="••••••••" autoComplete={emailSubMode === 'register' ? 'new-password' : 'current-password'} />
                </div>

                {error && <ErrorBanner message={error} />}

                <button type="submit" disabled={submitting} className={btnPrimaryCls}>
                  {submitting ? spinner : (emailSubMode === 'login' ? 'Se connecter' : 'Créer mon compte')}
                </button>
              </form>
            )}
          </>
        )}

        {/* MODE STAFF */}
        {staffMode && (
          <form onSubmit={handleStaffLogin} className="px-8 py-8 space-y-5">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)}
                className={inputCls} placeholder="staff@cafeverde.com" autoComplete="email" />
            </div>
            <div>
              <label className={labelCls}>Mot de passe</label>
              <input type="password" value={staffPassword} onChange={(e) => setStaffPassword(e.target.value)}
                className={inputCls} placeholder="••••••••" autoComplete="current-password" />
            </div>
            {error && <ErrorBanner message={error} />}
            <button type="submit" disabled={submitting} className={btnPrimaryCls}>
              {submitting ? spinner : 'Se connecter'}
            </button>
          </form>
        )}

        {/* Toggle staff / client */}
        <div className="text-center pb-6">
          <button
            type="button"
            onClick={() => { setStaffMode(!staffMode); setError(''); }}
            className="text-xs text-gray-400 hover:text-brand-600 underline underline-offset-2 transition-colors"
          >
            {staffMode ? '← Retour client' : 'Accès staff'}
          </button>
        </div>

      </div>
    </div>
  );
};

const ErrorBanner = ({ message }) => (
  <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg flex items-center gap-2">
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
    {message}
  </div>
);

export default Login;
