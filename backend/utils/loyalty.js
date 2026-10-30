// Fidélité — taux de conversion unique points ⇄ euros (miroir backend de frontend/src/utils/loyalty.js).
// 1 pt = 1/POINTS_PER_EURO €. Changer ce seul nombre suffit à modifier le taux côté serveur.
const POINTS_PER_EURO = 10; // 100 pts = 10 €

module.exports = { POINTS_PER_EURO };
