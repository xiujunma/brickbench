import { BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments } from 'three';
import type { Aabb } from '../core/model/geometry';

const INFLATE = 0.02;

/** Thin outline drawn around the brick under the cursor. */
export class HoverBox {
  readonly object: LineSegments<EdgesGeometry, LineBasicMaterial>;

  constructor() {
    const box = new BoxGeometry(1, 1, 1);
    this.object = new LineSegments(new EdgesGeometry(box), new LineBasicMaterial({ color: '#ff6b2c', transparent: true, opacity: 0.95 }));
    box.dispose();
    this.object.visible = false;
    this.object.renderOrder = 10;
  }

  show(box: Aabb | null, color = '#ff6b2c'): void {
    if (!box) {
      this.object.visible = false;
      return;
    }
    const { min, max } = box;
    this.object.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    this.object.scale.set(max.x - min.x + INFLATE, max.y - min.y + INFLATE, max.z - min.z + INFLATE);
    this.object.material.color.set(color);
    this.object.visible = true;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
