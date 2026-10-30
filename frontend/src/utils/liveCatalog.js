// Maintien temps réel des listes de catalogue côté client.
// Quand le gérant désactive un item (isAvailable === false) il est retiré de la
// liste ; quand il le réactive ou le crée, il est (ré)inséré. Quand il le
// supprime, il est retiré. Comparaison sur _id ou id (rétrocompat Firestore).

const idOf = (x) => x._id || x.id;

/** Insère/met à jour un item, ou le retire s'il est désactivé. */
export function upsertAvailable(list, item) {
  const id = idOf(item);
  const without = list.filter(x => idOf(x) !== id);
  if (item.isAvailable === false) return without;
  return [...without, { ...item, _id: id }];
}

/** Retire un item de la liste (accepte l'objet event {id} ou un id brut). */
export function removeFromList(list, idOrItem) {
  const id = typeof idOrItem === 'string' ? idOrItem : idOf(idOrItem);
  return list.filter(x => idOf(x) !== id);
}
