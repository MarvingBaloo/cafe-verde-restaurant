// frontend/src/hooks/useListControls.js
import { useState, useMemo, useEffect } from 'react';

/**
 * Recherche + tri alphabétique + pagination pour une liste.
 *
 * @param {Array}  items                 La liste source.
 * @param {Object} options
 * @param {Function} options.getName     Accesseur du libellé recherché/trié (défaut : i => i.name).
 * @param {number}   options.pageSize    Éléments par page (défaut : 24).
 *
 * @returns {{
 *   query: string, setQuery: Function,
 *   sortOrder: 'asc'|'desc', setSortOrder: Function,
 *   page: number, setPage: Function, totalPages: number, total: number,
 *   pageItems: Array
 * }}
 */
export function useListControls(items, { getName = (i) => i?.name, pageSize = 24 } = {}) {
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' = A→Z, 'desc' = Z→A
  const [page, setPage] = useState(1);

  // Revenir à la première page quand la recherche ou le tri change
  useEffect(() => { setPage(1); }, [query, sortOrder]);

  const filtered = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    const q = query.trim().toLowerCase();
    const searched = q
      ? list.filter((it) => (getName(it) || '').toLowerCase().includes(q))
      : list;
    return [...searched].sort((a, b) => {
      const an = (getName(a) || '').toLowerCase();
      const bn = (getName(b) || '').toLowerCase();
      return sortOrder === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, sortOrder]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    query, setQuery,
    sortOrder, setSortOrder,
    page: safePage, setPage, totalPages, total,
    pageItems,
  };
}
