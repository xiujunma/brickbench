/**
 * File › Copy share link, and opening the links: the model travels in the
 * link itself (src/core/io/shareLink.ts), so no server keeps it.
 */
import { serializeDocument } from '../core/io/modelFile';
import { MAX_LINK_LENGTH, readShareFragment, shareFragment } from '../core/io/shareLink';
import { desktopApi } from '../desktop/protocol';
import { parseModelText, showDocument } from './commands';
import { confirmReplace } from './confirmReplace';
import { editorStore } from './editorStore';

/** Where share links point: this page, on the web. The desktop app has no address anyone else can open. */
export function shareBase(): string | null {
  if (desktopApi() !== null || typeof location === 'undefined') return null;
  return `${location.origin}${location.pathname}`;
}

/** Copies a link that carries the model, unless it is empty or too big for a link. */
export async function copyShareLink(): Promise<void> {
  const { name, history, settings, toast } = editorStore.getState();
  const base = shareBase();
  if (base === null) {
    toast('Share links come from BrickBench on the web. To send this model, save it to a file.', 'info');
    return;
  }
  if (history.present.bricks.size === 0) {
    toast('The model is empty: build something to share first.', 'info');
    return;
  }
  const link = `${base}${await shareFragment(serializeDocument({ name, model: history.present, settings }))}`;
  if (link.length > MAX_LINK_LENGTH) {
    toast(`This model is too big for a link (${link.length.toLocaleString('en')} characters). Send its file instead: File › Save to file.`, 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied. Anyone who opens it gets their own copy of this model.', 'success');
  } catch {
    toast('The link could not be copied: the browser did not allow it.', 'error');
  }
}

/** Opens the model a share link in the address carries, then takes the link out, so a reload keeps the model as edited. */
export async function openSharedModel(): Promise<void> {
  const read = await readShareFragment(location.hash);
  if (read === null) return;
  window.history.replaceState(null, '', `${location.pathname}${location.search}`);
  const { toast } = editorStore.getState();
  if (!read.ok) {
    toast(read.error, 'error');
    return;
  }
  const result = await parseModelText(read.value);
  if (!result.ok) {
    toast(`The shared model could not be opened: ${result.error}`, 'error');
    return;
  }
  if (!confirmReplace(`Open the shared model “${result.value.doc.name}”?`)) return;
  showDocument(result.value, `Opened the shared model “${result.value.doc.name}”.`);
}

/** Opens a share link the page starts with, and any pasted into the address bar later. */
export function startShareLinks(target: Pick<Window, 'addEventListener'>): void {
  void openSharedModel();
  target.addEventListener('hashchange', () => void openSharedModel());
}
