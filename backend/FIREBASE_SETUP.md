# Firebase Storage — Guide de configuration

## 1. Pourquoi Firebase Storage ?

Le plan **Render Free** utilise un système de fichiers éphémère : toutes les
images uploadées dans `backend/uploads/` sont **perdues à chaque redéploiement
et à chaque réveil du dyno** (après inactivité). Firebase Storage résout ce
problème en fournissant un stockage persistant externalisé.

Projet Firebase : `cafe-verde-prod`
Bucket : `cafe-verde-prod.firebasestorage.app`
Règles : mode test (30 jours) — à durcir en Phase F3

---

## 2. Setup local (développement)

1. Télécharger la clé de service account depuis la Firebase Console :
   `Paramètres du projet → Comptes de service → Générer une nouvelle clé privée`

2. Placer le fichier téléchargé ici :
   ```
   backend/firebase-service-account.json
   ```

3. Ce fichier est **déjà ignoré par git** (`backend/.gitignore` ligne 8).
   Ne jamais le committer. Ne jamais le partager.

4. Démarrer le backend normalement :
   ```bash
   cd backend && npm run dev
   ```
   Le module `backend/config/firebase.js` détecte automatiquement le fichier
   local si la variable d'environnement `FIREBASE_SERVICE_ACCOUNT_JSON` est
   absente.

---

## 3. Déploiement sur Render

La clé de service account doit être injectée via une variable d'environnement
(le fichier JSON ne peut pas être déployé sur Render).

**Étapes :**

1. Aller sur [dashboard.render.com](https://dashboard.render.com)
2. Sélectionner le service **cafe-verde-api**
3. Onglet **Environment**
4. Cliquer **Add Environment Variable**
5. Remplir :
   - **Key** : `FIREBASE_SERVICE_ACCOUNT_JSON`
   - **Value** : coller **tout le contenu** du fichier `firebase-service-account.json`,
     accolades `{ }` comprises, tel quel (c'est du JSON brut sur une ou plusieurs lignes)
6. Cliquer **Save Changes**

Render redéploie automatiquement. Le backend lit la variable en priorité sur
le fichier local (voir `backend/config/firebase.js`).

---

## 4. Test de validation après déploiement

Remplacer `<RENDER_URL>` par l'URL de ton service Render (ex: `https://cafe-verde-api.onrender.com`).

**Upload ingrédient (pas de auth requise) :**
```bash
curl -X POST <RENDER_URL>/api/ingredients/upload \
  -F "image=@/chemin/vers/une-image.jpg"
```

Réponse attendue :
```json
{
  "success": true,
  "data": {
    "imageUrl": "https://storage.googleapis.com/cafe-verde-prod.firebasestorage.app/ingredients/...",
    "filename": "...",
    "originalSize": "... KB",
    "compressedSize": "... KB",
    "compressionRatio": "...%",
    "savedSpace": "... KB"
  }
}
```

**Vérifier que l'URL est accessible :**
```bash
curl -I "<imageUrl retournée ci-dessus>"
# Doit répondre HTTP 200, Content-Type: image/webp
```

**Upload produit (auth admin requise) :**
```bash
# 1. Obtenir un token JWT
TOKEN=$(curl -s -X POST <RENDER_URL>/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gerant@admin.com","password":"admin"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token') or d.get('data',{}).get('token',''))")

# 2. Uploader
curl -X POST <RENDER_URL>/api/products/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/chemin/vers/une-image.jpg"
```
