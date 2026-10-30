import Icon from '../Icon';

const VARIANTS = {
  danger:  { confirmBg: 'bg-cherry hover:bg-cherry/90',         icon: 'trash'   },
  warning: { confirmBg: 'bg-honey hover:bg-honey/90',           icon: 'warning' },
  info:    { confirmBg: 'bg-brand-600 hover:bg-brand-700',      icon: 'info'    },
};

const ConfirmModal = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  variant = 'danger',
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
}) => {
  if (!isOpen) return null;

  const { confirmBg, icon } = VARIANTS[variant] || VARIANTS.danger;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Card */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md animate-in fade-in-50 zoom-in-90 duration-300">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-2xl"><Icon name={icon} /></span>
          <h2 className="gelasio font-bold text-xl text-gray-900">{title}</h2>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-gray-600 leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-6 py-3 bg-gray-100 text-gray-700 rounded-full font-bold hover:bg-gray-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-6 py-3 text-white rounded-full font-bold transition-colors ${confirmBg}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
