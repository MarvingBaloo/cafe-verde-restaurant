// frontend/src/components/PhoneAuthForm.jsx
import { useState, useRef, useEffect } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth } from '../config/firebase';

/**
 * Formulaire d'authentification par téléphone en 2 étapes :
 *   1. Saisie du nom et numéro → envoi OTP
 *   2. Saisie du code OTP → validation → appel onSuccess
 *
 * @param {{ onSuccess: (firebaseIdToken: string, name: string) => void }} props
 */
const PhoneAuthForm = ({ onSuccess, mode = 'register' }) => {
  const [step, setStep] = useState('phone'); // 'phone' | 'otp'
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const confirmationResultRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);

  // ---------- init reCAPTCHA au montage ----------

  useEffect(() => {
    // Container créé dynamiquement pour éviter la corruption par StrictMode
    const container = document.createElement('div');
    document.body.appendChild(container);

    recaptchaVerifierRef.current = new RecaptchaVerifier(
      auth,
      container,
      { size: 'invisible' }
    );

    return () => {
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // Le verifier peut déjà avoir été détruit par Firebase : rien à nettoyer.
      }
      recaptchaVerifierRef.current = null;
      document.body.removeChild(container);
    };
  }, []);

  // ---------- helpers ----------

  const clearRecaptcha = () => {
    // Recrée le verifier sur un container propre après une erreur
    try {
      recaptchaVerifierRef.current?.clear();
    } catch {
      // Idem : on recrée un verifier juste après, l'état précédent importe peu.
    }
    recaptchaVerifierRef.current = null;
    const container = document.createElement('div');
    document.body.appendChild(container);
    recaptchaVerifierRef.current = new RecaptchaVerifier(
      auth,
      container,
      { size: 'invisible' }
    );
  };

  const friendlyFirebaseError = (code) => {
    switch (code) {
      case 'auth/invalid-phone-number':
        return 'Numéro invalide. Utilisez le format international avec indicatif pays (ex : +33612345678, +596696123456).';
      case 'auth/too-many-requests':
        return 'Trop de tentatives. Veuillez réessayer plus tard.';
      case 'auth/quota-exceeded':
        return 'Quota SMS dépassé. Réessayez dans quelques minutes.';
      case 'auth/invalid-verification-code':
        return 'Code incorrect. Vérifiez et réessayez.';
      case 'auth/code-expired':
        return 'Code expiré. Relancez l\'envoi du SMS.';
      case 'auth/missing-phone-number':
        return 'Veuillez saisir un numéro de téléphone.';
      default:
        return 'Une erreur est survenue. Veuillez réessayer.';
    }
  };

  // ---------- étape 1 : envoi OTP ----------

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'register' && !name.trim()) {
      setError('Veuillez saisir votre nom.');
      return;
    }
    if (!phone.trim()) {
      setError('Veuillez saisir votre numéro de téléphone.');
      return;
    }
    setLoading(true);

    try {
      const result = await signInWithPhoneNumber(
        auth,
        phone.trim(),
        recaptchaVerifierRef.current
      );

      confirmationResultRef.current = result;
      setStep('otp');
    } catch (err) {
      clearRecaptcha();
      setError(friendlyFirebaseError(err.code));
    } finally {
      setLoading(false);
    }
  };

  // ---------- étape 2 : vérification OTP ----------

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');

    if (!otp || otp.length !== 6) {
      setError('Veuillez saisir le code à 6 chiffres reçu par SMS.');
      return;
    }

    setLoading(true);

    try {
      const userCredential = await confirmationResultRef.current.confirm(otp);
      const idToken = await userCredential.user.getIdToken();
      await onSuccess(idToken, name.trim());
    } catch (err) {
      setError(friendlyFirebaseError(err.code));
    } finally {
      setLoading(false);
    }
  };

  // ---------- retour à l'étape 1 ----------

  const handleBack = () => {
    confirmationResultRef.current = null;
    setOtp('');
    setError('');
    setStep('phone');
  };

  // ---------- classes communes (calquées sur Login.jsx) ----------

  const inputCls =
    'w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all';

  const labelCls =
    'block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1';

  const btnPrimaryCls =
    'w-full bg-brand-600 text-white font-bold py-4 rounded-xl hover:bg-brand-700 transition-all duration-300 transform hover:-translate-y-1 shadow-lg shadow-brand-200 flex justify-center items-center gap-2 disabled:opacity-60 disabled:pointer-events-none';

  const btnSecondaryCls =
    'w-full py-3 rounded-xl border border-gray-200 text-gray-500 text-sm font-semibold hover:bg-gray-50 transition-all disabled:opacity-60 disabled:pointer-events-none';

  const spinner = (
    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
  );

  // ---------- rendu ----------

  return (
    <div className="px-8 pb-8 space-y-5">

      {/* ===== ÉTAPE 1 : TÉLÉPHONE ===== */}
      {step === 'phone' && (
        <form onSubmit={handleSendOtp} className="space-y-5">

          {mode === 'register' && (
            <div>
              <label className={labelCls}>Votre nom</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
                placeholder="Ex : Jean Dupont"
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label className={labelCls}>Numéro de téléphone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              placeholder="+33612345678"
              autoComplete="tel"
            />
          </div>

          {error && <ErrorBanner message={error} />}

          <button type="submit" disabled={loading} className={btnPrimaryCls}>
            {loading ? spinner : (
              <>
                Recevoir le code SMS
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                </svg>
              </>
            )}
          </button>
        </form>
      )}

      {/* ===== ÉTAPE 2 : CODE OTP ===== */}
      {step === 'otp' && (
        <form onSubmit={handleVerifyOtp} className="space-y-5">

          <p className="text-sm text-gray-500 text-center">
            Un code à 6 chiffres a été envoyé au&nbsp;
            <span className="font-semibold text-gray-700">{phone}</span>.
          </p>

          <div>
            <label className={labelCls}>Code de vérification</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className={`${inputCls} text-center text-2xl tracking-[0.5em] font-mono`}
              placeholder="123456"
              autoComplete="one-time-code"
            />
          </div>

          {error && <ErrorBanner message={error} />}

          <button type="submit" disabled={loading} className={btnPrimaryCls}>
            {loading ? spinner : (
              <>
                Vérifier le code
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={handleBack}
            className={btnSecondaryCls}
          >
            ← Retour
          </button>
        </form>
      )}
    </div>
  );
};

// ---------- sous-composant message d'erreur ----------

const ErrorBanner = ({ message }) => (
  <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg flex items-center gap-2">
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
    {message}
  </div>
);

export default PhoneAuthForm;
