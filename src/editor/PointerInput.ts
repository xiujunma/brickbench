import type { Vec3 } from '../core/grid';
import type { Brick } from '../core/model/types';
import { materialize, payloadFromBricks, reuseIds, rotatePayload, type Payload } from '../core/placement/payload';
import { selectedBricks } from '../state/selectors';
import type { SelectMode } from '../state/types';
import type { EditorController } from './EditorController';

/** Pointer travel (px) below which a press counts as a click rather than a drag. */
const CLICK_SLOP = 5;

interface DragSession {
  readonly payload: Payload;
  readonly ids: readonly string[];
  readonly originals: readonly Brick[];
  readonly preview: readonly Brick[] | null;
  readonly valid: boolean;
}

interface GestureBase {
  readonly pointerId: number;
  readonly x0: number;
  readonly y0: number;
  readonly moved: boolean;
}

type Gesture =
  | (GestureBase & { readonly kind: 'camera'; readonly button: number; readonly alt: boolean })
  | (GestureBase & {
      readonly kind: 'brick';
      readonly brickId: string;
      readonly grab: Vec3;
      readonly additive: boolean;
      readonly wasSelected: boolean;
      readonly session: DragSession | null;
    })
  | (GestureBase & { readonly kind: 'marquee'; readonly mode: SelectMode });

function sameSpot(a: readonly Brick[], b: readonly Brick[]): boolean {
  return a.every((brick, i) => {
    const other = b[i];
    return other !== undefined && brick.x === other.x && brick.y === other.y && brick.z === other.z && brick.r === other.r;
  });
}

/**
 * Turns pointer gestures into editor actions. Camera gestures fall through
 * to the orbit controls; presses on bricks (select tool) drag them, and
 * presses on empty space (select tool) draw a selection box.
 */
export class PointerInput {
  private gesture: Gesture | null = null;
  private readonly marquee: HTMLDivElement;
  private last = { x: 0, y: 0 };

  constructor(
    private readonly container: HTMLElement,
    private readonly host: EditorController,
  ) {
    this.marquee = document.createElement('div');
    this.marquee.className = 'marquee';
    this.marquee.hidden = true;
    container.appendChild(this.marquee);
    container.addEventListener('pointerdown', this.onDown, { capture: true });
    container.addEventListener('pointermove', this.onMove);
    container.addEventListener('pointerup', this.onUp);
    container.addEventListener('pointercancel', this.onCancel);
    container.addEventListener('pointerleave', this.onLeave);
    container.addEventListener('contextmenu', this.onContextMenu);
  }

  private get store() {
    return this.host.store.getState();
  }

  private claim(event: PointerEvent): void {
    this.host.viewport.controls.enabled = false;
    this.container.setPointerCapture(event.pointerId);
  }

  private release(pointerId: number): void {
    this.host.viewport.controls.enabled = true;
    if (this.container.hasPointerCapture(pointerId)) this.container.releasePointerCapture(pointerId);
  }

  private onDown = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    // a new primary press means any earlier gesture lost its pointerup
    if (this.gesture) this.cancel();
    const base: GestureBase = { pointerId: event.pointerId, x0: event.clientX, y0: event.clientY, moved: false };
    const state = this.store;
    const usesSelectTool = event.button === 0 && state.tool === 'select' && !event.altKey;
    if (!usesSelectTool) {
      this.gesture = { ...base, kind: 'camera', button: event.button, alt: event.altKey };
      return;
    }

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const hit = this.host.pick(event.clientX, event.clientY, { ground: false });
    if (hit?.brickId) {
      this.claim(event);
      const wasSelected = state.selection.has(hit.brickId);
      if (!wasSelected) state.select([hit.brickId], additive ? 'add' : 'replace');
      this.gesture = { ...base, kind: 'brick', brickId: hit.brickId, grab: hit.point, additive, wasSelected, session: null };
      return;
    }
    if (event.pointerType === 'touch') {
      this.gesture = { ...base, kind: 'camera', button: 0, alt: false };
      return;
    }
    this.claim(event);
    const mode: SelectMode = event.shiftKey ? 'add' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace';
    this.gesture = { ...base, kind: 'marquee', mode };
  };

  private onMove = (event: PointerEvent): void => {
    this.last = { x: event.clientX, y: event.clientY };
    const gesture = this.gesture;
    if (!gesture) {
      this.host.updatePointer(event.clientX, event.clientY);
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    if (!gesture.moved && Math.hypot(event.clientX - gesture.x0, event.clientY - gesture.y0) > CLICK_SLOP) {
      this.gesture = { ...gesture, moved: true };
      if (gesture.kind === 'camera') this.host.suspendPreview(true);
    }
    const current = this.gesture;
    if (!current?.moved) return;
    if (current.kind === 'brick') this.dragTo(current, event.clientX, event.clientY);
    else if (current.kind === 'marquee') this.drawMarquee(current, event.clientX, event.clientY);
  };

  private onUp = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.gesture = null;
    this.release(event.pointerId);

    if (gesture.kind === 'camera') {
      this.host.suspendPreview(false);
      if (!gesture.moved && gesture.button === 0) this.click(gesture, event.clientX, event.clientY);
    } else if (gesture.kind === 'brick') {
      this.finishBrick(gesture);
    } else {
      this.finishMarquee(gesture, event.clientX, event.clientY);
    }
    this.host.updatePointer(event.clientX, event.clientY);
  };

  private onCancel = (): void => {
    this.cancel();
  };

  private onLeave = (): void => {
    if (!this.gesture) this.host.pointerLeft();
  };

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private click(gesture: Extract<Gesture, { kind: 'camera' }>, x: number, y: number): void {
    const state = this.store;
    if (gesture.alt) {
      const hit = this.host.pick(x, y, { ground: false });
      if (hit?.brickId) state.eyedrop(hit.brickId);
      return;
    }
    if (state.tool === 'build') {
      this.host.buildAt(x, y);
      return;
    }
    const hit = this.host.pick(x, y, { ground: false });
    if (state.tool === 'paint' && hit?.brickId) state.paintBrick(hit.brickId);
    else if (state.tool === 'erase' && hit?.brickId) state.eraseBrick(hit.brickId);
    else if (state.tool === 'select' && !hit) state.clearSelection();
  }

  private dragTo(gesture: Extract<Gesture, { kind: 'brick' }>, x: number, y: number): void {
    let session = gesture.session;
    if (!session) {
      const moving = selectedBricks(this.store);
      if (!moving.some((b) => b.id === gesture.brickId)) return;
      session = {
        payload: payloadFromBricks(moving, this.host.lookup, gesture.grab),
        ids: moving.map((b) => b.id),
        originals: moving,
        preview: null,
        valid: false,
      };
      this.host.beginDrag();
    }
    const result = this.host.solveAt(x, y, session.payload, session.ids);
    if (result) {
      const preview = materialize(session.payload, result.offset, reuseIds(session.ids));
      session = { ...session, preview, valid: result.valid };
      this.host.showDragPreview(preview, result.valid);
    }
    this.gesture = { ...gesture, session };
  }

  private finishBrick(gesture: Extract<Gesture, { kind: 'brick' }>): void {
    const state = this.store;
    const session = gesture.session;
    if (session) {
      const { preview, valid, originals } = session;
      if (preview && valid && !sameSpot(preview, originals) && !state.applyBricks(preview)) {
        state.toast('Those bricks no longer fit there.', 'error');
      }
      this.host.endDrag();
      return;
    }
    if (gesture.moved) return;
    if (!gesture.additive) state.select([gesture.brickId], 'replace');
    else if (gesture.wasSelected) state.select([gesture.brickId], 'toggle');
  }

  private rect(gesture: GestureBase, x: number, y: number) {
    return {
      left: Math.min(gesture.x0, x),
      top: Math.min(gesture.y0, y),
      right: Math.max(gesture.x0, x),
      bottom: Math.max(gesture.y0, y),
    };
  }

  private drawMarquee(gesture: GestureBase, x: number, y: number): void {
    const box = this.rect(gesture, x, y);
    const origin = this.container.getBoundingClientRect();
    Object.assign(this.marquee.style, {
      left: `${box.left - origin.left}px`,
      top: `${box.top - origin.top}px`,
      width: `${box.right - box.left}px`,
      height: `${box.bottom - box.top}px`,
    });
    this.marquee.hidden = false;
  }

  private finishMarquee(gesture: Extract<Gesture, { kind: 'marquee' }>, x: number, y: number): void {
    this.marquee.hidden = true;
    const state = this.store;
    if (!gesture.moved) {
      if (gesture.mode === 'replace') state.clearSelection();
      return;
    }
    const box = this.rect(gesture, x, y);
    state.select(this.host.bricksInRect(box.left, box.top, box.right, box.bottom), gesture.mode);
  }

  /** Abandons the current gesture; returns true if there was one worth cancelling. */
  cancel(): boolean {
    const gesture = this.gesture;
    if (!gesture) return false;
    this.gesture = null;
    this.release(gesture.pointerId);
    this.marquee.hidden = true;
    this.host.suspendPreview(false);
    if (gesture.kind === 'brick' && gesture.session) this.host.endDrag();
    return gesture.kind !== 'camera';
  }

  /** Turns the bricks being dragged; returns false when nothing is being dragged. */
  rotate(dir: 1 | -1): boolean {
    const gesture = this.gesture;
    if (gesture?.kind !== 'brick' || !gesture.session) return false;
    const payload = rotatePayload(gesture.session.payload, this.host.lookup, dir);
    this.gesture = { ...gesture, session: { ...gesture.session, payload } };
    const current = this.gesture;
    if (current.kind === 'brick') this.dragTo(current, this.last.x, this.last.y);
    return true;
  }

  dispose(): void {
    const c = this.container;
    c.removeEventListener('pointerdown', this.onDown, { capture: true });
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('contextmenu', this.onContextMenu);
    this.marquee.remove();
  }
}
