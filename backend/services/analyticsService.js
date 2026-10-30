// backend/services/analyticsService.js
//
// Toutes les agrégations sont faites en mémoire JS après un unique fetch Firestore
// filtré par timestamp. Cela évite les index composites Firestore (qui nécessitent
// une création manuelle dans la console Firebase).
// Acceptable pour < 100k events/période.

const { activityLogsCol } = require('../models/ActivityLog');

/** Durée de conservation d'un événement d'activité, en jours (voir logActivity).
 *  Douze mois : de quoi comparer une saison à la même saison de l'année d'avant. */
const RETENTION_DAYS = 365;

/** Convertit un Timestamp Firestore, un objet sérialisé ou une Date en ms. */
function toMs(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (val._seconds != null) return val._seconds * 1000;
  if (val.seconds  != null) return val.seconds  * 1000;
  if (val instanceof Date) return val.getTime();
  const d = new Date(val);
  return isNaN(d) ? 0 : d.getTime();
}

class AnalyticsService {

  /**
   * Enregistre une activité utilisateur. Ne bloque jamais l'app.
   *
   * `expiresAt` porte la date de péremption du document, destinée à la règle TTL
   * de Firestore (à activer sur CE champ, jamais sur `timestamp`).
   *
   * ⚠️ Le piège, pour qui reprendrait ceci : une règle TTL supprime le document
   * quand la date que porte le champ visé est atteinte — ce n'est pas un « X jours
   * après création ». L'activer sur `timestamp`, dont la valeur est par nature
   * déjà passée, effacerait la collection entière dès la propagation de la règle.
   * D'où ce champ distinct, qui vaut création + RETENTION_DAYS.
   */
  async logActivity(data) {
    try {
      let ts = data.timestamp ? new Date(data.timestamp) : null;
      if (!ts || isNaN(ts.getTime())) ts = new Date();
      const expiresAt = new Date(ts.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const activityData = { ...data, timestamp: ts, expiresAt };
      const docRef = await activityLogsCol.add(activityData);
      return { id: docRef.id, _id: docRef.id, ...activityData };
    } catch (error) {
      console.error('❌ Erreur log activité:', error);
      return null;
    }
  }

  /**
   * Récupère les activités les plus récentes pour le feed live (historique).
   *
   * ⚠️ Le tri en mémoire a été abandonné : il imposait de télécharger la collection
   * ENTIÈRE pour n'en afficher que `limit` lignes. À 204 000 documents (110 Mo,
   * septembre 2026) une seule ouverture du feed chargeait tout cela dans un conteneur
   * Cloud Run qui dispose de 512 Mio — de quoi le faire redémarrer, et couper la
   * caisse avec lui puisque c'est le même service. Le coût croissait à chaque journée
   * de trafic. Toute évolution ici doit rester bornée côté Firestore, jamais en JS.
   */
  async getRecentActivities({ limit = 100, eventType = null } = {}) {
    const toDocs = snap => snap.docs.map(doc => ({ id: doc.id, _id: doc.id, ...doc.data() }));

    // Sans filtre : tri sur un seul champ, l'index automatique suffit.
    if (!eventType) {
      return toDocs(await activityLogsCol.orderBy('timestamp', 'desc').limit(limit).get());
    }

    // Avec filtre : la paire (eventType, timestamp) réclame un index composite.
    // S'il n'est pas encore créé, Firestore répond FAILED_PRECONDITION (code 9) ;
    // on se rabat alors sur une fenêtre bornée triée par date, filtrée en mémoire.
    // Le repli reste borné — c'est ce qui le distingue de l'ancien comportement.
    try {
      const snap = await activityLogsCol
        .where('eventType', '==', eventType)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
      return toDocs(snap);
    } catch (error) {
      if (error.code !== 9) throw error;
      const snap = await activityLogsCol.orderBy('timestamp', 'desc').limit(limit * 20).get();
      return toDocs(snap).filter(d => d.eventType === eventType).slice(0, limit);
    }
  }

  /**
   * Récupère toutes les stats en temps réel.
   * Un seul fetch Firestore (filtre timestamp uniquement → index auto).
   */
  async getRealtimeStats(timeRange = '24h') {
    const timeAgo = this.getTimeAgo(timeRange);

    // Unique requête Firestore — pas d'index composite requis
    const snap = await activityLogsCol.where('timestamp', '>=', timeAgo).get();
    const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const activeSnap = await activityLogsCol
      .where('timestamp', '>=', new Date(Date.now() - 5 * 60000))
      .get();
    const activeDocs = activeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return {
      activeUsers:            this._activeUsers(activeDocs),
      popularPages:           this._popularPages(docs),
      conversionFunnel:       this._conversionFunnel(docs),
      deviceBreakdown:        this._deviceBreakdown(docs),
      ingredientInteractions: this._ingredientInteractions(docs),
      abandonmentRate:        this._abandonmentRate(docs),
    };
  }

  // ─── Agrégations en mémoire JS ──────────────────────────────────────────────

  _activeUsers(docs) {
    const grouped = {};
    for (const d of docs) {
      const sid = d.sessionId;
      if (!sid) continue;
      if (!grouped[sid]) {
        grouped[sid] = { sessionId: sid, lastActivity: d.timestamp, pageCount: 0, currentPage: null, deviceType: null };
      }
      grouped[sid].pageCount++;
      if (toMs(d.timestamp) > toMs(grouped[sid].lastActivity)) {
        grouped[sid].lastActivity = d.timestamp;
        grouped[sid].currentPage  = d.page?.path || null;
        grouped[sid].deviceType   = d.device?.deviceType || null;
      }
    }
    return Object.values(grouped).sort((a, b) => toMs(b.lastActivity) - toMs(a.lastActivity));
  }

  _popularPages(docs) {
    const views = docs.filter(d => d.eventType === 'page_view');
    const grouped = {};
    for (const d of views) {
      const path = d.page?.path || 'unknown';
      if (!grouped[path]) grouped[path] = { page: path, views: 0, sessions: new Set(), durations: [] };
      grouped[path].views++;
      if (d.sessionId) grouped[path].sessions.add(d.sessionId);
      if (typeof d.duration === 'number') grouped[path].durations.push(d.duration);
    }
    return Object.values(grouped)
      .map(g => ({
        page:        g.page,
        views:       g.views,
        uniqueUsers: g.sessions.size,
        avgDuration: g.durations.length > 0
          ? Math.round(g.durations.reduce((a, b) => a + b, 0) / g.durations.length)
          : 0,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);
  }

  _conversionFunnel(docs) {
    const steps = [
      { name: 'Visites',              eventType: 'page_view'        },
      { name: 'Configurateur ouvert', eventType: 'formula_selected' },
      { name: 'Ingrédient ajouté',    eventType: 'ingredient_added' },
      { name: 'Commande démarrée',    eventType: 'order_started'    },
      { name: 'Commande validée',     eventType: 'order_validated'  },
    ];
    const counts = steps.map(s => ({
      name:  s.name,
      count: docs.filter(d => d.eventType === s.eventType).length,
    }));
    return counts.map((step, i) => ({
      ...step,
      conversionRate: i > 0 && counts[0].count > 0
        ? parseFloat(((step.count / counts[0].count) * 100).toFixed(2))
        : 100,
    }));
  }

  _deviceBreakdown(docs) {
    const views = docs.filter(d => d.eventType === 'page_view');
    const grouped = {};
    for (const d of views) {
      const dt = d.device?.deviceType || 'unknown';
      grouped[dt] = (grouped[dt] || 0) + 1;
    }
    return Object.entries(grouped)
      .map(([deviceType, count]) => ({ deviceType, count }))
      .sort((a, b) => b.count - a.count);
  }

  _ingredientInteractions(docs) {
    const relevant = docs.filter(d =>
      ['ingredient_added', 'ingredient_preview', 'ingredient_removed'].includes(d.eventType)
    );
    const grouped = {};
    for (const d of relevant) {
      const name = d.eventData?.ingredientName || 'inconnu';
      if (!grouped[name]) grouped[name] = { ingredient: name, added: 0, previewed: 0, removed: 0 };
      if (d.eventType === 'ingredient_added')   grouped[name].added++;
      if (d.eventType === 'ingredient_preview') grouped[name].previewed++;
      if (d.eventType === 'ingredient_removed') grouped[name].removed++;
    }
    return Object.values(grouped)
      .map(g => ({
        ...g,
        interestRate: g.previewed === 0
          ? 100
          : parseFloat(((g.added / g.previewed) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.added - a.added)
      .slice(0, 20);
  }

  _abandonmentRate(docs) {
    const started   = docs.filter(d => d.eventType === 'order_started').length;
    const validated = docs.filter(d => d.eventType === 'order_validated').length;
    return {
      started,
      validated,
      abandoned:       started - validated,
      abandonmentRate: started > 0
        ? parseFloat((((started - validated) / started) * 100).toFixed(2))
        : 0,
    };
  }

  // ─── Heatmap (conservée, filtre JS sur page.path) ───────────────────────────

  async getClickHeatmap(page, timeRange = '7d') {
    const timeAgo = this.getTimeAgo(timeRange);
    const snap = await activityLogsCol.where('timestamp', '>=', timeAgo).get();
    const grouped = {};
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.eventType !== 'click_event') continue;
      if (d.page?.path !== page) continue;
      const key = `${d.eventData?.x}|${d.eventData?.y}|${d.eventData?.element}`;
      if (!grouped[key]) {
        grouped[key] = { x: d.eventData?.x, y: d.eventData?.y, element: d.eventData?.element, clicks: 0 };
      }
      grouped[key].clicks++;
    }
    return Object.values(grouped).sort((a, b) => b.clicks - a.clicks).slice(0, 100);
  }

  // ─── Helper ─────────────────────────────────────────────────────────────────

  getTimeAgo(range) {
    const now = new Date();
    switch (range) {
      case '1h':  return new Date(now - 60 * 60 * 1000);
      case '24h': return new Date(now - 24 * 60 * 60 * 1000);
      case '7d':  return new Date(now - 7  * 24 * 60 * 60 * 1000);
      case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000);
      default:    return new Date(now - 24 * 60 * 60 * 1000);
    }
  }
}

module.exports = new AnalyticsService();
