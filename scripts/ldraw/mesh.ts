import type { V3 } from './parse.ts';

export interface MeshTriangle {
  readonly a: V3;
  readonly b: V3;
  readonly c: V3;
  readonly doubleSided?: boolean;
}

export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

/** Corners closer than this (in studs) are treated as the same point. */
const WELD = 1e-4;

interface Face {
  readonly corners: readonly [number, number, number];
  readonly normal: V3;
  readonly area: number;
}

function cross(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

interface Welded {
  readonly points: readonly V3[];
  readonly faces: readonly Face[];
}

/** Merges corners that share a spot and drops faces that collapse; double-sided triangles get a reversed twin. */
function weldFaces(triangles: readonly MeshTriangle[]): Welded {
  const points: V3[] = [];
  const pointIds = new Map<string, number>();
  const weld = (p: V3): number => {
    const key = `${Math.round(p[0] / WELD)},${Math.round(p[1] / WELD)},${Math.round(p[2] / WELD)}`;
    let id = pointIds.get(key);
    if (id === undefined) {
      id = points.length;
      points.push(p);
      pointIds.set(key, id);
    }
    return id;
  };
  const faces: Face[] = [];
  const addFace = (a: V3, b: V3, c: V3): void => {
    const corners: [number, number, number] = [weld(a), weld(b), weld(c)];
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[0] === corners[2]) return;
    const n = cross(a, b, c);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length < 1e-12) return;
    faces.push({ corners, normal: [n[0] / length, n[1] / length, n[2] / length], area: length / 2 });
  };
  for (const t of triangles) {
    addFace(t.a, t.b, t.c);
    if (t.doubleSided) addFace(t.a, t.c, t.b);
  }
  return { points, faces };
}

/** A face's normal at one corner: the area-weighted mean of the faces there that meet it within the crease angle. */
function cornerNormal(face: Face, neighbours: readonly Face[], cosCrease: number): V3 {
  let nx = 0, ny = 0, nz = 0;
  for (const other of neighbours) {
    const [ox, oy, oz] = other.normal;
    if (ox * face.normal[0] + oy * face.normal[1] + oz * face.normal[2] < cosCrease) continue;
    nx += ox * other.area;
    ny += oy * other.area;
    nz += oz * other.area;
  }
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

/**
 * Turns loose triangles into an indexed mesh with smooth normals wherever
 * neighbouring faces meet at less than the crease angle, so curved surfaces
 * shade smoothly while box edges stay crisp.
 */
export function buildMesh(triangles: readonly MeshTriangle[], creaseDegrees = 35): MeshData {
  const { points, faces } = weldFaces(triangles);
  const around: Face[][] = points.map(() => []);
  for (const face of faces) for (const corner of face.corners) around[corner]?.push(face);

  const cosCrease = Math.cos((creaseDegrees * Math.PI) / 180);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const vertexIds = new Map<string, number>();
  for (const face of faces) {
    for (const corner of face.corners) {
      const [nx, ny, nz] = cornerNormal(face, around[corner] ?? [], cosCrease);
      // corners whose smoothed normals agree share one vertex
      const key = `${corner}|${Math.round(nx * 1000)},${Math.round(ny * 1000)},${Math.round(nz * 1000)}`;
      let vertex = vertexIds.get(key);
      if (vertex === undefined) {
        vertex = positions.length / 3;
        const p = points[corner] as V3;
        positions.push(p[0], p[1], p[2]);
        normals.push(nx, ny, nz);
        vertexIds.set(key, vertex);
      }
      indices.push(vertex);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}
