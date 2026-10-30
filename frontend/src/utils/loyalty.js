// Fidélité — taux de conversion unique points ⇄ euros.
// 1 pt = 1/POINTS_PER_EURO €. Changer ce seul nombre suffit à modifier le taux partout.
export const POINTS_PER_EURO = 10; // 100 pts = 10 €

// Valeur en € d'un nombre de points (au centime).
export const pointsToEuros = (pts) => (Number(pts) || 0) / POINTS_PER_EURO;

// Nombre maximal de points utilisables pour couvrir un montant en €.
export const maxPointsForEuros = (euros) => Math.round((Number(euros) || 0) * POINTS_PER_EURO);
