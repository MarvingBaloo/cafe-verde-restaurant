// backend/scripts/buildHoursMirror.js
// Génère frontend/src/utils/hours.js à partir de backend/utils/hours.js.
//
// Le calcul d'ouverture existe des deux côtés : le serveur décide, l'écran doit dire
// la même chose. Le projet a déjà payé le prix des rendus recopiés à la main qui
// divergent en silence (receiptRenderer vs ticket imprimé). Ici on ne recopie pas :
// on transforme CommonJS → ESM, et checkOpeningHours.js vérifie que le fichier
// publié correspond bien à cette transformation.
//
//   node backend/scripts/buildHoursMirror.js          # écrit le miroir
//   node backend/scripts/buildHoursMirror.js --check  # vérifie sans écrire

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'utils', 'hours.js');
const TARGET = path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'hours.js');

const HEADER = `// frontend/src/utils/hours.js
// ⚠️ FICHIER GÉNÉRÉ — ne pas modifier à la main.
// Source : backend/utils/hours.js · Régénérer : node backend/scripts/buildHoursMirror.js
//
// L'écran doit annoncer exactement ce que le serveur applique. Le serveur reste
// l'autorité : l'horloge du visiteur peut être fausse, et une garde qui ne vit que
// dans le navigateur se contourne.
`;

function buildMirror() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const body = source
    // en-tête CommonJS remplacé par celui du miroir
    .replace(/^\/\/ backend\/utils\/hours\.js[\s\S]*?\n\nconst RESTAURANT_TIMEZONE/, 'const RESTAURANT_TIMEZONE')
    // bloc d'export CommonJS final
    .replace(/\nmodule\.exports = \{[\s\S]*?\n\};\n?$/, '\n')
    // tout ce qui est déclaré au premier niveau devient un export nommé
    .replace(/^function /gm, 'export function ')
    .replace(/^const /gm, 'export const ');
  return `${HEADER}\n${body.trim()}\n`;
}

const mirror = buildMirror();
const check = process.argv.includes('--check');
const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;

if (check) {
  if (current !== mirror) {
    console.error('✗ frontend/src/utils/hours.js ne correspond plus à backend/utils/hours.js');
    console.error('  → node backend/scripts/buildHoursMirror.js');
    process.exit(1);
  }
  console.log('✓ miroir frontend à jour');
} else {
  fs.writeFileSync(TARGET, mirror);
  console.log(current === mirror ? '✓ miroir déjà à jour' : '✓ miroir frontend régénéré');
}
