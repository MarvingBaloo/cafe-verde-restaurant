# Café Verde — commande en ligne, caisse et écran cuisine

Système complet d'un restaurant antillais, en production : le site où les clients composent et paient leur
commande, la caisse du comptoir, et l'écran de la cuisine, reliés en temps réel.

Conçu, développé et mis en ligne par Marving Gustave (BMG Consulting), avec des assistants de code IA.

Site public : [green-tea-mu.vercel.app](https://green-tea-mu.vercel.app)

## Ce que fait l'application

- **Commande en ligne** : carte, composition de plats sur mesure, récapitulatif et paiement en ligne (Stripe).
- **Caisse** : encaissement au comptoir par carte (terminal de paiement Stripe), titre-restaurant, ticket ou
  espèces, y compris en paiement mixte ; ticket envoyé par e-mail ou SMS.
- **Écran cuisine** : chaque commande apparaît en direct et change de statut au fil de sa préparation (Socket.io).
- **Administration** : produits et ingrédients, configuration du restaurant, comptes du personnel par rôle.
- **Compte client** : historique des commandes.

## Stack

| | |
|---|---|
| Interface | React 19, Vite, Tailwind CSS, React Router, Framer Motion |
| Serveur | Node.js, Express, Socket.io |
| Données | Firebase : Firestore, Authentication, Storage |
| Paiements | Stripe (paiement en ligne et terminal de paiement physique) |
| Déploiement | Vercel pour l'interface, Google Cloud Run (Docker) pour le serveur |

## Lancer le projet

```bash
# Serveur
cd backend && npm ci
# Renseigner FIREBASE_SERVICE_ACCOUNT_JSON, STRIPE_SECRET_KEY, etc. dans backend/.env
npm start

# Interface
cd ../frontend && npm ci
cp .env.example .env         # VITE_API_URL vers le serveur
npm run dev
```
