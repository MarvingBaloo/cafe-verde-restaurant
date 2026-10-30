import React from 'react';
import { MERCHANT } from '../utils/merchant';

// Facture au format rouleau ~80 mm (même imprimante que le ticket de caisse).
// Styles inline volontaires, pour la même raison que `Ticket.jsx` : l'impression ne
// doit pas dépendre des classes Tailwind conservées après purge.
//
// Ce composant ne calcule RIEN : il rend les props produites par `utils/invoice.js`
// → `orderToInvoice`, qui dérivent elles-mêmes du ticket. Toute évolution des montants
// se fait là-bas, jamais ici.

const fmt = (n) => `${Number(n || 0).toFixed(2)} €`;
const TZ = { timeZone: 'America/Guadeloupe' };
const dateOnly = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', TZ) : '—');
const dateTime = (d) => (d ? new Date(d).toLocaleString('fr-FR', TZ) : '—');

const Row = ({ label, value, bold = false, size }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 'bold' : 'normal', fontSize: size }}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

export default function Invoice({
  number,
  orderRef,
  issuedAt,
  serviceDate,
  paid = false,
  paidAt = null,
  lines = [],
  total = 0,
  tax = null,
  paymentLines = [],
  customerName,
  billing = {},
  refundedAmount = 0,
}) {
  // Une facture sans identité d'acheteur n'est acceptable que sur les petits montants :
  // on affiche le bloc dès qu'on a quelque chose, à défaut le nom porté par la commande.
  const billName = (billing.name || '').trim() || customerName || '';
  const hasBillingDetails = [billing.address, billing.zipCity, billing.siret, billing.vat]
    .some((v) => (v || '').trim());

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#000', width: '72mm', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '6px' }}>
        <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px' }}>FACTURE</div>
        <div style={{ fontWeight: 'bold' }}>N° {number}</div>
      </div>

      {/* Émetteur */}
      <div style={{ borderTop: '1px dashed #000', paddingTop: '4px', marginBottom: '4px' }}>
        <div style={{ fontWeight: 'bold' }}>{MERCHANT.name}</div>
        {MERCHANT.addressLines.map((l, i) => <div key={i}>{l}</div>)}
        <div>{MERCHANT.phone} · {MERCHANT.website}</div>
        <div>SIRET : {MERCHANT.siret}</div>
        <div>TVA intracom. : {MERCHANT.vat}</div>
      </div>

      {/* Acheteur */}
      {(billName || hasBillingDetails) && (
        <div style={{ borderTop: '1px dashed #000', paddingTop: '4px', marginBottom: '4px' }}>
          <div style={{ fontWeight: 'bold' }}>Facturé à</div>
          {billName && <div>{billName}</div>}
          {billing.address && <div>{billing.address}</div>}
          {billing.zipCity && <div>{billing.zipCity}</div>}
          {billing.siret && <div>SIRET : {billing.siret}</div>}
          {billing.vat && <div>TVA intracom. : {billing.vat}</div>}
        </div>
      )}

      <div style={{ borderTop: '1px dashed #000', paddingTop: '4px', marginBottom: '4px' }}>
        <Row label="Date d'émission" value={dateOnly(issuedAt)} />
        <Row label="Date de la prestation" value={dateOnly(serviceDate)} />
        {orderRef && <Row label="Commande" value={orderRef} />}
      </div>

      {/* Désignation */}
      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '4px 0' }}>
        {lines.map((l, i) => (
          <div key={l.key ?? i} style={{ marginBottom: '2px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{l.label}</span>
              {l.price != null && <span>{fmt(l.price)}</span>}
            </div>
            {l.details && <div style={{ fontSize: '10px', color: '#333' }}>{l.details}</div>}
          </div>
        ))}
      </div>

      {/* Totaux — le HT est mis en avant, contrairement au ticket de caisse */}
      <div style={{ padding: '4px 0' }}>
        {tax && tax.totalTVA > 0 && (
          <>
            {tax.consumptionMode && (
              <div style={{ marginBottom: '2px' }}>{tax.consumptionMode === 'takeaway' ? 'À emporter' : 'Sur place'}</div>
            )}
            <Row label="Total HT" value={fmt(tax.totalHT)} />
            {(tax.breakdown || []).map((t, i) => (
              <Row key={i} label={`TVA ${t.rate}% (HT ${fmt(t.baseHT)})`} value={fmt(t.tva)} size="11px" />
            ))}
            <Row label="Total TVA" value={fmt(tax.totalTVA)} />
          </>
        )}
        <div style={{ marginTop: '2px', paddingTop: '2px', borderTop: '1px solid #000' }}>
          <Row label="TOTAL TTC" value={fmt(total)} bold size="14px" />
        </div>
      </div>

      {/* Règlement */}
      <div style={{ borderTop: '1px dashed #000', paddingTop: '4px' }}>
        {paymentLines.map((p, i) => <div key={i}>{p}</div>)}
        <div style={{ fontWeight: 'bold', marginTop: '2px' }}>
          {paid
            ? `Facture acquittée${paidAt ? ` le ${dateTime(paidAt)}` : ''}`
            : 'Facture non acquittée — restant dû ' + fmt(total)}
        </div>
      </div>

      {refundedAmount > 0 && (
        <div style={{ borderTop: '1px dashed #000', paddingTop: '4px' }}>
          <Row label="Remboursé" value={fmt(refundedAmount)} bold />
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '10px', color: '#333', borderTop: '1px dashed #000', paddingTop: '4px' }}>
        <div>Service compris</div>
        <div>TVA acquittée sur les encaissements</div>
      </div>
    </div>
  );
}
