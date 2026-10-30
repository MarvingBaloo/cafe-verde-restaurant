// frontend/src/components/admin/ListControls.jsx
import React from 'react';
import Icon from '../Icon';

/**
 * Barre de contrôle d'une liste admin : recherche + tri alphabétique.
 * À brancher sur le hook useListControls.
 */
export const ListToolbar = ({ query, setQuery, sortOrder, setSortOrder, total, placeholder = 'Rechercher…', rightSlot }) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
    <div className="relative w-full sm:w-64">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><Icon name="search" /></span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
    </div>
    <select
      value={sortOrder}
      onChange={(e) => setSortOrder(e.target.value)}
      className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400"
    >
      <option value="asc">A / Z</option>
      <option value="desc">Z / A</option>
    </select>
    <span className="flex items-center px-2 text-xs text-gray-400 whitespace-nowrap">
      {total} résultat{total !== 1 ? 's' : ''}
    </span>
    {rightSlot && <div className="sm:ml-auto">{rightSlot}</div>}
  </div>
);

/**
 * Bascule entre vue grille (cartes) et vue tableau (lignes).
 */
export const ViewToggle = ({ view, setView }) => (
  <div className="inline-flex items-center bg-gray-100 rounded-lg p-1">
    <button
      onClick={() => setView('grid')}
      title="Vue grille"
      className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-white shadow text-brand-700' : 'text-gray-400 hover:text-gray-600'}`}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    </button>
    <button
      onClick={() => setView('table')}
      title="Vue tableau"
      className={`p-1.5 rounded-md transition-colors ${view === 'table' ? 'bg-white shadow text-brand-700' : 'text-gray-400 hover:text-gray-600'}`}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  </div>
);

/**
 * Pagination simple : précédent / numéro / suivant.
 */
export const Pagination = ({ page, totalPages, setPage }) => {
  return (
    <div className="flex items-center justify-center gap-3 mt-4">
      <button
        onClick={() => setPage((p) => Math.max(1, p - 1))}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Icon name="arrow-left" /> Précédent
      </button>
      <span className="text-sm text-gray-500 font-medium">
        Page {page} / {totalPages}
      </span>
      <button
        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        disabled={page >= totalPages}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Suivant <Icon name="arrow-right" />
      </button>
    </div>
  );
};
