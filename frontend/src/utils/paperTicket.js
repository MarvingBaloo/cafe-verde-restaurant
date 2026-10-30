/** Tickets resto papier remis : au moins le dû, l'excédent n'est jamais rendu. */
export const paperTicketOk = (value, due) => value !== '' && (parseFloat(value) || 0) >= due - 0.001;
