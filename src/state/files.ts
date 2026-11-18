import { desktopApi } from '../desktop/protocol';
import type { ToastTone } from './types';

type Toast = (message: string, tone: ToastTone) => void;

/** Hands a file to the browser's download flow. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Saves a file, and says so. A browser puts it in the downloads at once, so
 * `message` shows now. The desktop app asks where to save it, and says where
 * it went once its Save dialog is done (see src/app/desktop.ts), so there
 * `message` would be wrong and stays unsaid.
 */
export function saveBlob(blob: Blob, filename: string, message: string, toast: Toast): void {
  downloadBlob(blob, filename);
  if (desktopApi() === null) toast(message, 'success');
}

export function saveText(text: string, filename: string, type: string, message: string, toast: Toast): void {
  saveBlob(new Blob([text], { type }), filename, message, toast);
}

/** Opens the system file picker; resolves null when the user cancels. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
