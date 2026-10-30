/**
 * Service de récupération automatique des informations nutritionnelles
 * 
 * Stratégie :
 * 1. Essayer l'API Nutritionix (gratuite, 500 req/jour)
 * 2. Fallback sur Open Food Facts (gratuit, illimité)
 * 3. Fallback sur estimation IA
 * 4. Retourner valeurs par défaut si tout échoue
 */

const OpenAI = require('openai');

// Configuration OpenAI (pour fallback IA)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
}) : null;

/**
 * Récupère les informations nutritionnelles depuis Nutritionix
 */
async function fetchFromNutritionix(ingredientName) {
  try {
    const appId = process.env.NUTRITIONIX_APP_ID;
    const appKey = process.env.NUTRITIONIX_API_KEY;

    if (!appId || !appKey) {
      throw new Error('Nutritionix credentials not configured');
    }

    const response = await fetch('https://trackapi.nutritionix.com/v2/natural/nutrients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': appId,
        'x-app-key': appKey
      },
      body: JSON.stringify({
        query: ingredientName,
        timezone: 'Europe/Paris'
      })
    });

    if (!response.ok) {
      throw new Error(`Nutritionix API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.foods && data.foods.length > 0) {
      const food = data.foods[0];
      return {
        calories: Math.round(food.nf_calories || 0),
        proteins: Math.round(food.nf_protein * 10) / 10 || 0,
        carbs: Math.round(food.nf_total_carbohydrate * 10) / 10 || 0,
        fat: Math.round(food.nf_total_fat * 10) / 10 || 0,
        source: 'nutritionix'
      };
    }

    return null;
  } catch (error) {
    console.log(`⚠️  Nutritionix failed for "${ingredientName}":`, error.message);
    return null;
  }
}

/**
 * Récupère les informations nutritionnelles depuis Open Food Facts
 */
async function fetchFromOpenFoodFacts(ingredientName) {
  try {
    const searchQuery = encodeURIComponent(ingredientName);
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${searchQuery}&search_simple=1&action=process&json=1&page_size=1`
    );

    if (!response.ok) {
      throw new Error(`Open Food Facts API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.products && data.products.length > 0) {
      const product = data.products[0];
      const nutriments = product.nutriments || {};

      return {
        calories: Math.round(nutriments['energy-kcal_100g'] || 0),
        proteins: Math.round((nutriments.proteins_100g || 0) * 10) / 10,
        carbs: Math.round((nutriments.carbohydrates_100g || 0) * 10) / 10,
        fat: Math.round((nutriments.fat_100g || 0) * 10) / 10,
        source: 'openfoodfacts'
      };
    }

    return null;
  } catch (error) {
    console.log(`⚠️  Open Food Facts failed for "${ingredientName}":`, error.message);
    return null;
  }
}

/**
 * Estimation avec OpenAI (fallback)
 */
async function estimateWithAI(ingredientName) {
  try {
    if (!openai) {
      throw new Error('OpenAI not configured');
    }

    const prompt = `Pour l'ingrédient "${ingredientName}", donne-moi les valeurs nutritionnelles moyennes pour 100g.
Réponds UNIQUEMENT au format JSON suivant (sans markdown, sans explication):
{
  "calories": <nombre en kcal>,
  "proteins": <nombre en grammes, 1 décimale>,
  "carbs": <nombre en grammes, 1 décimale>,
  "fat": <nombre en grammes, 1 décimale>
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'Tu es un expert nutritionniste. Réponds uniquement en JSON valide, sans markdown.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 150
    });

    const responseText = completion.choices[0].message.content.trim();
    
    // Nettoyer la réponse (enlever markdown si présent)
    const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const nutritionData = JSON.parse(jsonText);

    return {
      calories: Math.round(nutritionData.calories || 0),
      proteins: Math.round((nutritionData.proteins || 0) * 10) / 10,
      carbs: Math.round((nutritionData.carbs || 0) * 10) / 10,
      fat: Math.round((nutritionData.fat || 0) * 10) / 10,
      source: 'openai'
    };
  } catch (error) {
    console.log(`⚠️  OpenAI estimation failed for "${ingredientName}":`, error.message);
    return null;
  }
}

/**
 * Fonction principale : récupère les infos nutritionnelles avec stratégie de fallback
 */
async function getNutritionInfo(ingredientName) {
  console.log(`🔍 Recherche des infos nutritionnelles pour: "${ingredientName}"`);

  // Stratégie 1: Nutritionix (le plus précis)
  let nutritionData = await fetchFromNutritionix(ingredientName);
  if (nutritionData) {
    console.log(`✅ Données trouvées via Nutritionix`);
    return nutritionData;
  }

  // Stratégie 2: Open Food Facts (gratuit illimité)
  nutritionData = await fetchFromOpenFoodFacts(ingredientName);
  if (nutritionData) {
    console.log(`✅ Données trouvées via Open Food Facts`);
    return nutritionData;
  }

  // Stratégie 3: Estimation IA
  nutritionData = await estimateWithAI(ingredientName);
  if (nutritionData) {
    console.log(`✅ Données estimées via OpenAI`);
    return nutritionData;
  }

  // Stratégie 4: Valeurs par défaut
  console.log(`⚠️  Aucune donnée trouvée, utilisation des valeurs par défaut`);
  return {
    calories: 0,
    proteins: 0,
    carbs: 0,
    fat: 0,
    source: 'default'
  };
}

module.exports = {
  getNutritionInfo
};
