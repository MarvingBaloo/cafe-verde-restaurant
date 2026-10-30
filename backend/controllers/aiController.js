// backend/controllers/aiController.js
const { findAvailable } = require('../models/Ingredient');
const { findFirstAvailableByType } = require('../models/Formula');

/**
 * @desc    Obtenir des suggestions d'ingrédients intelligentes basées sur le panier actuel
 * @route   POST /api/ai/suggest
 * @access  Public
 */
const getSuggestions = async (req, res) => {
  try {
    const { currentIngredients, formulaType } = req.body;

    if (!currentIngredients || !Array.isArray(currentIngredients)) {
      return res.status(400).json({
        success: false,
        message: 'La liste des ingrédients actuels est requise'
      });
    }

    if (!formulaType) {
      return res.status(400).json({
        success: false,
        message: 'Le type de formule est requis'
      });
    }

    // Accepte id ou _id pour la transition Mongoose → Firestore
    const selectedIds = currentIngredients.map(ing => ing.id || ing._id || ing);
    const selectedCategories = currentIngredients.map(ing => ing.category).filter(Boolean);
    const selectedTags = currentIngredients.flatMap(ing => ing.tags || []).filter(Boolean);

    // Charge tous les ingrédients disponibles une seule fois,
    // puis filtre en mémoire (collection petite, évite des allers-retours Firestore supplémentaires)
    const allAvailable = await findAvailable();
    const pool = allAvailable.filter(ing => !selectedIds.includes(ing.id));

    let suggestion = null;
    let message = '';

    if (formulaType === 'salad') {
      const hasBase    = selectedCategories.includes('base_salade');
      const hasProtein = selectedCategories.includes('proteine');
      const hasSaumon  = currentIngredients.some(ing => ing.name === 'Saumon Mariné');
      const hasPoulet  = currentIngredients.some(ing => ing.name === 'Poulet Croustillant');

      if (hasBase && !hasProtein) {
        suggestion = pool.find(ing => ing.category === 'proteine') || null;
        if (suggestion) message = '🍗 Le Chef suggère une protéine pour équilibrer votre salade !';

      } else if (hasSaumon) {
        suggestion = pool.find(ing => ['Avocat', 'Mangue'].includes(ing.name)) || null;
        if (suggestion) message = `✨ Le ${suggestion.name} se marie parfaitement avec le saumon !`;

      } else if (hasPoulet) {
        suggestion = pool.find(ing =>
          ['topping_legume', 'topping_fruit', 'sauce'].includes(ing.category) &&
          (ing.tags || []).some(t => ['épicé', 'croquant'].includes(t))
        ) || null;
        if (suggestion) message = '🌶️ Une touche de caractère pour votre poulet !';

      } else if (hasBase && hasProtein) {
        suggestion = pool.find(ing =>
          ['topping_legume', 'topping_fruit'].includes(ing.category) &&
          !(ing.tags || []).some(t => selectedTags.includes(t))
        ) || null;
        if (suggestion) message = '🥗 Une touche de fraîcheur pour équilibrer !';
      }

    } else {
      return res.status(400).json({
        success: false,
        message: 'Type de formule non supporté'
      });
    }

    // Fallback : ingrédient premium disponible non encore sélectionné
    if (!suggestion) {
      suggestion = pool.find(ing => ing.is_premium) || null;
      if (suggestion) message = '⭐ Une touche premium pour sublimer votre création !';
    }

    if (suggestion) {
      return res.status(200).json({
        success: true,
        suggestion: { ...suggestion, suggestionMessage: message }
      });
    }

    return res.status(200).json({
      success: true,
      suggestion: null,
      message: 'Votre composition est déjà parfaite ! 👌'
    });

  } catch (error) {
    console.error('Erreur dans getSuggestions:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la génération de suggestions',
      error: error.message
    });
  }
};

/**
 * @desc    Générer une composition complète basée sur l'humeur (Mood Food)
 * @route   POST /api/ai/mood
 * @access  Public
 */
const getMoodRecommendation = async (req, res) => {
  try {
    const { mood } = req.body;

    if (!mood) {
      return res.status(400).json({ success: false, message: 'Le mood est requis' });
    }

    const moodProfiles = {
      'sport':   { tags: ['protéine', 'énergie', 'rassasiant', 'base'],   formulaType: 'salad', description: '💪 Un bol protéiné pour la récupération musculaire !' },
      'fatigue': { tags: ['vitaminé', 'fruité', 'frais', 'léger'],         formulaType: 'salad', description: '⚡ Un boost de vitamines pour repartir du bon pied !' },
      'comfort': { tags: ['crémeux', 'rassasiant', 'savoureux', 'onctueux'], formulaType: 'salad', description: '🧸 Une douceur réconfortante bien méritée.' },
      'focus':   { tags: ['omega3', 'sain', 'léger', 'antioxydant'],       formulaType: 'salad', description: '🧠 Des nutriments pour booster votre concentration.' }
    };

    const profile = moodProfiles[mood];
    if (!profile) {
      return res.status(400).json({ success: false, message: 'Mood non reconnu' });
    }

    const formula = await findFirstAvailableByType(profile.formulaType);

    if (!formula) {
      return res.status(404).json({ success: false, message: 'Aucune formule disponible pour ce mood' });
    }

    const allIngredients = await findAvailable();

    const selectedIngredients = [];

    const pickIngredient = (category, limit) => {
      let candidates = allIngredients.filter(ing => ing.category === category);

      candidates.sort((a, b) => {
        const scoreA = (a.tags || []).filter(t => profile.tags.includes(t)).length;
        const scoreB = (b.tags || []).filter(t => profile.tags.includes(t)).length;
        return scoreB - scoreA;
      });

      const topCandidates = candidates.filter(c =>
        (c.tags || []).filter(t => profile.tags.includes(t)).length > 0
      );
      const pool = topCandidates.length > 0 ? topCandidates : candidates;

      for (let i = 0; i < limit; i++) {
        if (pool.length > i) selectedIngredients.push(pool[i]);
      }
    };

    for (const [key, limit] of Object.entries(formula.limits)) {
      const limitKeyToCategory = {
        'base':    'base_salade',
        'protein': 'proteine',
        'topping': ['topping_legume', 'topping_fruit'],
        'sauce':   'sauce'
      };

      const categoryTarget = limitKeyToCategory[key];
      if (categoryTarget && limit > 0) {
        if (Array.isArray(categoryTarget)) {
          pickIngredient(categoryTarget[0], Math.ceil(limit / 2));
          pickIngredient(categoryTarget[1], Math.floor(limit / 2));
        } else {
          pickIngredient(categoryTarget, limit);
        }
      }
    }

    res.json({
      success: true,
      data: {
        mood,
        description: profile.description,
        formula,
        ingredients: selectedIngredients
      }
    });

  } catch (error) {
    console.error('Erreur Mood Food:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur Mood Food' });
  }
};

module.exports = { getSuggestions, getMoodRecommendation };
