import { useEffect } from 'react';
import { isTypingTarget } from '../editor/keyboard';
import { openModelFile, saveModelFile } from '../state/commands';
import { editorStore } from '../state/editorStore';
import { PART_SEARCH_ID } from './focusTargets';

/** App-level shortcuts: files, help and part search. Scene shortcuts live with the editor. */
export function useAppShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 's') {
        event.preventDefault();
        saveModelFile();
        return;
      }
      if (modifier && key === 'o') {
        event.preventDefault();
        void openModelFile();
        return;
      }
      // help and search would close (and abort) whatever dialog is open
      if (modifier || isTypingTarget(event.target) || editorStore.getState().dialog !== null) return;
      if (event.key === '?') {
        event.preventDefault();
        editorStore.getState().openDialog('help');
      } else if (event.key === '/') {
        const search = document.getElementById(PART_SEARCH_ID);
        if (search instanceof HTMLInputElement) {
          event.preventDefault();
          search.focus();
          // a new search replaces the last one instead of adding to it
          search.select();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
