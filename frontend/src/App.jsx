// frontend/src/App.jsx
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { useActivityTracker } from './hooks/useActivityTracker';
import Home from './pages/Home';
import PaymentReturn from './pages/PaymentReturn'; // Retour de redirection 3-D Secure
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import PrivateRoute from './components/PrivateRoute';
import DevRoute from './components/DevRoute';

/* Chargement différé par route : chaque écran devient un fichier à part, téléchargé
   seulement quand on s'y rend. Un client venu voir la carte ne télécharge plus la
   caisse, l'espace gérant, la comptabilité ni l'écran cuisine.

   Restent chargées d'emblée : Home (page d'entrée, la différer ajouterait un
   aller-retour sur la page la plus visitée) et PaymentReturn (retour de la banque
   après 3-D Secure : un paiement vient d'aboutir, on ne fait pas dépendre cet
   écran d'un téléchargement supplémentaire). */
const Configurator = lazy(() => import('./pages/Configurator'));
const MenuSelection = lazy(() => import('./pages/MenuSelection'));
const Summary = lazy(() => import('./pages/Summary'));
const Kitchen = lazy(() => import('./pages/Kitchen'));
const Admin = lazy(() => import('./pages/Admin'));
const Caisse = lazy(() => import('./pages/Caisse'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const Login = lazy(() => import('./pages/Login'));
const Products = lazy(() => import('./pages/Products'));
const DishDetail = lazy(() => import('./pages/DishDetail'));
const MyAccount = lazy(() => import('./pages/MyAccount'));
const Dev = lazy(() => import('./pages/Dev'));
const MentionsLegales = lazy(() => import('./pages/legal/MentionsLegales'));
const CGV = lazy(() => import('./pages/legal/CGV'));
const CGU = lazy(() => import('./pages/legal/CGU'));
const Confidentialite = lazy(() => import('./pages/legal/Confidentialite'));

/** Affiché le temps qu'un écran différé se télécharge. */
const PageFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-live="polite">
    <div className="h-10 w-10 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
    <span className="sr-only">Chargement…</span>
  </div>
);

/**
 * @function App
 * @description
 * Composant racine de Café Verde.
 * Il met en place le routeur et enveloppe l'application dans le Layout global (Header + Footer).
 *
 * @returns {JSX.Element} Le composant principal de l'application.
 */
// Composant interne : track page_view à chaque changement de route
const PageTracker = () => {
  const location = useLocation();
  const { track } = useActivityTracker();
  useEffect(() => {
    track('page_view', { path: location.pathname });
  }, [location.pathname]);
  return null;
};

function App() {
  return (
    <Router>
      <PageTracker />
      <ScrollToTop />
      <Layout>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* La route racine affiche la page d'accueil */}
            <Route path="/" element={<Home />} />
            {/* La route pour le catalogue produits */}
            <Route path="/products" element={<Products />} />
            {/* Page détail d'un plat chaud */}
            <Route path="/products/dish/:id" element={<DishDetail />} />
            {/* La route pour Mon Compte */}
            <Route path="/account" element={<MyAccount />} />
            {/* La route pour le configurateur de salade/thé */}
            <Route path="/configurator" element={<Configurator />} />
            {/* La route pour la sélection du menu */}
            <Route path="/menu-selection" element={<MenuSelection />} />
            {/* La route pour le récapitulatif de la commande */}
            <Route path="/summary" element={<Summary />} />
            {/* Retour de la banque après authentification 3-D Secure par redirection */}
            <Route path="/paiement/retour" element={<PaymentReturn />} />
            {/* La route pour la page de gestion de la cuisine (KDS) */}
            <Route path="/kitchen" element={<PrivateRoute element={<Kitchen />} />} />
            {/* La route pour la page d'administration opérationnelle (Manager) */}
            <Route path="/admin" element={<PrivateRoute element={<Admin />} />} />
            {/* La route pour la caisse (Manager) */}
            <Route path="/admin/caisse" element={<PrivateRoute element={<Caisse />} />} />
            {/* La route pour le Super Admin (Gérant - Stratégie & Finance) */}
            <Route path="/super-admin" element={<PrivateRoute element={<SuperAdmin />} />} />
            {/* La route pour l'Espace DEV */}
            <Route path="/dev" element={<DevRoute element={<Dev />} />} />
            {/* La route pour l'Authentification (Login/Register) */}
            <Route path="/login" element={<Login />} />
            {/* Pages légales */}
            <Route path="/mentions-legales" element={<MentionsLegales />} />
            <Route path="/cgv" element={<CGV />} />
            <Route path="/cgu" element={<CGU />} />
            <Route path="/confidentialite" element={<Confidentialite />} />
          </Routes>
        </Suspense>
      </Layout>
    </Router>
  );
}

export default App;
