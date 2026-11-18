import { containsWord } from '../finder/text';
import type { Dim, Footprint, Height, PartPattern, PartTerm, PatternNode } from './ast';
import type { WorkBudget } from './errors';
import type { Subject } from './subject';
import { matchesTopFace } from './topFace';

export interface MatchContext {
  /** The parts the user owns: what @owned keeps to. Without it, @owned matches nothing. */
  readonly owned?: ReadonlySet<string> | undefined;
  /** The work matching may do, shared by every part a search tries; unlimited without one. */
  readonly budget?: WorkBudget | undefined;
}

export function dimHas(dim: Dim, value: number): boolean {
  switch (dim.type) {
    case 'any':
      return true;
    case 'range':
      return value >= dim.min && value <= dim.max;
    case 'set':
      return dim.values.includes(value);
  }
}

function fits(footprint: Footprint, [x, y]: readonly [number, number]): boolean {
  return (dimHas(footprint.a, x) && dimHas(footprint.b, y)) || (dimHas(footprint.a, y) && dimHas(footprint.b, x));
}

function tallEnough(height: Height, plates: number): boolean {
  return plates % height.unit === 0 && dimHas(height.dim, plates / height.unit);
}

/** Whether `glob` (* any run, ? any one character) matches all of `text`, without backtracking. */
export function globMatches(glob: string, text: string): boolean {
  const closeStars = (states: Set<number>): Set<number> => {
    for (const g of states) if (glob[g] === '*') states.add(g + 1);
    return states;
  };
  let states = closeStars(new Set([0]));
  for (const c of text) {
    const next = new Set<number>();
    for (const g of states) {
      if (glob[g] === '*') next.add(g);
      else if (glob[g] === '?' || glob[g] === c) next.add(g + 1);
    }
    states = closeStars(next);
    if (states.size === 0) return false;
  }
  return states.has(glob.length);
}

function matchesPart(term: PartTerm, subject: Subject, budget: WorkBudget | undefined): boolean {
  if (term.kind !== null && subject.kind !== term.kind) return false;
  if (term.angle !== null && subject.angle !== term.angle) return false;
  if (term.inverted && !subject.inverted) return false;
  if (term.footprint && !fits(term.footprint, subject.sizes)) return false;
  if (term.height && !tallEnough(term.height, subject.plates)) return false;
  const face = term.face;
  return face === null || subject.grids.some((grid) => matchesTopFace(face, grid, budget));
}

function matchesNode(node: PatternNode, subject: Subject, context: MatchContext): boolean {
  switch (node.type) {
    case 'part':
      return matchesPart(node.term, subject, context.budget);
    case 'feature':
      return subject.features.has(node.name) === node.wanted;
    case 'colour':
      return subject.colours === undefined || subject.colours.has(node.colour);
    case 'number':
      return globMatches(node.glob, subject.number);
    case 'source':
      return node.source === 'owned' ? (context.owned?.has(subject.partId) ?? false) : subject.source === node.source;
    case 'name':
      return node.words.every((word) => containsWord(subject.name, word, true));
    case 'not':
      return !matchesNode(node.node, subject, context);
    case 'and':
      return node.nodes.every((n) => matchesNode(n, subject, context));
    case 'or':
      return node.nodes.some((n) => matchesNode(n, subject, context));
  }
}

/** Whether a part is one the pattern describes. */
export function matchesPattern(pattern: PartPattern, subject: Subject, context: MatchContext = {}): boolean {
  return matchesNode(pattern.root, subject, context);
}
