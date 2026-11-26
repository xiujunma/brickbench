import type { Vec3 } from '../core/grid';
import type { Orientation } from '../core/orientation';
import type { History } from '../core/history';
import type { BaseplateSize, ModelDocument, SceneSettings } from '../core/io/modelFile';
import type { Brick, Model } from '../core/model/types';
import type { InstructionPlan, PlanContext, StepRef } from '../core/instructions/plan';
import type { Edited } from '../core/instructions/planEdits';
import type { StepOptions } from '../core/instructions/steps';
import type { Payload } from '../core/placement/payload';

export type Tool = 'select' | 'build' | 'paint' | 'erase';
export type DialogId =
  | 'help'
  | 'about'
  | 'parts-list'
  | 'instructions'
  | 'my-parts'
  | 'timelapse'
  | 'photo'
  | 'import-report'
  | 'account'
  | 'online-models'
  | 'gallery';
export type ToastTone = 'info' | 'success' | 'error';
export type SelectMode = 'replace' | 'add' | 'toggle';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

/** Which of the ways the part being built could plug in where the cursor is the preview shows (`at`, from 0), of how many; or of the places an axle could go to in a hole. */
export interface PlugChoice {
  readonly at: number;
  readonly of: number;
}

export interface EditorData {
  readonly name: string;
  readonly settings: SceneSettings;
  readonly history: History<Model>;
  readonly selection: ReadonlySet<string>;
  readonly tool: Tool;
  readonly activePartId: string;
  readonly activeColorId: number;
  /** How the part to build is turned: spun about its top (R) and tipped over (T). See ../core/orientation. */
  readonly buildRotation: Orientation;
  /** Which of its own connections the part to build plugs in by (C), as its index among them; null for whichever fits best. */
  readonly buildVia: number | null;
  /** How far D has pushed the part to build, an axle, into a hole: which of the places it could go to, from 0, a stud in (see ConnectTurn.deeper). */
  readonly buildDepth: number;
  readonly clipboard: Payload | null;
  /** Copied bricks waiting to be placed with the build tool. */
  readonly pastePayload: Payload | null;
  /** Grid cell under the cursor, for the status bar. */
  readonly cursor: Vec3 | null;
  readonly hoverBrickId: string | null;
  /** Whether the build preview can be placed; null when there is no preview. */
  readonly placementValid: boolean | null;
  /** With the build preview plugged into a connection: which of the ways it could plug in there it shows; null otherwise. */
  readonly plugChoice: PlugChoice | null;
  /** With the build preview an axle in a hole: which of the places it could go to there it shows; null otherwise. */
  readonly depthChoice: PlugChoice | null;
  readonly toasts: readonly Toast[];
  readonly dialog: DialogId | null;
  readonly lastSavedAt: number | null;
  /** The step editor for building instructions, while it is open. */
  readonly stepEditor: StepEditor | null;
}

export interface StepEditor {
  /** The step on show, in the model or one of its sub-assemblies. */
  readonly at: StepRef;
  /** How the steps the user has not arranged are planned. */
  readonly auto: StepOptions;
}

export interface EditorActions {
  setTool(tool: Tool): void;
  setActivePart(partId: string): void;
  /** Sets the paint colour and recolours the selection, if any. */
  setActiveColor(colorId: number): void;
  rotateBuild(dir: 1 | -1): void;
  /** Tips the part to build over a quarter turn about a level world axis; pasted groups stay as they are. */
  tipBuild(axis: 'x' | 'z', dir: 1 | -1): void;
  /** Plugs the part to build in by this one of its own connections (its index among them), or by whichever fits best (null). */
  setBuildVia(via: number | null): void;
  /** Pushes the part to build, an axle, to this one of the places it could go to in a hole, from 0, a stud in. */
  setBuildDepth(depth: number): void;
  /** Places the build payload (active part or paste) at a grid offset. */
  /** Places the build payload (or `turned`, the same turned to meet studs facing another way) at an offset. */
  placePayload(offset: Vec3, turned?: Payload): boolean;
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
  setPlugChoice(choice: PlugChoice | null): void;
  setDepthChoice(choice: PlugChoice | null): void;
  toast(message: string, tone?: ToastTone): void;
  dismissToast(id: number): void;
  openDialog(dialog: DialogId): void;
  /** Closes the open dialog; with an id, only if that dialog is the one open. */
  closeDialog(dialog?: DialogId): void;
  markSaved(at: number): void;
  /** Opens the step editor at the first step; steps not arranged yet are planned with `auto`. */
  editSteps(auto?: StepOptions): void;
  closeSteps(): void;
  goToStep(at: StepRef): void;
  /** Changes the plan as it stands, as one step to undo, and goes to the step the edit names. */
  editPlan(edit: (plan: InstructionPlan, context: PlanContext) => Edited): void;
}

export type EditorState = EditorData & EditorActions;
