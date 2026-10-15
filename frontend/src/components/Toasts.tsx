export interface ToastItem {
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Props {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export default function Toasts({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.text}</span>
          {t.actionLabel && t.onAction && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                t.onAction?.();
                onDismiss(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
