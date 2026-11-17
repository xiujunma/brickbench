import { editorStore } from './editorStore';

/** Asks before another model replaces the one being built; true straight away when that one is empty. */
export function confirmReplace(prompt: string): boolean {
  return (
    editorStore.getState().history.present.bricks.size === 0 ||
    window.confirm(`${prompt} The current model will be replaced (save it first if you want to keep it).`)
  );
}
