// backend/scripts/checkOpeningHours.js
// Vérifie la fenêtre de commande en ligne (backend/utils/hours.js) sur des cas datés.
// À relancer après toute modification des horaires ou de la fenêtre de commande —
// même rôle que checkSplitMerge.js pour l'addition séparée.
//
//   node backend/scripts/checkOpeningHours.js
//
// ⚠️ Les instants sont donnés en UTC ; la Guadeloupe est à UTC−4 toute l'année
// (pas d'heure d'été), donc 2026-09-22T15:00:00Z = mardi 11h00 sur place.

const { getOnlineOrderingStatus, closedMessage, getSchedulingOffer, getTodayPickupOffer,
  validateScheduledPickup, kitchenReleaseAt, zonedToUtc } = require('../utils/hours');

const CONFIG = {
  timezone: 'America/Guadeloupe',
  days: {
    0: null, // dimanche fermé
    1: { open: '12:00', close: '21:00' },
    2: { open: '12:00', close: '21:00' },
    3: { open: '12:00', close: '21:00' },
    4: { open: '12:00', close: '21:00' },
    5: { open: '12:00', close: '21:00' },
    6: { open: '12:00', close: '21:00' },
  },
  preOrderLead: 60,
  lastOrderMargin: 30,
  onlineOrderingEnabled: true,
  closedDates: ['2026-12-25'], // vendredi : une fermeture exceptionnelle un jour ouvré
};

// [libellé, instant UTC, ouvert ?, raison attendue, réouverture attendue (ou null)]
const CASES = [
  ['mardi 11h00 — pile à la pré-ouverture', '2026-09-22T15:00:00Z', true,  null,               null],
  ['mardi 11h15 — dans la pré-ouverture',   '2026-09-22T15:15:00Z', true,  null,               null],
  ['mardi 10h30 — avant la pré-ouverture',  '2026-09-22T14:30:00Z', false, 'before_opening',   'mardi 11:00'],
  ['mardi 15h00 — plein service',           '2026-09-22T19:00:00Z', true,  null,               null],
  ['mardi 20h29 — juste avant la limite',   '2026-09-23T00:29:00Z', true,  null,               null],
  ['mardi 20h30 — dernière commande passée','2026-09-23T00:30:00Z', false, 'after_last_order', 'mercredi 11:00'],
  ['mardi 22h00 — après fermeture',         '2026-09-23T02:00:00Z', false, 'after_last_order', 'mercredi 11:00'],
  ['dimanche 11h15 — jour fermé',           '2026-09-20T15:15:00Z', false, 'closed_day',       'lundi 11:00'],
  ['dimanche 15h00 — jour fermé',           '2026-09-20T19:00:00Z', false, 'closed_day',       'lundi 11:00'],
  ['dimanche 23h00 — veille d\'un lundi',   '2026-09-21T03:00:00Z', false, 'closed_day',       'lundi 11:00'],
  ['samedi 22h00 — dimanche sauté',         '2026-09-20T02:00:00Z', false, 'after_last_order', 'lundi 11:00'],
  ['vendredi 25/12 — fermeture exceptionnelle','2026-12-25T19:00:00Z', false, 'closed_date',    'samedi 11:00'],
];

let failed = 0;

for (const [label, iso, expectOpen, expectReason, expectNext] of CASES) {
  const st = getOnlineOrderingStatus(CONFIG, new Date(iso));
  const next = st.nextOpening ? `${st.nextOpening.weekdayName} ${st.nextOpening.time}` : null;
  const ok = st.open === expectOpen && st.reason === expectReason && next === expectNext;
  if (!ok) {
    failed += 1;
    console.error(`✗ ${label}`);
    console.error(`    attendu : open=${expectOpen} reason=${expectReason} next=${expectNext}`);
    console.error(`    obtenu  : open=${st.open} reason=${st.reason} next=${next}`);
  } else {
    const suffix = st.open ? (st.beforeService ? ' (avant le service)' : '') : ` → « ${closedMessage(st)} »`;
    console.log(`✓ ${label}${suffix}`);
  }
}

// La coupure manuelle prime sur tout, y compris en plein service.
const cut = getOnlineOrderingStatus({ ...CONFIG, onlineOrderingEnabled: false }, new Date('2026-09-22T19:00:00Z'));
if (cut.open || cut.reason !== 'disabled') {
  failed += 1;
  console.error(`✗ coupure manuelle en plein service : open=${cut.open} reason=${cut.reason}`);
} else {
  console.log(`✓ coupure manuelle en plein service → « ${closedMessage(cut)} »`);
}

// Une marge qui avale le créneau ferme la journée plutôt que d'ouvrir une fenêtre absurde.
const greedy = getOnlineOrderingStatus({ ...CONFIG, lastOrderMargin: 600 }, new Date('2026-09-22T19:00:00Z'));
if (greedy.open || greedy.reason !== 'closed_day') {
  failed += 1;
  console.error(`✗ marge supérieure au service : open=${greedy.open} reason=${greedy.reason}`);
} else {
  console.log('✓ marge supérieure au service → journée fermée');
}

// --- Commande à l'avance pour le lendemain ---------------------------------
// [libellé, instant UTC, jour proposé attendu (ou null)]
const SCHEDULING_CASES = [
  ['mardi 21h30 — trop tard, demain ouvert',  '2026-09-23T01:30:00Z', 'mercredi'],
  ['mardi 20h30 — dès la clôture',            '2026-09-23T00:30:00Z', 'mercredi'],
  ['mardi 15h00 — service en cours',          '2026-09-22T19:00:00Z', null],
  ['mardi 10h00 — avant la pré-ouverture',    '2026-09-22T14:00:00Z', null],
  ['samedi 22h00 — demain est un dimanche',   '2026-09-20T02:00:00Z', null],
  ['dimanche 20h00 — jour fermé',             '2026-09-21T00:00:00Z', null],
  ['jeudi 24/12 21h30 — demain est fermé',    '2026-12-25T01:30:00Z', null],
];

for (const [label, iso, expectDay] of SCHEDULING_CASES) {
  const offer = getSchedulingOffer(CONFIG, new Date(iso));
  const got = offer ? offer.weekdayName : null;
  if (got !== expectDay) {
    failed += 1;
    console.error(`✗ ${label} : attendu ${expectDay}, obtenu ${got}`);
  } else {
    console.log(`✓ ${label}${offer ? ` → retrait ${offer.weekdayName} de ${offer.slots[0]} à ${offer.slots[offer.slots.length - 1]}` : ' → aucune commande à l\'avance'}`);
  }
}

// --- Créneau de retrait du jour --------------------------------------------
// Toute commande en ligne porte une heure de retrait. Le premier créneau est décalé de
// 15 minutes après l'ouverture (commande passée avant le service) ou après l'instant de
// la commande (service en cours) — jamais avant.
// [libellé, instant UTC, premier créneau attendu (ou null), dernier créneau attendu]
const TODAY_CASES = [
  ['mardi 11h00 — pré-ouverture, service à 12h', '2026-09-22T15:00:00Z', '12:15', '21:00'],
  ['mardi 11h45 — toujours avant le service',    '2026-09-22T15:45:00Z', '12:15', '21:00'],
  ['mardi 12h00 — pile à l\'ouverture',          '2026-09-22T16:00:00Z', '12:15', '21:00'],
  ['mardi 13h00 — service en cours',             '2026-09-22T17:00:00Z', '13:15', '21:00'],
  ['mardi 13h05 — arrondi au créneau suivant',   '2026-09-22T17:05:00Z', '13:30', '21:00'],
  ['mardi 10h30 — avant la pré-ouverture',       '2026-09-22T14:30:00Z', null,    null],
  ['mardi 20h30 — dernière commande passée',     '2026-09-23T00:30:00Z', null,    null],
  ['dimanche 15h00 — jour fermé',                '2026-09-20T19:00:00Z', null,    null],
];

for (const [label, iso, expectFirst, expectLast] of TODAY_CASES) {
  const offer = getTodayPickupOffer(CONFIG, new Date(iso));
  const first = offer ? offer.slots[0] : null;
  const last = offer ? offer.slots[offer.slots.length - 1] : null;
  if (first !== expectFirst || last !== expectLast) {
    failed += 1;
    console.error(`✗ ${label} : attendu ${expectFirst}–${expectLast}, obtenu ${first}–${last}`);
  } else {
    console.log(`✓ ${label}${offer ? ` → retrait de ${first} à ${last}` : ' → aucun créneau aujourd\'hui'}`);
  }
}

// La coupure manuelle ferme aussi les créneaux du jour, pas seulement la commande immédiate.
if (getTodayPickupOffer({ ...CONFIG, onlineOrderingEnabled: false }, new Date('2026-09-22T17:00:00Z')) !== null) {
  failed += 1;
  console.error('✗ coupure manuelle : des créneaux du jour sont encore proposés');
} else {
  console.log('✓ coupure manuelle → aucun créneau du jour');
}

// Un créneau du jour est accepté par le serveur, mais jamais en deçà du délai de préparation.
const MARDI_MIDI = new Date('2026-09-22T17:00:00Z'); // 13h00 sur place
const MARDI_PREOUVERTURE = new Date('2026-09-22T15:00:00Z'); // 11h00 sur place
const TODAY_PICKUP_CHECKS = [
  ['service en cours, retrait à 13h15',      MARDI_MIDI,          zonedToUtc('2026-09-22', '13:15'), true],
  ['service en cours, retrait à 13h00',      MARDI_MIDI,          zonedToUtc('2026-09-22', '13:00'), false],
  ['pré-ouverture, retrait à 12h15',         MARDI_PREOUVERTURE,  zonedToUtc('2026-09-22', '12:15'), true],
  ['pré-ouverture, retrait à 12h00',         MARDI_PREOUVERTURE,  zonedToUtc('2026-09-22', '12:00'), false],
  ['service en cours, retrait demain 12h30', MARDI_MIDI,          zonedToUtc('2026-09-23', '12:30'), false],
];
for (const [label, when, pickup, expectOk] of TODAY_PICKUP_CHECKS) {
  const r = validateScheduledPickup(CONFIG, pickup.toISOString(), when);
  if (r.ok !== expectOk) {
    failed += 1;
    console.error(`✗ ${label} : attendu ok=${expectOk}, obtenu ok=${r.ok} (${r.message || ''})`);
  } else {
    console.log(`✓ ${label}${r.ok ? '' : ` → refusé : « ${r.message} »`}`);
  }
}

// Le créneau envoyé par le client est revalidé : ni un autre jour, ni une heure hors service.
const MARDI_SOIR = new Date('2026-09-23T01:30:00Z');
const PICKUP_CHECKS = [
  ['créneau valide (mercredi 12h30)',   zonedToUtc('2026-09-23', '12:30'), true],
  ['créneau hors service (mercredi 22h)', zonedToUtc('2026-09-23', '22:00'), false],
  ['autre jour (jeudi 12h30)',          zonedToUtc('2026-09-24', '12:30'), false],
  ['jour même (mardi 20h45)',           zonedToUtc('2026-09-22', '20:45'), false],
];
for (const [label, when, expectOk] of PICKUP_CHECKS) {
  const r = validateScheduledPickup(CONFIG, when.toISOString(), MARDI_SOIR);
  if (r.ok !== expectOk) {
    failed += 1;
    console.error(`✗ ${label} : attendu ok=${expectOk}, obtenu ok=${r.ok} (${r.message || ''})`);
  } else {
    console.log(`✓ ${label}${r.ok ? '' : ` → refusé : « ${r.message} »`}`);
  }
}

// La commande n'arrive en cuisine qu'au moment de la préparer, pas dès l'ouverture.
const release = kitchenReleaseAt(CONFIG, zonedToUtc('2026-09-23', '19:00'));
const expectedRelease = zonedToUtc('2026-09-23', '18:30').getTime();
if (release.getTime() !== expectedRelease) {
  failed += 1;
  console.error(`✗ sortie cuisine pour un retrait à 19h : attendu 18h30, obtenu ${release.toISOString()}`);
} else {
  console.log('✓ retrait à 19h00 → apparaît en cuisine à 18h30');
}

// Le miroir frontend doit correspondre au fichier généré depuis celui-ci — sans quoi
// l'écran peut annoncer une chose et le serveur en appliquer une autre.
try {
  require('child_process').execFileSync('node',
    [require('path').join(__dirname, 'buildHoursMirror.js'), '--check'], { stdio: 'pipe' });
  console.log('✓ miroir frontend à jour');
} catch (err) {
  failed += 1;
  console.error('✗ miroir frontend périmé → node backend/scripts/buildHoursMirror.js');
}

const total = CASES.length + 2 + SCHEDULING_CASES.length + TODAY_CASES.length + 1
  + TODAY_PICKUP_CHECKS.length + PICKUP_CHECKS.length + 2;
console.log(failed === 0 ? `\n${total} cas vérifiés, aucun écart.` : `\n${failed} cas en échec.`);
process.exit(failed === 0 ? 0 : 1);
