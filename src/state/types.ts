import type { Rotation, Vec3 } from '../core/grid';
import type { History } from '../core/history';
import type { BaseplateSize, ModelDocument, SceneSettings } from '../core/io/modelFile';
import type { Brick, Model } from '../core/model/types';
import type { Payload } from '../core/placement/payload';

export type Tool = 'select' | 'build' | 'paint' | 'erase';
export type DialogId = 'help' | 'about' | 'parts-list' | 'instructions' | 'my-parts' | 'timelapse' | 'import-report';
export type ToastTone = 'info' | 'success' | 'error';
export type SelectMode = 'replace' | 'add' | 'toggle';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

export interface EditorData {
  readonly name: string;
  readonly settings: SceneSettings;
  readonly history: History<Model>;
  readonly selection: ReadonlySet<string>;
  readonly tool: Tool;
  readonly activePartId: string;
  readonly activeColorId: number;
  readonly buildRotation: Rotation;
  readonly clipboard: Payload | null;
  /** Copied bricks waiting to be placed with the build tool. */
  readonly pastePayload: Payload | null;
  /** Grid cell under the cursor, for the status bar. */
  readonly cursor: Vec3 | null;
  readonly hoverBrickId: string | null;
  /** Whether the build preview can be placed; null when there is no preview. */
  readonly placementValid: boolean | null;
  readonly toasts: readonly Toast[];
  readonly dialog: DialogId | null;
  readonly lastSavedAt: number | null;
}

export interface EditorActions {
  setTool(tool: Tool): void;
  setActivePart(partId: string): void;
  /** Sets the paint colour and recolours the selection, if any. */
  setActiveColor(colorId: number): void;
  rotateBuild(dir: 1 | -1): void;
  /** Places the build payload (active part or paste) at a grid offset. */
  placePayload(offset: Vec3): boolean;
  select(ids: readonly string[], mode: SelectMode): void;
  clearSelection(): void;
  selectAll(): void;
  deleteSelection(): void;
  eraseBrick(id: string): void;
  paintBrick(id: string): void;
  /** Picks up a brick's part, colour and rotation for building. */
  eyedrop(id: string): void;
  moveSelection(delta: Vec3): boolean;
  rotateSelection(dir: 1 | -1): boolean;
  /** Commits moved bricks (same ids, new positions) if they fit. */
  applyBricks(bricks: readonly Brick[]): boolean;
  copySelection(): boolean;
  cutSelection(): boolean;
  paste(): boolean;
  duplicateSelection(): boolean;
  undo(): void;
  redo(): void;
  /** Records a whole new model as one step to undo, as an agent's change is. */
  commitModel(next: Model): void;
  /** Folds the steps since `snapshot` into one, so one undo goes back to it. */
  squashHistorySince(snapshot: Model): void;
  newModel(): void;
  loadDocument(doc: ModelDocument): void;
  setName(name: string): void;
  setBaseplate(size: BaseplateSize, colorId: number): void;
  setCursor(cursor: Vec3 | null): void;
  setHover(brickId: string | null): void;
  setPlacementValid(valid: boolean | null): void;
  toast(message: string, tone?: ToastTone): void;
  dismissToast(id: number): void;
  openDialog(dialog: DialogId): void;
  /** Closes the open dialog; with an id, only if that dialog is the one open. */
  closeDialog(dialog?: DialogId): void;
  markSaved(at: number): void;
}

export type EditorState = EditorData & EditorActions;
