/**
 * What builders call parts, and what parts have, read from their names
 * (normalised: lower case, sizes written "1x2").
 */

/** Hobby nicknames for parts whose official names say something else. */
const NICKNAMES: readonly { readonly tag: string; readonly pattern: RegExp }[] = [
  { tag: 'cheese', pattern: /^slope brick 31 1x[12]x0\.667/ },
  { tag: 'jumper', pattern: /^plate (?!.*\bround\b).*with 1 cent(?:re|er) stud/ },
  { tag: 'macaroni', pattern: /^brick 2x2 corner round/ },
  { tag: 'snot', pattern: /studs? on (?:\d+ )?sides?|side studs?|^bracket|headlight/ },
  { tag: 'erling', pattern: /^brick 1x1 with headlight$/ },
  { tag: 'dot', pattern: /^(?:plate|tile) 1x1 round$/ },
  { tag: 'liftarm', pattern: /^technic beam/ },
];

export type Feature = 'clip' | 'bar' | 'side-studs' | 'holes' | 'round' | 'slope' | 'hinge' | 'smooth' | 'window-door' | 'wheel';

export interface FeatureInfo {
  readonly id: Feature;
  readonly label: string;
  readonly pattern: RegExp;
}

export const FEATURES: readonly FeatureInfo[] = [
  { id: 'clip', label: 'Clip', pattern: /\bclips?\b/ },
  { id: 'bar', label: 'Bar or handle', pattern: /\bbars?\b|\bhandles?\b/ },
  { id: 'side-studs', label: 'Studs on the side', pattern: /studs? on (?:\d+ )?sides?|side studs?|^bracket|headlight/ },
  { id: 'holes', label: 'Holes or pins', pattern: /\bholes?\b|axlehole|pin ?hole|pegholes?|\bpins?\b|\baxles?\b/ },
  { id: 'round', label: 'Round or curved', pattern: /\bround(?:ed)?\b|\bcurved\b|\bdome\b|\bcylinder\b|\bcone\b|\barch\b/ },
  { id: 'slope', label: 'Slope or wedge', pattern: /\bslope[sd]?\b|\bwedges?\b/ },
  { id: 'hinge', label: 'Hinge or turning', pattern: /\bhinge[sd]?\b|turntable|swivel|\bball\b|socket|towball/ },
  { id: 'smooth', label: 'Smooth top', pattern: /^tile\b|\bsmooth\b/ },
  { id: 'window-door', label: 'Window or door', pattern: /\bwindows?\b|\bwindscreens?\b|\bdoors?\b|\bglass\b|\bfence\b|\bgate\b|\bshutter\b/ },
  { id: 'wheel', label: 'Wheel or tyre', pattern: /\bwheels?\b|\btyres?\b|\brims?\b/ },
];

export type HeightClass = 'plate' | 'two-plates' | 'brick' | 'up-to-two-bricks' | 'taller';

export const HEIGHTS: readonly { readonly id: HeightClass; readonly label: string; readonly test: (plates: number) => boolean }[] = [
  { id: 'plate', label: '1 plate', test: (h) => h === 1 },
  { id: 'two-plates', label: '2 plates', test: (h) => h === 2 },
  { id: 'brick', label: '1 brick', test: (h) => h === 3 },
  { id: 'up-to-two-bricks', label: 'Up to 2 bricks', test: (h) => h >= 4 && h <= 6 },
  { id: 'taller', label: 'Taller', test: (h) => h > 6 },
];

export function nicknamesOf(name: string): string[] {
  return NICKNAMES.filter((n) => n.pattern.test(name)).map((n) => n.tag);
}

export function featuresOf(name: string): Set<Feature> {
  return new Set(FEATURES.filter((f) => f.pattern.test(name)).map((f) => f.id));
}

export function heightClassOf(plates: number): HeightClass | null {
  return HEIGHTS.find((h) => h.test(plates))?.id ?? null;
}

/** Footprints match either way round: a 2 × 1 part is a "1x2". */
export function footprintKey(w: number, d: number): string {
  return `${Math.min(w, d)}x${Math.max(w, d)}`;
}
