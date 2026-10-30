// src/components/VisualBuilder.jsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PropTypes from 'prop-types';
import Icon from './Icon';

const CAT = {
  base_salade:    { icon: 'vegetable', bg: '#dcfce7', border: '#86efac', label: 'Base' },
  proteine:       { icon: 'meat',      bg: '#ffedd5', border: '#fdba74', label: 'Protéine' },
  topping_legume: { icon: 'vegetable', bg: '#fef3c7', border: '#fcd34d', label: 'Légume' },
  topping_fruit:  { icon: 'fruit',     bg: '#fce7f3', border: '#f9a8d4', label: 'Fruit' },
  sauce:          { icon: 'sauce',     bg: '#fef9c3', border: '#fde047', label: 'Sauce' },
};

const Band = ({ label, minH, bg, items, isLast }) => (
  <div
    className={`flex items-center gap-2 px-3 py-2 ${minH} ${isLast ? '' : 'border-b border-stone-100'}`}
    style={{ background: bg }}
  >
    <span className="text-[9px] font-bold text-stone-400 uppercase w-14 shrink-0 tracking-wider">{label}</span>
    <div className="flex flex-wrap gap-1.5 flex-1">
      <AnimatePresence mode="popLayout">
        {items.length === 0 ? (
          <span className="text-stone-300 text-xs italic">—</span>
        ) : items.map(ing => (
          <motion.div
            key={ing._id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{
              background: CAT[ing.category]?.bg || '#f3f4f6',
              border: `1px solid ${CAT[ing.category]?.border || '#d1d5db'}`,
            }}
          >
            <span><Icon name={CAT[ing.category]?.icon || 'salad'} /></span>
            <span className="truncate max-w-[72px]">{ing.name}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  </div>
);

Band.propTypes = {
  label: PropTypes.string.isRequired,
  minH: PropTypes.string.isRequired,
  bg: PropTypes.string.isRequired,
  items: PropTypes.array.isRequired,
  isLast: PropTypes.bool,
};

const VisualBuilder = ({ ingredients }) => {
  const baseItems     = ingredients.filter(i => i.category === 'base_salade');
  const proteineItems = ingredients.filter(i => i.category === 'proteine');
  const toppingItems  = ingredients.filter(i => i.category === 'topping_legume' || i.category === 'topping_fruit');
  const sauceItems    = ingredients.filter(i => i.category === 'sauce');

  if (ingredients.length === 0) {
    return (
      <div className="w-full max-w-sm mx-auto flex flex-col items-center justify-center py-12">
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          className="text-center"
        >
          <span className="text-5xl"><Icon name="salad" /></span>
          <p className="mt-4 text-stone-400 text-sm font-medium italic">
            Composez votre salade…
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="border-2 border-stone-300 rounded-b-[60px] rounded-t-xl overflow-hidden shadow-xl bg-white">
        {/* Rebord */}
        <div className="bg-stone-200 py-2 px-4 text-xs text-stone-500 font-bold uppercase tracking-widest text-center">
          Votre Salade
        </div>

        {/* Bande Sauce (haut) */}
        <Band label="SAUCE" minH="min-h-[48px]" bg="#fef9c3" items={sauceItems} />
        {/* Bande Toppings */}
        <Band label="TOPPINGS" minH="min-h-[52px]" bg="#fef3c7" items={toppingItems} />
        {/* Bande Protéine */}
        <Band label="PROTÉINE" minH="min-h-[52px]" bg="#ffedd5" items={proteineItems} />
        {/* Bande Base (bas) */}
        <Band label="BASE" minH="min-h-[60px]" bg="#dcfce7" items={baseItems} isLast />
      </div>

      {/* Compteur + légende en dessous */}
      <div className="mt-4 text-center">
        <p className="text-sm text-stone-600">
          {ingredients.length} ingrédient{ingredients.length > 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-2 text-[10px]">
          {Object.entries(CAT).map(([key, v]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: v.bg, border: `1px solid ${v.border}` }}
            >
              <span><Icon name={v.icon} /></span>
              <span className="text-stone-700 font-medium">{v.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

VisualBuilder.propTypes = {
  ingredients: PropTypes.array.isRequired,
};

export default VisualBuilder;
