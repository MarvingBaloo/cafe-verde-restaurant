# Services Backend

Ce dossier contient les services utilitaires pour l'application.

## 📊 Nutrition Service - Auto-complétion des informations nutritionnelles

### Description

Le service `nutritionService.js` récupère automatiquement les informations nutritionnelles des ingrédients lors de leur création, en utilisant plusieurs sources de données avec une stratégie de fallback intelligente.

### Stratégie de Fallback

Le service essaie les sources suivantes dans l'ordre :

1. **Nutritionix API** (Priorité 1 - Le plus précis)
   - Base de données nutritionnelle professionnelle
   - Limite gratuite : 500 requêtes/jour
   - Configuration requise : `NUTRITIONIX_APP_ID` et `NUTRITIONIX_API_KEY`
   - Inscription : https://developer.nutritionix.com/

2. **Open Food Facts** (Priorité 2 - Gratuit illimité)
   - Base de données collaborative mondiale
   - 100% gratuit, pas de limite
   - Aucune configuration requise
   - Particulièrement bon pour les produits alimentaires packagés

3. **OpenAI GPT-3.5** (Priorité 3 - Estimation IA)
   - Estimation basée sur l'intelligence artificielle
   - Configuration requise : `OPENAI_API_KEY`
   - Utilisé uniquement si les 2 premières sources échouent
   - Inscription : https://platform.openai.com/api-keys

4. **Valeurs par défaut** (Dernier recours)
   - Retourne des valeurs à 0
   - Utilisé si toutes les sources échouent

### Fonctionnement

#### Automatique lors de la création

Quand un ingrédient est créé **sans** informations nutritionnelles (ou avec des valeurs à 0), le service :

1. Détecte automatiquement que les infos sont manquantes
2. Recherche les données nutritionnelles via les APIs
3. Remplit automatiquement les champs
4. Informe l'utilisateur de la source utilisée

```javascript
// Exemple de réponse lors de la création d'un ingrédient
{
  "_id": "...",
  "name": "Mangue",
  "nutritional_info": {
    "calories": 60,    // ✅ Auto-complété
    "proteins": 0.8,   // ✅ Auto-complété
    "carbs": 15,       // ✅ Auto-complété
    "fat": 0.4         // ✅ Auto-complété
  },
  "_nutritionAutoFilled": true,        // Métadonnée
  "_nutritionSource": "openfoodfacts"  // Métadonnée
}
```

#### Valeurs pour 100g

Toutes les valeurs nutritionnelles sont calculées pour **100 grammes** de l'ingrédient :
- **Calories** : en kcal
- **Protéines** : en grammes (1 décimale)
- **Glucides** : en grammes (1 décimale)
- **Lipides** : en grammes (1 décimale)

### Configuration

#### Option 1 : Configuration minimale (Recommandée)

**Aucune configuration requise !** Le service fonctionne out-of-the-box avec Open Food Facts.

```bash
# Pas besoin de variables d'environnement
# Open Food Facts est utilisé par défaut
```

#### Option 2 : Configuration optimale

Pour une précision maximale, configurez Nutritionix :

```bash
# Dans backend/.env
NUTRITIONIX_APP_ID=votre_app_id
NUTRITIONIX_API_KEY=votre_api_key

# Optionnel : Fallback IA
OPENAI_API_KEY=sk-...
```

**Avantages de Nutritionix** :
- ✅ Base de données plus complète (surtout pour ingrédients frais)
- ✅ Données vérifiées par des nutritionnistes
- ✅ Meilleure reconnaissance des noms français

### Utilisation

Le service est appelé automatiquement par le `ingredientController` lors de la création d'un ingrédient.

```javascript
// Dans ingredientController.js
const { getNutritionInfo } = require('../services/nutritionService.js');

// Lors de la création
const nutritionData = await getNutritionInfo(ingredientName);
// Retourne: { calories, proteins, carbs, fat, source }
```

### Logs

Le service affiche des logs détaillés dans la console :

```bash
🔍 Recherche des infos nutritionnelles pour: "Mangue"
⚠️  Nutritionix failed for "Mangue": Nutritionix credentials not configured
✅ Données trouvées via Open Food Facts
```

### Gestion des erreurs

Le service est conçu pour **ne jamais bloquer** la création d'un ingrédient :

- ❌ Si toutes les APIs échouent → Valeurs à 0
- ❌ Si erreur réseau → Valeurs à 0
- ❌ Si timeout → Valeurs à 0

L'ingrédient est **toujours créé**, même si les infos nutritionnelles ne peuvent pas être récupérées.

### Performance

- **Temps moyen** : 500ms - 2s par ingrédient
- **Cache** : Non implémenté (chaque appel fait une requête)
- **Limite** : 
  - Nutritionix : 500 req/jour
  - Open Food Facts : Illimité
  - OpenAI : Selon votre plan

### Amélioration future possible

- [ ] Cache local des données nutritionnelles
- [ ] Base de données locale pré-remplie pour ingrédients courants
- [ ] Support de plusieurs langues pour améliorer les recherches
- [ ] API de correction manuelle avec validation par admin

### Support

Pour les ingrédients très spécifiques ou régionaux qui ne sont trouvés par aucune API, l'administrateur peut :
1. Laisser l'auto-complétion essayer (valeurs par défaut si échec)
2. Modifier manuellement les valeurs dans l'interface
3. Les valeurs sont toujours éditables après création

### Exemples de sources de données

**Nutritionix** : Excellent pour
- Fruits frais (mangue, avocat, banane)
- Légumes (tomate, concombre, carotte)
- Viandes et poissons (saumon, poulet, thon)
- Produits laitiers

**Open Food Facts** : Excellent pour
- Produits packagés (Coca Cola, Nutella)
- Produits transformés
- Base de données internationale

**OpenAI** : Utile pour
- Ingrédients rares ou régionaux
- Plats composés
- Estimations quand aucune donnée exacte n'existe
