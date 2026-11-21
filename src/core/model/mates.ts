/**
 * What plugs into what. The editor asks when a part is built at another's
 * connection; the library build asks too, to leave out the connections a
 * ready-made assembly's own pieces take (scripts/ldraw/connectors.ts).
 */
import type { ConnectorKind } from '../parts/types';

export function isPair(a: ConnectorKind, b: ConnectorKind, p: ConnectorKind, q: ConnectorKind): boolean {
  return (a === p && b === q) || (a === q && b === p);
}

/**
 * A pin into a pin hole, an axle into either kind of hole, a click hinge's
 * single finger into a fork, a minifigure's head on its neck, hips under
 * its waist, legs on the hips, arms at its shoulders and hands at its
 * wrists, a bar in a clip, a minifigure's hand or an open stud, and each
 * half of the older hinges and of the turntables with its own other half:
 * among them a car roof's or a canopy's four fingers between its holder's
 * five, the two plates of a folding hinge plate, a control stick in its
 * base, and the tongue of a 1 × 8 hinge brick's one half in the yoke of the
 * other.
 */
const PAIRS: readonly (readonly [ConnectorKind, ConnectorKind])[] = [
  ['pin', 'pinhole'],
  ['axle', 'pinhole'],
  ['axle', 'axlehole'],
  ['finger', 'fork'],
  ['neck', 'head'],
  ['waist', 'hips'],
  ['hip', 'leg'],
  ['shoulder', 'arm'],
  ['wrist', 'hand'],
  ['bar', 'clip'],
  ['bar', 'barhole'],
  ['fingers2', 'fingers3'],
  ['hingebase', 'hingetop'],
  ['swivelbase', 'swiveltop'],
  ['turnbase', 'turntop'],
  ['turnbase4', 'turntop4'],
  ['turnflat', 'turnsnap'],
  ['fingers4', 'fingers5'],
  ['foldbase', 'foldtop'],
  ['stickbase', 'stick'],
  ['tongue', 'yoke'],
];

export function mates(a: ConnectorKind, b: ConnectorKind): boolean {
  return PAIRS.some(([p, q]) => isPair(a, b, p, q));
}
