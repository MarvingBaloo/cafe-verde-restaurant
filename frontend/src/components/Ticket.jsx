import React from 'react';
import { MERCHANT } from '../utils/merchant';

// Ticket de caisse format ~80 mm. Styles inline volontaires : fidélité d'impression
// garantie même si Tailwind purge des classes non utilisées à l'écran.

const fmt = n => `${Number(n || 0).toFixed(2)} €`;

export default function Ticket({
  subheading,
  createdAt,
  customerName,
  pickupLabel = null,
  lines = [],
  total,
  totalLabel = 'Total',
  paymentLines = [],
  extraTitle,
  extraLines = [],
  tax = null,
  // Conservée volontairement : l'affichage du « service compris » est désactivé côté
  // Espace Gérant (le taux reste stocké). Retirer cette prop casserait sa réactivation.
  // eslint-disable-next-line no-unused-vars
  serviceRate = 0,
}) {
  const d = createdAt ? new Date(createdAt) : new Date();
  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#000', width: '72mm', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '6px' }}>
        <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{MERCHANT.name}</div>
        {MERCHANT.addressLines.map((l, i) => <div key={i}>{l}</div>)}
        <div>{MERCHANT.website}</div>
        <div>{MERCHANT.phone}</div>
        {subheading && <div>{subheading}</div>}
        <div>{d.toLocaleString('fr-FR', { timeZone: 'America/Guadeloupe' })}</div>
        {customerName && <div>{customerName}</div>}
        {pickupLabel && <div style={{ fontWeight: 'bold', marginTop: '2px' }}>{pickupLabel}</div>}
      </div>

      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '4px 0' }}>
        {lines.length === 0 ? (
          <div style={{ textAlign: 'center' }}>Quote-part de la commande</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} style={{ marginBottom: '2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{l.label}</span>
                {l.price != null && <span>{fmt(l.price)}</span>}
              </div>
              {l.details && <div style={{ fontSize: '10px', color: '#333' }}>{l.details}</div>}
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', padding: '4px 0' }}>
        <span>{totalLabel}</span>
        <span>{fmt(total)}</span>
      </div>

      {tax && tax.totalTVA > 0 && (
        <div style={{ borderTop: '1px dashed #000', padding: '4px 0', fontSize: '11px' }}>
          {tax.consumptionMode && (
            <div style={{ marginBottom: '2px' }}>{tax.consumptionMode === 'takeaway' ? 'À emporter' : 'Sur place'}</div>
          )}
          {(tax.breakdown || []).map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>TVA {t.rate}% (HT {fmt(t.baseHT)})</span>
              <span>{fmt(t.tva)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
            <span>Total TVA</span>
            <span>{fmt(tax.totalTVA)}</span>
          </div>
        </div>
      )}

      {paymentLines.map((p, i) => (
        <div key={i}>{p}</div>
      ))}

      {extraTitle && (
        <div style={{ marginTop: '6px', borderTop: '1px dashed #000', paddingTop: '4px' }}>
          <div style={{ fontWeight: 'bold' }}>{extraTitle}</div>
          {extraLines.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{e.label}</span>
              <span>{e.value}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '10px', color: '#333', borderTop: '1px dashed #000', paddingTop: '4px' }}>
        <div>Service compris</div>
        <div>SIRET : {MERCHANT.siret}</div>
        <div>TVA intracommunautaire : {MERCHANT.vat}</div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '8px' }}>Merci de votre visite !</div>
    </div>
  );
}
