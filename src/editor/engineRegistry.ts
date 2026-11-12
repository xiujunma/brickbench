import type { EditorController } from './EditorController';

let active: EditorController | null = null;

/** The mounted 3D editor, for commands that need the scene (exports, framing). */
export function getEngine(): EditorController | null {
  return active;
}

export function setEngine(controller: EditorController | null): void {
  active = controller;
}
