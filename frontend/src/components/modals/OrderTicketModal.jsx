// Modale « Détail du ticket » réutilisable (Espace Gérant + Espace DEV).
// Reconstruit le ticket depuis une commande Firestore via orderToTicket.
import React, { useState } from 'react';
import Ticket from '../Ticket';
import PrintArea from '../PrintArea';
import Icon from '../Icon';
import SendReceiptModal from './SendReceiptModal';
import { orderToTicket, partToTicket, orderParts } from '../../utils/orderTicket';

const OrderTicketModal = ({ order, onClose }) => {
  // Part sélectionnée sur une addition séparée : permet de rééditer le justificatif d'un
  // convive longtemps après le service (il l'a perdu, il le réclame pour sa note de frais).
  const [partIndex, setPartIndex] = useState(null);
  const [sendChannel, setSendChannel] = useState(null); // envoi du justificatif d'une part
  if (!order) return null;
  const parts = orderParts(order);
  const part = parts.find(p => p.index === partIndex) || null;
  const ticketProps = part ? partToTicket(order, part) : orderToTicket(order);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="text-lg font-bold text-gray-800">
              {part ? `Justificatif — part ${part.index}` : 'Détail du ticket'}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <Icon name="close" className="w-5 h-5 inline" />
            </button>
          </div>
          {parts.length > 1 && (
            <div className="px-4 pt-3 flex flex-wrap gap-1.5">
              <button onClick={() => setPartIndex(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${partIndex === null ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                Note complète
              </button>
              {parts.map(p => (
                <button key={p.index} onClick={() => setPartIndex(p.index)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${partIndex === p.index ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  Part {p.index}{p.userName ? ` · ${p.userName}` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="p-4 bg-gray-50">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <Ticket {...ticketProps} />
            </div>
          </div>
          <div className="flex gap-2 p-4 border-t border-gray-100">
            <button
              onClick={() => window.print()}
              className="flex-1 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg font-semibold inline-flex items-center justify-center gap-2 transition"
            >
              <Icon name="print" /> Imprimer
            </button>
            {part && (
              <>
                <button
                  onClick={() => setSendChannel('email')}
                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition inline-flex items-center gap-1.5"
                >
                  <Icon name="mail" /> Email
                </button>
                <button
                  onClick={() => setSendChannel('sms')}
                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition inline-flex items-center gap-1.5"
                >
                  <Icon name="sms" /> SMS
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold transition"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
      {sendChannel && part && (
        <SendReceiptModal
          orderId={order._id || order.id}
          channel={sendChannel}
          partIndex={part.index}
          onClose={() => setSendChannel(null)}
        />
      )}

      {/* Zone d'impression hors #root : seule à s'imprimer */}
      <PrintArea>
        <Ticket {...ticketProps} />
      </PrintArea>
    </>
  );
};

export default OrderTicketModal;
