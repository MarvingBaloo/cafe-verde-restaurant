/* eslint-disable react-refresh/only-export-components --
   Provider et hook `use…` vivent dans le même fichier : c'est le motif
   standard d'un contexte React. Les séparer ne gagnerait que le confort du
   rechargement à chaud en développement, au prix de dizaines d'imports. */
// frontend/src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Providers Firebase liés au compte ('phone', 'password'…) — détermine les
  // options de sécurité disponibles (modifier vs créer un mot de passe).
  const [authProviders, setAuthProviders] = useState([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setAuthProviders(firebaseUser.providerData.map((p) => p.providerId));
        try {
          const { data } = await api.get('/users/me');
          setUser(data.data?.user || data.user || data.data);
        } catch {
          setUser(null);
        }
      } else {
        setAuthProviders([]);
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const registerWithPhone = async (firebaseIdToken, name) => {
    try {
      const { data } = await api.post('/users/register-phone', { firebaseIdToken, name });
      const createdUser = data.data?.user || data.user || data.data;
      setUser(createdUser);
      return { success: true };
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || '';
      // Numéro déjà inscrit : Firebase a connecté l'utilisateur, onAuthStateChanged gère /users/me
      if (status === 400 && msg.includes('déjà utilisé')) {
        return { success: true };
      }
      return { success: false, message: msg || "Erreur d'inscription" };
    }
  };

  const registerWithEmail = async (name, email, password) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await userCredential.user.getIdToken();
      const { data } = await api.post('/users/register-email', { firebaseIdToken: idToken, name });
      return { success: true, data };
    } catch (error) {
      const msg = error.response?.data?.message || error.message || "Erreur d'inscription";
      return { success: false, message: msg };
    }
  };

  const loginWithEmail = async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
    return { success: true };
  };

  // loginStaff partage la même logique que loginWithEmail (alias conservé pour Login.jsx)
  const loginStaff = loginWithEmail;

  const logout = async () => {
    await signOut(auth);
    setUser(null);
  };

  const updateUserLoyalty = (pointsEarned) => {
    if (!user) return;
    setUser({ ...user, loyaltyPoints: (user.loyaltyPoints || 0) + pointsEarned });
  };

  // Fusionne une mise à jour partielle dans l'utilisateur courant (édition profil)
  const applyUserUpdate = (partial) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  // Traduit les codes d'erreur Firebase Auth en messages clients lisibles.
  const friendlyAuthError = (error) => {
    switch (error.code) {
      case 'auth/email-already-in-use':
        return 'Cet email est déjà associé à un autre compte.';
      case 'auth/invalid-email':
        return 'Adresse email invalide.';
      case 'auth/weak-password':
        return 'Le mot de passe doit contenir au moins 6 caractères.';
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Mot de passe actuel incorrect.';
      case 'auth/requires-recent-login':
        return 'Pour des raisons de sécurité, reconnectez-vous puis réessayez.';
      case 'auth/provider-already-linked':
      case 'auth/credential-already-in-use':
        return 'Un email est déjà lié à ce compte.';
      case 'auth/too-many-requests':
        return 'Trop de tentatives. Réessayez plus tard.';
      default:
        return 'Une erreur est survenue. Veuillez réessayer.';
    }
  };

  // Compte créé par téléphone : lie un email + mot de passe (EmailAuthProvider).
  // L'email devient un second moyen de connexion, puis on le synchronise dans Firestore.
  const linkEmailPassword = async (email, password) => {
    try {
      const credential = EmailAuthProvider.credential(email.trim(), password);
      await linkWithCredential(auth.currentUser, credential);
      setAuthProviders(auth.currentUser.providerData.map((p) => p.providerId));
      const { data } = await api.put('/users/profile', { email: email.trim() });
      const updated = data.data?.user || data.data || data.user;
      applyUserUpdate({ email: updated?.email || email.toLowerCase().trim() });
      return { success: true };
    } catch (error) {
      const msg = error.response?.data?.message || friendlyAuthError(error);
      return { success: false, message: msg };
    }
  };

  // Compte possédant déjà un mot de passe : ré-authentifie puis met à jour le mot de passe.
  const changePassword = async (currentPassword, newPassword) => {
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);
      return { success: true };
    } catch (error) {
      return { success: false, message: friendlyAuthError(error) };
    }
  };

  // Suppression du compte client (RGPD) : backend supprime Firestore + Firebase Auth
  const deleteAccount = async () => {
    try {
      await api.delete('/users/me');
      try { await signOut(auth); } catch { /* token déjà invalidé côté Firebase */ }
      setUser(null);
      return { success: true };
    } catch (error) {
      const msg = error.response?.data?.message || 'Erreur lors de la suppression du compte';
      return { success: false, message: msg };
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, isDev: user?.role === 'dev', hasPassword: authProviders.includes('password'), registerWithPhone, registerWithEmail, loginWithEmail, loginStaff, logout, updateUserLoyalty, applyUserUpdate, deleteAccount, linkEmailPassword, changePassword }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth doit être utilisé au sein d'un AuthProvider");
  }
  return context;
};
