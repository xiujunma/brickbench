import type { StoreApi } from 'zustand/vanilla';
import { isOpaqueColor } from '../core/colors';
import { PLATE_HEIGHT, type Vec3 } from '../core/grid';
import { brickCellBox, brickOrigin, cellBoxToAabb } from '../core/model/geometry';
import { allStuds, visibleStuds } from '../core/model/studs';
import type { Brick } from '../core/model/types';
import type { PartLookup } from '../core/parts/types';
import { materialize, payloadFromPart, reuseIds, type Payload } from '../core/placement/payload';
import { pickBricks, type Hit } from '../core/placement/ray';
import { solvePlacement, type PlacementResult } from '../core/placement/solver';
import { BrickBatches } from '../engine/brickBatches';
import { exportGlb } from '../engine/exporters';
import { GeometryCache } from '../engine/geometryCache';
import { Ground } from '../engine/ground';
import { HoverBox } from '../engine/hoverBox';
import { MaterialLibrary } from '../engine/materials';
import type { MeshSource } from '../engine/meshStore';
import { Viewport, type Bounds3 } from '../engine/viewport';
import { bricksFit, bricksOf, selectedBricks, spatialIndexFor, worldBounds } from '../state/selectors';
import type { EditorState } from '../state/types';
import { attachPartDrop } from './dragAndDrop';
import { attachKeyboard } from './keyboard';
import { PointerInput } from './PointerInput';

const HOVER_COLORS = { select: '#ff6b2c', paint: '#2f6fed', erase: '#e5484d' } as const;
const SHADOW_STEP = 8;

function ghostIds(): () => string {
  let n = 0;
  return () => `ghost-${n++}`;
}

/** Rounds bounds outwards so the shadow camera does not jitter with every new brick. */
function quantize(bounds: Bounds3): Bounds3 {
  const down = (v: number) => Math.floor(v / SHADOW_STEP) * SHADOW_STEP;
  const up = (v: number) => Math.ceil(v / SHADOW_STEP) * SHADOW_STEP;
  return {
    min: { x: down(bounds.min.x), y: 0, z: down(bounds.min.z) },
    max: { x: up(bounds.max.x), y: up(bounds.max.y), z: up(bounds.max.z) },
  };
}

/**
 * Connects the store to the 3D scene: keeps the instanced model, selection,
 * previews and ground in sync with state, and turns pointer and keyboard
 * input into store actions.
 */
export class EditorController {
  readonly viewport: Viewport;
  readonly geometries: GeometryCache;
  readonly materials = new MaterialLibrary();
  private readonly batches: BrickBatches;
  private readonly selection: BrickBatches;
  private readonly ghosts: BrickBatches;
  private readonly hoverBox = new HoverBox();
  private readonly ground: Ground;
  private readonly pointer: PointerInput;
  private readonly cleanups: (() => void)[] = [];
  private lastPointer: { x: number; y: number } | null = null;
  private dragging = false;
  private previewSuspended = false;
  private meshRefresh: number | null = null;

  constructor(
    container: HTMLElement,
    readonly store: StoreApi<EditorState>,
    readonly lookup: PartLookup,
    meshes: MeshSource | null = null,
  ) {
    this.viewport = new Viewport(container);
    let geometries: GeometryCache | null = null;
    try {
      geometries = new GeometryCache(lookup, meshes);
      this.geometries = geometries;
      this.cleanups.push(geometries.onChange(() => this.scheduleMeshRefresh()));
      this.batches = new BrickBatches(this.geometries, this.materials, lookup);
      this.selection = new BrickBatches(this.geometries, this.materials, lookup, 'selected');
      this.ghosts = new BrickBatches(this.geometries, this.materials, lookup, 'ghost');
      this.ground = new Ground(this.geometries, this.materials);
      this.viewport.world.add(this.ground.group, this.batches.group, this.selection.group, this.ghosts.group, this.hoverBox.object);

      this.syncGround();
      this.syncModel();
      this.cleanups.push(store.subscribe((state, previous) => this.onStateChange(state, previous)));
      this.pointer = new PointerInput(container, this);
      this.cleanups.push(() => this.pointer.dispose(), attachKeyboard(this), attachPartDrop(container, this));
      const onCameraChange = (): void => this.refreshPreview();
      this.viewport.controls.addEventListener('change', onCameraChange);
      this.cleanups.push(() => this.viewport.controls.removeEventListener('change', onCameraChange));
    } catch (error: unknown) {
      // don't leave a live WebGL context, render loop or listeners behind
      for (const cleanup of this.cleanups) cleanup();
      // the cache listens to the shared mesh store until disposed
      geometries?.dispose();
      this.viewport.dispose();
      throw error;
    }
  }

  private get state(): EditorState {
    return this.store.getState();
  }

  /** Library meshes land one by one; redraw once per frame however many arrived. */
  private scheduleMeshRefresh(): void {
    if (this.meshRefresh !== null) return;
    this.meshRefresh = requestAnimationFrame(() => {
      this.meshRefresh = null;
      for (const batches of [this.batches, this.selection, this.ghosts]) batches.refreshParts();
      this.viewport.requestRender();
    });
  }

  private onStateChange(state: EditorState, previous: EditorState): void {
    const modelChanged = state.history.present !== previous.history.present;
    if (modelChanged || state.selection !== previous.selection) this.syncModel();
    if (state.settings !== previous.settings) this.syncGround();
    const buildChanged =
      state.tool !== previous.tool ||
      state.activePartId !== previous.activePartId ||
      state.activeColorId !== previous.activeColorId ||
      state.buildRotation !== previous.buildRotation ||
      state.pastePayload !== previous.pastePayload;
    if (modelChanged || buildChanged) this.refreshPreview();
  }

  private syncGround(): void {
    const { baseplateSize, baseplateColor } = this.state.settings;
    this.ground.setBaseplate(baseplateSize, baseplateColor);
    this.syncShadows();
    this.viewport.requestRender();
  }

  /** Rebuilds the instanced model; selected bricks are drawn separately so they can move freely. */
  syncModel(): void {
    const state = this.state;
    const model = state.history.present;
    const bricks = bricksOf(model);
    const selection = state.selection;
    const resting = selection.size === 0 ? bricks : bricks.filter((b) => !selection.has(b.id));
    const index = spatialIndexFor(model, this.lookup);
    const isOpaque = (id: string): boolean => isOpaqueColor(model.bricks.get(id)?.colorId ?? -1);
    this.batches.update(resting, visibleStuds(bricks, index, this.lookup, isOpaque, selection));
    if (!this.dragging) this.showSelection(selectedBricks(state));
    this.syncShadows();
    this.viewport.requestRender();
  }

  private showSelection(bricks: readonly Brick[]): void {
    this.selection.setLook('selected');
    this.selection.update(bricks, allStuds(bricks, this.lookup));
  }

  private syncShadows(): void {
    const half = this.state.settings.baseplateSize / 2;
    const model = worldBounds(bricksOf(this.state.history.present), this.lookup);
    const plate: Bounds3 = { min: { x: -half, y: 0, z: -half }, max: { x: half, y: 1, z: half } };
    const merged: Bounds3 = model
      ? {
          min: { x: Math.min(model.min.x, plate.min.x), y: 0, z: Math.min(model.min.z, plate.min.z) },
          max: { x: Math.max(model.max.x, plate.max.x), y: model.max.y, z: Math.max(model.max.z, plate.max.z) },
        }
      : plate;
    this.viewport.fitShadows(quantize(merged));
  }

  pick(clientX: number, clientY: number, options: { ground: boolean; exclude?: ReadonlySet<string> }): Hit | null {
    const ray = this.viewport.rayFromClient(clientX, clientY);
    return pickBricks(ray, bricksOf(this.state.history.present), this.lookup, {
      groundY: options.ground ? 0 : null,
      groundBounds: this.ground.bounds(),
      exclude: options.exclude,
    });
  }

  /** The payload the build tool would place: a pasted group or the active part. */
  buildPayload(): Payload | null {
    const state = this.state;
    if (state.pastePayload) return state.pastePayload;
    const part = this.lookup(state.activePartId);
    return part ? payloadFromPart(part, state.activeColorId, state.buildRotation) : null;
  }

  /**
   * Solves where a payload would land under the cursor. Pass the ids of bricks
   * being dragged: they are ignored for collisions and keep their grab point
   * under the cursor.
   */
  solveAt(clientX: number, clientY: number, payload: Payload, ids: readonly string[] | null): PlacementResult | null {
    const moving = new Set(ids ?? []);
    const hit = this.pick(clientX, clientY, { ground: true, exclude: moving });
    if (!hit) return null;
    const model = this.state.history.present;
    const ray = ids ? this.viewport.rayFromClient(clientX, clientY) : undefined;
    return solvePlacement(
      hit,
      payload,
      (offset) => bricksFit(model, materialize(payload, offset, ids ? reuseIds(ids) : ghostIds()), this.lookup, moving),
      { ray },
    );
  }

  updatePointer(clientX: number, clientY: number): void {
    this.lastPointer = { x: clientX, y: clientY };
    this.refreshPreview();
  }

  pointerLeft(): void {
    this.lastPointer = null;
    this.refreshPreview();
  }

  /** Hides the build preview while the camera is being dragged around. */
  suspendPreview(suspended: boolean): void {
    if (this.previewSuspended === suspended) return;
    this.previewSuspended = suspended;
    this.refreshPreview();
  }

  refreshPreview(): void {
    if (this.dragging) return;
    const state = this.state;
    const pointer = this.lastPointer;
    if (!pointer || this.previewSuspended) {
      this.clearPreview();
      return;
    }
    if (state.tool === 'build') {
      this.hoverBox.show(null);
      state.setHover(null);
      const payload = this.buildPayload();
      const result = payload ? this.solveAt(pointer.x, pointer.y, payload, null) : null;
      if (!payload || !result) {
        this.ghosts.clear();
        state.setPlacementValid(null);
        state.setCursor(null);
      } else {
        const ghostBricks = materialize(payload, result.offset, ghostIds());
        this.ghosts.setLook(result.valid ? 'ghost' : 'ghost-invalid');
        this.ghosts.update(ghostBricks, allStuds(ghostBricks, this.lookup));
        state.setPlacementValid(result.valid);
        state.setCursor(result.offset);
      }
    } else {
      this.ghosts.clear();
      state.setPlacementValid(null);
      const hit = this.pick(pointer.x, pointer.y, { ground: false });
      const brick = hit?.brickId ? this.state.history.present.bricks.get(hit.brickId) : undefined;
      this.showHover(brick ?? null);
    }
    this.viewport.requestRender();
  }

  private showHover(brick: Brick | null): void {
    const state = this.state;
    state.setHover(brick?.id ?? null);
    if (!brick) {
      this.hoverBox.show(null);
      state.setCursor(null);
      return;
    }
    const tool = state.tool === 'build' ? 'select' : state.tool;
    this.hoverBox.show(cellBoxToAabb(brickCellBox(brick, this.lookup)), HOVER_COLORS[tool]);
    state.setCursor({ x: brick.x, y: brick.y, z: brick.z });
  }

  clearPreview(): void {
    this.ghosts.clear();
    this.hoverBox.show(null);
    const state = this.state;
    state.setHover(null);
    state.setPlacementValid(null);
    state.setCursor(null);
    this.viewport.requestRender();
  }

  /** Places the build payload where the cursor points, if it fits. */
  buildAt(clientX: number, clientY: number): void {
    const payload = this.buildPayload();
    const result = payload ? this.solveAt(clientX, clientY, payload, null) : null;
    if (!result) return;
    if (!result.valid) {
      this.state.toast('There is no room for that there.', 'error');
      return;
    }
    this.state.placePayload(result.offset);
  }

  beginDrag(): void {
    this.dragging = true;
    this.ghosts.clear();
    this.hoverBox.show(null);
  }

  showDragPreview(bricks: readonly Brick[], valid: boolean): void {
    this.selection.setLook(valid ? 'selected' : 'invalid');
    this.selection.update(bricks, allStuds(bricks, this.lookup));
    this.state.setCursor(bricks[0] ? { x: bricks[0].x, y: bricks[0].y, z: bricks[0].z } : null);
    this.viewport.requestRender();
  }

  endDrag(): void {
    this.dragging = false;
    this.showSelection(selectedBricks(this.state));
    this.refreshPreview();
    this.viewport.requestRender();
  }

  cancelGesture(): boolean {
    return this.pointer.cancel();
  }

  rotateGesture(dir: 1 | -1): boolean {
    return this.pointer.rotate(dir);
  }

  /** Ids of bricks whose centre projects inside a screen rectangle. */
  bricksInRect(left: number, top: number, right: number, bottom: number): string[] {
    const ids: string[] = [];
    for (const brick of bricksOf(this.state.history.present)) {
      const origin = brickOrigin(brick, this.lookup);
      const part = this.lookup(brick.partId);
      const centre: Vec3 = { x: origin.x, y: origin.y + ((part?.h ?? 1) * PLATE_HEIGHT) / 2, z: origin.z };
      const screen = this.viewport.worldToClient(centre);
      if (screen && screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom) ids.push(brick.id);
    }
    return ids;
  }

  frameSelection(): void {
    const selected = selectedBricks(this.state);
    if (selected.length === 0) {
      this.frameAll();
      return;
    }
    const bounds = worldBounds(selected, this.lookup);
    if (bounds) this.viewport.frame3(bounds);
  }

  frameAll(): void {
    const bounds = worldBounds(bricksOf(this.state.history.present), this.lookup);
    if (bounds) this.viewport.frame3(bounds);
    else this.resetView();
  }

  resetView(): void {
    this.viewport.resetView();
  }

  /** Captures the view as a PNG without previews, hover outlines or selection highlights. */
  capturePng(): Promise<Blob> {
    this.ghosts.group.visible = false;
    this.hoverBox.object.visible = false;
    this.selection.setLook('resting');
    return this.viewport.capturePng().finally(() => {
      this.ghosts.group.visible = true;
      this.selection.setLook('selected');
      this.refreshPreview();
    });
  }

  async exportGlb(name: string): Promise<Blob> {
    const bricks = bricksOf(this.state.history.present);
    const failed = await this.geometries.preload(bricks.map((b) => b.partId));
    if (failed.length > 0) throw new Error(`${failed.length} library part${failed.length === 1 ? '' : 's'} could not be loaded`);
    return exportGlb(name, bricks, this.lookup, this.geometries, this.materials);
  }

  /** Where the camera is looking, so exports can match the current view. */
  viewDirection(): Vec3 {
    return this.viewport.viewDirection();
  }

  /** Camera direction flattened onto the ground, for camera-relative nudges. */
  groundForward(): { x: number; z: number } {
    return this.viewport.groundForward();
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    if (this.meshRefresh !== null) cancelAnimationFrame(this.meshRefresh);
    this.batches.dispose();
    this.selection.dispose();
    this.ghosts.dispose();
    this.hoverBox.dispose();
    this.ground.dispose();
    this.geometries.dispose();
    this.materials.dispose();
    this.viewport.dispose();
  }
}
