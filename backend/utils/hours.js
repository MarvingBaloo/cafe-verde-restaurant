// backend/utils/hours.js
// Ouverture du restaurant et fenêtre de commande en ligne — fonctions pures, sans I/O.
// ⚠️ Miroir exact de frontend/src/utils/hours.js : toute modification ici doit y être reportée
// (même règle que loyalty.js / tax.js). Un écran qui dit « ouvert » pendant que le serveur
// refuse la commande est pire que pas de garde du tout.
//
// Tout le calcul se fait dans le fuseau du restaurant, JAMAIS dans celui du visiteur :
// sans ça, un client qui consulte depuis la métropole voit « ouvert » à 3h du matin.

const RESTAURANT_TIMEZONE = 'America/Guadeloupe';

// 0 = dimanche … 6 = samedi (aligné sur Date#getDay).
const WEEKDAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** 'HH:MM' → minutes depuis minuit. null si la valeur est inexploitable. */
function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** minutes depuis minuit → 'HH:MM'. */
function formatTime(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Éclate un instant dans le fuseau du restaurant.
 * @returns {{ year:number, month:number, day:number, weekday:number, minutes:number, date:string }}
 */
function localParts(now = new Date(), timeZone = RESTAURANT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  // Date civile en UTC : sert uniquement à dériver le jour de la semaine et à
  // avancer de N jours sans jamais retomber dans un décalage de fuseau.
  const civil = new Date(Date.UTC(year, month - 1, day));
  return {
    year, month, day,
    weekday: civil.getUTCDay(),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Avance d'un nombre de jours civils : { year, month, day } → { date, weekday }. */
function addDays({ year, month, day }, offset) {
  const civil = new Date(Date.UTC(year, month - 1, day + offset));
  const iso = civil.toISOString().slice(0, 10);
  return {
    year: civil.getUTCFullYear(),
    month: civil.getUTCMonth() + 1,
    day: civil.getUTCDate(),
    weekday: civil.getUTCDay(),
    date: iso,
  };
}

/**
 * Fenêtre de commande en ligne d'un jour donné.
 *
 * Elle ne se confond pas avec les horaires du restaurant : on prend les commandes
 * un peu AVANT l'ouverture (le client commande à 11h15 pour un service qui démarre
 * à 12h) et on s'arrête un peu AVANT la fermeture (la cuisine doit pouvoir finir).
 *   fenêtre = [ouverture − preOrderLead, fermeture − lastOrderMargin[
 *
 * ⚠️ La pré-ouverture ne franchit jamais un jour fermé : elle est calculée sur le jour
 * du service. Un dimanche reste fermé à toute heure, y compris à 23h la veille d'un lundi.
 *
 * @returns {{ open:number, close:number, lastOrder:number, orderingStart:number }|null}
 *          null = aucune commande possible ce jour-là.
 */
function orderingWindow(config, weekday, isoDate) {
  if (Array.isArray(config?.closedDates) && config.closedDates.includes(isoDate)) return null;
  const slot = config?.days?.[weekday];
  if (!slot) return null;
  const open = parseTime(slot.open);
  const close = parseTime(slot.close);
  if (open === null || close === null || close <= open) return null;
  // La marge protège la cuisine : plus aucune commande en ligne n'entre dans les
  // dernières minutes de service. Une marge qui avale le créneau ferme la journée.
  const lastOrder = close - Math.max(0, Number(config?.lastOrderMargin) || 0);
  if (lastOrder <= open) return null;
  // Avance de prise de commande, bornée à minuit du même jour.
  const orderingStart = Math.max(0, open - Math.max(0, Number(config?.preOrderLead) || 0));
  return { open, close, lastOrder, orderingStart };
}

/**
 * Prochaine ouverture de la commande en ligne, à partir d'un instant local.
 * @returns {{ date:string, weekday:number, weekdayName:string, time:string, daysAhead:number }|null}
 */
function findNextOpening(config, today) {
  // 8 jours : de quoi couvrir la semaine entière depuis n'importe quel jour.
  for (let offset = 0; offset <= 8; offset += 1) {
    const d = offset === 0 ? today : addDays(today, offset);
    const window = orderingWindow(config, d.weekday, d.date);
    if (!window) continue;
    // Aujourd'hui, l'ouverture ne compte que si elle est encore devant nous.
    if (offset === 0 && today.minutes >= window.orderingStart) continue;
    return {
      date: d.date,
      weekday: d.weekday,
      weekdayName: WEEKDAY_NAMES[d.weekday],
      // `time` = heure à laquelle on PEUT COMMANDER (c'est ce qu'on annonce au client) ;
      // `serviceTime` = heure d'ouverture du restaurant (celle du footer).
      time: formatTime(window.orderingStart),
      serviceTime: formatTime(window.open),
      daysAhead: offset,
    };
  }
  return null;
}

/**
 * La commande en ligne est-elle ouverte maintenant ?
 * @param {Object} config Doc `settings/hours` normalisé.
 * @param {Date}   now
 * @returns {{ open:boolean, reason:string|null, lastOrderTime:string|null, closingTime:string|null,
 *             openingTime:string|null, orderingStartTime:string|null, nextOpening:Object|null, timezone:string }}
 *   reason : disabled | closed_date | closed_day | before_opening | after_last_order
 */
function getOnlineOrderingStatus(config, now = new Date()) {
  const timezone = config?.timezone || RESTAURANT_TIMEZONE;
  const today = localParts(now, timezone);
  const base = { open: false, reason: null, lastOrderTime: null, closingTime: null,
    openingTime: null, orderingStartTime: null, nextOpening: null, timezone };

  // Coupure manuelle du gérant : elle prime sur tout le reste, y compris un jour ouvré.
  if (config?.onlineOrderingEnabled === false) {
    return { ...base, reason: 'disabled' };
  }

  const window = orderingWindow(config, today.weekday, today.date);
  const nextOpening = findNextOpening(config, today);

  if (!window) {
    const isClosedDate = Array.isArray(config?.closedDates) && config.closedDates.includes(today.date);
    return { ...base, reason: isClosedDate ? 'closed_date' : 'closed_day', nextOpening };
  }

  const lastOrderTime = formatTime(window.lastOrder);
  const closingTime = formatTime(window.close);

  const openingTime = formatTime(window.open);
  const orderingStartTime = formatTime(window.orderingStart);
  const detail = { lastOrderTime, closingTime, openingTime, orderingStartTime };

  if (today.minutes < window.orderingStart) {
    return { ...base, ...detail, reason: 'before_opening', nextOpening };
  }
  if (today.minutes >= window.lastOrder) {
    return { ...base, ...detail, reason: 'after_last_order', nextOpening };
  }

  // Commandes ouvertes, mais le service n'a pas encore commencé : le client doit
  // savoir que sa commande sera préparée à l'ouverture, pas dans dix minutes.
  const beforeService = today.minutes < window.open;
  return { open: true, reason: null, ...detail, beforeService, nextOpening: null, timezone };
}

/** '12:30' → '12h30', '12:00' → '12h' (une heure ronde ne porte pas ses minutes). */
function humanTime(hhmm) {
  const s = String(hhmm || '');
  return s.endsWith(':00') ? `${s.slice(0, -3)}h` : s.replace(':', 'h');
}

/** « lundi à 12h00 », « demain à 12h00 », « à 12h00 » selon la distance. */
function humanNextOpening(nextOpening) {
  if (!nextOpening) return null;
  const at = `à ${humanTime(nextOpening.time)}`;
  if (nextOpening.daysAhead === 0) return at;
  if (nextOpening.daysAhead === 1) return `demain ${at}`;
  return `${nextOpening.weekdayName} ${at}`;
}

/**
 * Phrase affichée au client quand la commande en ligne est fermée.
 * Une seule formulation, côté serveur comme côté écran.
 */
function closedMessage(status) {
  if (!status || status.open) return null;
  const next = humanNextOpening(status.nextOpening);
  const reopen = next ? ` Réouverture des commandes ${next}.` : '';
  switch (status.reason) {
    case 'disabled':
      return `Les commandes en ligne sont momentanément suspendues.${reopen}`;
    case 'closed_date':
    case 'closed_day':
      return `Nous sommes fermés aujourd'hui.${reopen}`;
    case 'before_opening':
      return `Nous ne sommes pas encore ouverts.${reopen}`;
    case 'after_last_order':
      return `Les commandes en ligne sont closes pour aujourd'hui`
        + (status.lastOrderTime ? ` (dernière commande à ${humanTime(status.lastOrderTime)}).` : '.')
        + reopen;
    default:
      return `Les commandes en ligne ne sont pas disponibles actuellement.${reopen}`;
  }
}

// --- Commande programmée pour le lendemain ---------------------------------
// Quand la journée est close (`after_last_order`), le client peut commander pour le
// service SUIVANT — et seulement si c'est le lendemain. Un samedi 21h, la prochaine
// journée est le lundi : on ne prend pas une commande qui dormirait 36 heures.

/** Décalage du fuseau (en minutes) à un instant donné. */
function tzOffsetMinutes(date, timeZone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day) + p.minutes * 60000;
  return (asUtc - date.getTime()) / 60000;
}

/** Une date civile + une heure, LUES dans le fuseau du restaurant → instant UTC. */
function zonedToUtc(isoDate, hhmm, timeZone = RESTAURANT_TIMEZONE) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const minutes = parseTime(hhmm);
  if (!y || !m || !d || minutes === null) return null;
  const guess = Date.UTC(y, m - 1, d, 0, 0) + minutes * 60000;
  // Deux passes : la première approxime, la seconde corrige si l'offset change ce jour-là.
  let ts = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  ts = guess - tzOffsetMinutes(new Date(ts), timeZone) * 60000;
  return new Date(ts);
}

/**
 * Délai minimum entre la commande et le retrait : la cuisine doit avoir le temps de préparer.
 * On ne propose jamais un créneau plus tôt, même en plein service.
 */
const PICKUP_LEAD_MINUTES = 15;

/** Créneaux de retrait d'une journée, de l'ouverture à la fermeture, par pas de `stepMinutes`. */
function pickupSlots(window, stepMinutes = 15) {
  const step = Math.max(5, Number(stepMinutes) || 15);
  const slots = [];
  // Premier créneau aligné sur le pas (12:00, 12:15, …), dernier = fermeture incluse.
  for (let m = Math.ceil(window.open / step) * step; m <= window.close; m += step) {
    slots.push(formatTime(m));
  }
  return slots;
}

/**
 * Créneaux de retrait proposés pour AUJOURD'HUI, tant que la commande en ligne est ouverte.
 *
 * C'est le cas courant : toute commande en ligne porte désormais une heure de retrait, que le
 * client commande avant l'ouverture (créneaux à partir de l'ouverture) ou en plein service
 * (créneaux à partir de maintenant). Dans les deux cas le premier créneau est décalé de
 * `PICKUP_LEAD_MINUTES` — on ne promet jamais un retrait que la cuisine ne peut pas tenir.
 *
 * ⚠️ Ne franchit pas la fenêtre de commande : avant la pré-ouverture rien n'est proposé (le
 * verrou d'ouverture reste entier), et après la dernière commande c'est `getSchedulingOffer`
 * (le lendemain) qui prend le relais. Les deux offres ne coexistent jamais.
 *
 * @returns {{ date:string, weekday:number, weekdayName:string, opensAt:string, closesAt:string,
 *             slots:string[] }|null} null = aucun retrait possible aujourd'hui.
 */
function getTodayPickupOffer(config, now = new Date()) {
  const timezone = config?.timezone || RESTAURANT_TIMEZONE;
  if (config?.onlineOrderingEnabled === false) return null;
  const today = localParts(now, timezone);
  const window = orderingWindow(config, today.weekday, today.date);
  if (!window) return null;
  if (today.minutes < window.orderingStart || today.minutes >= window.lastOrder) return null;

  const earliest = Math.max(today.minutes, window.open) + PICKUP_LEAD_MINUTES;
  const slots = pickupSlots(window).filter((s) => parseTime(s) >= earliest);
  if (!slots.length) return null;

  return {
    date: today.date,
    weekday: today.weekday,
    weekdayName: WEEKDAY_NAMES[today.weekday],
    opensAt: formatTime(window.open),
    closesAt: formatTime(window.close),
    slots,
  };
}

/**
 * Journée sur laquelle une commande programmée peut être prise, depuis un instant donné.
 * @returns {{ date:string, weekday:number, weekdayName:string, opensAt:string, closesAt:string,
 *             slots:string[] }|null} null = aucune programmation proposée.
 */
function getSchedulingOffer(config, now = new Date()) {
  const timezone = config?.timezone || RESTAURANT_TIMEZONE;
  if (config?.onlineOrderingEnabled === false) return null;
  const today = localParts(now, timezone);
  const todayWindow = orderingWindow(config, today.weekday, today.date);
  // Uniquement quand la journée d'aujourd'hui est close : avant l'ouverture, le client
  // n'a qu'à attendre ; un jour fermé ne donne droit à rien (décision validée).
  if (!todayWindow || today.minutes < todayWindow.lastOrder) return null;

  const tomorrow = addDays(today, 1);
  const window = orderingWindow(config, tomorrow.weekday, tomorrow.date);
  if (!window) return null; // demain est fermé → pas de programmation

  return {
    date: tomorrow.date,
    weekday: tomorrow.weekday,
    weekdayName: WEEKDAY_NAMES[tomorrow.weekday],
    opensAt: formatTime(window.open),
    closesAt: formatTime(window.close),
    slots: pickupSlots(window),
  };
}

/**
 * Valide une heure de retrait programmée envoyée par le client.
 * @returns {{ ok:true, pickupAt:Date, date:string, time:string }|{ ok:false, message:string }}
 */
function validateScheduledPickup(config, pickupIso, now = new Date()) {
  // Une seule des deux journées est proposée à la fois : aujourd'hui tant que la fenêtre de
  // commande est ouverte, demain une fois la journée close. Les tester toutes les deux évite
  // d'avoir à deviner ici laquelle le client avait sous les yeux.
  const offers = [getTodayPickupOffer(config, now), getSchedulingOffer(config, now)].filter(Boolean);
  if (!offers.length) {
    return { ok: false, message: "Aucun créneau de retrait n'est disponible actuellement." };
  }
  const pickupAt = new Date(pickupIso);
  if (Number.isNaN(pickupAt.getTime())) {
    return { ok: false, message: 'Heure de retrait invalide.' };
  }
  const timezone = config?.timezone || RESTAURANT_TIMEZONE;
  const p = localParts(pickupAt, timezone);
  const time = formatTime(p.minutes);

  const offer = offers.find((o) => o.date === p.date);
  if (!offer) {
    const jours = offers.map((o) => `${o.weekdayName} ${o.date}`).join(' ou ');
    return { ok: false, message: `Le retrait doit avoir lieu le ${jours}.` };
  }
  if (!offer.slots.includes(time)) {
    return { ok: false, message: `Créneau de retrait indisponible (service de ${humanTime(offer.opensAt)} à ${humanTime(offer.closesAt)}).` };
  }
  return { ok: true, pickupAt, date: offer.date, time };
}

/**
 * Instant auquel une commande programmée doit apparaître en cuisine.
 * On réutilise `lastOrderMargin` : c'est déjà le temps que la cuisine se donne pour
 * sortir une commande (dernière commande à 20h30 pour une fermeture à 21h). Une salade
 * à retirer à 19h n'a donc rien à faire sur l'écran dès midi.
 */
function kitchenReleaseAt(config, pickupAt) {
  const margin = Math.max(0, Number(config?.lastOrderMargin) || 0);
  return new Date(new Date(pickupAt).getTime() - margin * 60000);
}

/** 'lundi' → 'Lundi'. */
function capitalize(word) {
  return String(word || '').charAt(0).toUpperCase() + String(word || '').slice(1);
}

/**
 * Résume la semaine en regroupant les jours consécutifs de même horaire, pour
 * l'affichage (pied de page, écran de réglage). La semaine commence le lundi.
 * @returns {Array<{ days:number[], label:string, open:string|null, close:string|null, closed:boolean }>}
 */
function summarizeWeek(config) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = [];
  for (const d of order) {
    const slot = config?.days?.[d] || null;
    const key = slot ? `${slot.open}-${slot.close}` : 'closed';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(d);
    else groups.push({ key, slot, days: [d] });
  }
  return groups.map((g) => ({
    days: g.days,
    label: g.days.length === 1
      ? capitalize(WEEKDAY_NAMES[g.days[0]])
      : `${capitalize(WEEKDAY_NAMES[g.days[0]])} – ${capitalize(WEEKDAY_NAMES[g.days[g.days.length - 1]])}`,
    open: g.slot ? humanTime(g.slot.open) : null,
    close: g.slot ? humanTime(g.slot.close) : null,
    closed: !g.slot,
  }));
}

module.exports = {
  RESTAURANT_TIMEZONE,
  WEEKDAY_NAMES,
  parseTime,
  formatTime,
  localParts,
  addDays,
  orderingWindow,
  findNextOpening,
  getOnlineOrderingStatus,
  humanTime,
  humanNextOpening,
  closedMessage,
  tzOffsetMinutes,
  zonedToUtc,
  PICKUP_LEAD_MINUTES,
  pickupSlots,
  getTodayPickupOffer,
  getSchedulingOffer,
  validateScheduledPickup,
  kitchenReleaseAt,
  capitalize,
  summarizeWeek,
};
