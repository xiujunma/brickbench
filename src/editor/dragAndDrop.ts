import type { EditorController } from './EditorController';

/** Drag data type for parts dragged out of the library. */
export const PART_DRAG_TYPE = 'application/x-brickbench-part';

function carriesPart(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(PART_DRAG_TYPE) ?? false;
}

/**
 * Lets parts be dragged from the library onto the scene: the build preview
 * follows the drag and the part lands where it is dropped.
 */
export function attachPartDrop(container: HTMLElement, host: EditorController): () => void {
  const onOver = (event: DragEvent): void => {
    if (!carriesPart(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    host.updatePointer(event.clientX, event.clientY);
  };
  const onLeave = (event: DragEvent): void => {
    if (carriesPart(event)) host.pointerLeft();
  };
  const onDrop = (event: DragEvent): void => {
    if (!carriesPart(event)) return;
    event.preventDefault();
    host.buildAt(event.clientX, event.clientY);
    host.updatePointer(event.clientX, event.clientY);
  };
  container.addEventListener('dragover', onOver);
  container.addEventListener('dragleave', onLeave);
  container.addEventListener('drop', onDrop);
  return () => {
    container.removeEventListener('dragover', onOver);
    container.removeEventListener('dragleave', onLeave);
    container.removeEventListener('drop', onDrop);
  };
}
