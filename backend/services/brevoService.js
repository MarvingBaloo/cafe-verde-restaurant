// backend/services/brevoService.js
// Envoi transactionnel email + SMS via l'API HTTP Brevo (sans SDK, fetch natif Node 18+).
// Clé et expéditeurs configurés par variables d'environnement.

const BREVO_API = 'https://api.brevo.com/v3';

function getApiKey() {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error('BREVO_API_KEY manquante : configurez la clé API Brevo.');
  return key;
}

async function brevoPost(path, payload) {
  const res = await fetch(`${BREVO_API}${path}`, {
    method: 'POST',
    headers: {
      'api-key': getApiKey(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo ${path} → ${res.status} ${detail}`);
  }
  return res.json().catch(() => ({}));
}

async function sendEmail({ to, toName, subject, html }) {
  return brevoPost('/smtp/email', {
    sender: {
      email: process.env.BREVO_SENDER_EMAIL || 'contact@cafeverde.gp',
      name: process.env.BREVO_SENDER_NAME || 'Café Verdé',
    },
    to: [toName ? { email: to, name: toName } : { email: to }],
    subject,
    htmlContent: html,
  });
}

async function sendSms({ to, content }) {
  return brevoPost('/transactionalSMS/sms', {
    sender: process.env.BREVO_SMS_SENDER || 'CafeVerde',
    recipient: to, // E.164 SANS le '+' (ex: 590690000000)
    content,
    type: 'transactional',
  });
}

module.exports = { sendEmail, sendSms };
