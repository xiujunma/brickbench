import { useEffect } from 'react';
import { openGivenFile } from '../state/commands';

const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') ?? false;

/**
 * Opens a model file dropped anywhere on the window: a BrickBench, LDraw or
 * Studio file. Part tiles dragged onto the scene are not files, and the
 * scene handles those itself. In the desktop app, this also stops a dropped
 * file from replacing the page.
 */
export function useFileDrop(): void {
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file) void openGivenFile(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
