import { createPortal } from 'react-dom';

// Rend le ticket hors de #root (directement sous <body>) pour qu'à l'impression
// la hauteur du document = celle du ticket uniquement. Évite les pages blanches
// quand la page applicative est plus haute qu'une feuille. Masqué à l'écran via .print-only.
export default function PrintArea({ children }) {
  return createPortal(
    <div className="print-only print-area">{children}</div>,
    document.body,
  );
}
