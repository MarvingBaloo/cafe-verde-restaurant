// frontend/src/components/CartModal.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../context/ConfigContext';

const QtyControl = ({ quantity, onMinus, onPlus }) => (
  <div className="flex items-center gap-2">
    <button onClick={onMinus}
      className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors">−</button>
    <span className="font-mono font-bold w-6 text-center">{quantity}</span>
    <button onClick={onPlus}
      className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors">+</button>
  </div>
);

const CartModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const {
    order, totalPrice,
    incrementFormula, decrementFormula,
    incrementDish, decrementDish,
    incrementBubbleTea, decrementBubbleTea,
    incrementMilkshake, decrementMilkshake,
    incrementProductInCart, decrementProductInCart, removeProductFromCart,
  } = useConfig();

  if (!isOpen) return null;

  const hasFormula = !!order.formula;
  const dishes = order.dishes || [];
  const bubbleTeas = order.bubbleTeas || [];
  const milkshakes = order.milkshakes || [];
  const cartProducts = order.cartProducts || [];
  const isEmpty = !hasFormula && dishes.length === 0 && bubbleTeas.length === 0 && milkshakes.length === 0 && cartProducts.length === 0;

  const saladeUnit = hasFormula
    ? order.formula.base_price + (order.ingredients || []).reduce((s, i) => s + (i.extra_price || 0), 0)
    : 0;

  const goToSummary = () => { onClose(); navigate('/summary'); };
  const goToConfigurator = () => { onClose(); navigate('/configurator'); };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col animate-[slideInRight_0.25s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-xl gelasio font-bold text-gray-900">Mon panier</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isEmpty && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-lg font-medium">Votre panier est vide</p>
              <p className="text-sm mt-1">Ajoutez une salade, un plat ou un produit.</p>
            </div>
          )}

          {/* Salade */}
          {hasFormula && (
            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{order.formula.name}</p>
                  <p className="text-xs text-gray-500">
                    {(order.ingredients || []).length} ingrédient{(order.ingredients || []).length !== 1 ? 's' : ''}
                    {order.menu && order.menu.name !== 'Solo' ? ` • Menu ${order.menu.name}` : ''}
                  </p>
                  <button onClick={goToConfigurator} className="text-xs text-brand-600 hover:text-brand-800 mt-1 font-semibold">
                    Modifier
                  </button>
                </div>
                <span className="font-mono font-bold">{(saladeUnit * (order.formulaQuantity || 1)).toFixed(2)}€</span>
              </div>
              <QtyControl quantity={order.formulaQuantity || 1} onMinus={decrementFormula} onPlus={incrementFormula} />
            </div>
          )}

          {/* Plats chauds */}
          {dishes.map((d, i) => (
            <div key={i} className="border border-gray-100 rounded-xl p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{d.name}</p>
                  {d.selectedSides?.length > 0 && (
                    <p className="text-xs text-gray-500">+ {d.selectedSides.map(s => s.name).join(', ')}</p>
                  )}
                  {d.menu?.name && d.menu.name !== 'Solo' && d.menu.name !== 'Sans Menu' && (
                    <p className="text-xs text-brand-600 font-medium">
                      Menu {d.menu.name}{d.menuProducts?.length ? ` • ${d.menuProducts.map(p => p.name).join(', ')}` : ''}
                    </p>
                  )}
                </div>
                <span className="font-mono font-bold">{((d.subtotal || 0) * (d.quantity || 1)).toFixed(2)}€</span>
              </div>
              <QtyControl quantity={d.quantity || 1} onMinus={() => decrementDish(i)} onPlus={() => incrementDish(i)} />
            </div>
          ))}

          {/* Bubble teas */}
          {bubbleTeas.map((b, i) => (
            <div key={i} className="border border-gray-100 rounded-xl p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{b.name}</p>
                  {b.selections?.length > 0 && (
                    <p className="text-xs text-gray-500">
                      {b.selections.map(s => s.name).join(', ')}
                    </p>
                  )}
                </div>
                <span className="font-mono font-bold">{((b.subtotal || 0) * (b.quantity || 1)).toFixed(2)}€</span>
              </div>
              <QtyControl quantity={b.quantity || 1} onMinus={() => decrementBubbleTea(i)} onPlus={() => incrementBubbleTea(i)} />
            </div>
          ))}

          {/* Milkshakes */}
          {milkshakes.map((m, i) => (
            <div key={i} className="border border-gray-100 rounded-xl p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{m.name}</p>
                  {m.selections?.length > 0 && (
                    <p className="text-xs text-gray-500">
                      {m.selections.map(s => s.name).join(', ')}
                    </p>
                  )}
                </div>
                <span className="font-mono font-bold">{((m.subtotal || 0) * (m.quantity || 1)).toFixed(2)}€</span>
              </div>
              <QtyControl quantity={m.quantity || 1} onMinus={() => decrementMilkshake(i)} onPlus={() => incrementMilkshake(i)} />
            </div>
          ))}

          {/* Produits à l'unité */}
          {cartProducts.map((p) => (
            <div key={p.lineId || p._id} className="border border-gray-100 rounded-xl p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{p.name}</p>
                  {(p.selectedExtras || []).length > 0 && (
                    <p className="text-xs text-stone-500">
                      + {p.selectedExtras.map(e => e.name).join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">{p.price.toFixed(2)}€ l'unité</p>
                  <button onClick={() => removeProductFromCart(p.lineId)} className="text-xs text-stone-400 hover:text-cherry mt-1">
                    Retirer
                  </button>
                </div>
                <span className="font-mono font-bold">{(p.price * p.quantity).toFixed(2)}€</span>
              </div>
              <QtyControl quantity={p.quantity} onMinus={() => decrementProductInCart(p.lineId)} onPlus={() => incrementProductInCart(p.lineId)} />
            </div>
          ))}
        </div>

        {/* Footer */}
        {!isEmpty && (
          <div className="border-t border-gray-100 px-6 py-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">Total</span>
              <span className="text-2xl font-extrabold text-brand-600">{totalPrice.toFixed(2)} €</span>
            </div>
            <button onClick={goToSummary}
              className="w-full py-4 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 transition-colors">
              Finaliser ma commande
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CartModal;
