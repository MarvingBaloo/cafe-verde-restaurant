import Icon from '../Icon';

const VARIANTS = {
  success: { bg: 'bg-brand-500', icon: 'check'   },
  error:   { bg: 'bg-cherry',    icon: 'cancel'  },
  warning: { bg: 'bg-honey',     icon: 'warning' },
  info:    { bg: 'bg-blue-500',  icon: 'info'    },
};

const ToastItem = ({ toast, onDismiss }) => {
  const { bg, icon } = VARIANTS[toast.variant] || VARIANTS.info;
  return (
    <div className={`flex items-start gap-3 px-5 py-4 rounded-2xl shadow-xl text-white max-w-sm w-full animate-fadeIn ${bg}`}>
      <span className="text-xl flex-shrink-0 leading-none mt-0.5"><Icon name={icon} /></span>
      <p className="text-sm font-medium flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-white/70 hover:text-white transition-colors text-lg leading-none flex-shrink-0 mt-0.5"
        aria-label="Fermer"
      >
        <Icon name="close" />
      </button>
    </div>
  );
};

const ToastContainer = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 items-end pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
