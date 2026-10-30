// Rend un élément non-natif (div, motion.div) accessible au clavier comme un bouton.
// Usage : <div {...clickable(handler)}>…</div>
export const clickable = (onClick) => ({
  onClick,
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(e);
    }
  },
  role: 'button',
  tabIndex: 0,
});
