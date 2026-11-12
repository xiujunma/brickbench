import { useEffect } from 'react';
import { useEditor } from '../../state/editorStore';
import type { Toast } from '../../state/types';
import { afterVisibleTime } from '../visibleTimer';

const DURATION_MS = { info: 3500, success: 3000, error: 6500 } as const;

type ItemProps = {
  readonly toast: Toast;
  readonly onDone: (id: number) => void;
};

function ToastItem({ toast, onDone }: ItemProps) {
  // counted while the page is on screen and responsive: a toast posted while
  // the page is busy starting the 3D view must still be there to read after
  useEffect(() => afterVisibleTime(DURATION_MS[toast.tone], () => onDone(toast.id)), [toast.id, toast.tone, onDone]);

  return (
    <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span>{toast.message}</span>
      <button type="button" aria-label="Dismiss" onClick={() => onDone(toast.id)}>
        ×
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDone={dismiss} />
      ))}
    </div>
  );
}
