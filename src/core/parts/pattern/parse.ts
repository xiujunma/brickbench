/**
 * Reads part patterns (docs/part-patterns.md). Terms side by side must all
 * hold, "|" gives a choice, "!" negates and ( ) groups, so
 *
 *   or   := and ("|" and)*
 *   and  := not+
 *   not  := "!" not | "(" or ")" | term
 *   term := part | +feature | -feature | :colour | =number | @source | "words"
 */
import type { PartPattern, PatternNode } from './ast';
import { Cursor } from './cursor';
import { PatternSyntaxError, type PatternError } from './errors';
import { readPartTerm, startsPartTerm } from './partTerm';
import { readColour, readFeature, readName, readNumber, readSource, strayMessage } from './terms';

/** Longest pattern read: plenty for any part, and a bound on the work one can ask for. */
export const MAX_PATTERN_LENGTH = 500;
/** Deepest nesting of ( ) and !, so no pattern can exhaust the stack. */
const MAX_DEPTH = 32;

export type ParseResult = { readonly ok: true; readonly pattern: PartPattern } | { readonly ok: false; readonly error: PatternError };

/** How much work a node asks of each part, so cheap tests run first and rule parts out early. */
function cost(node: PatternNode): number {
  switch (node.type) {
    case 'part':
      return node.term.face ? 2 : 1;
    case 'not':
      return cost(node.node);
    case 'and':
    case 'or':
      return Math.max(...node.nodes.map(cost));
    default:
      return 0;
  }
}

class PatternParser {
  private depth = 0;

  constructor(private readonly cursor: Cursor) {}

  pattern(): PatternNode {
    const { cursor } = this;
    if (cursor.text.length > MAX_PATTERN_LENGTH) cursor.fail(`A pattern has at most ${MAX_PATTERN_LENGTH} characters`, MAX_PATTERN_LENGTH);
    cursor.skipSpaces();
    if (cursor.done) cursor.fail('Write a pattern, such as P2x4 or S45[oo/..]');
    const root = this.or();
    // and() stops only at "|", ")" or the end, and or() takes the "|"
    if (!cursor.done) cursor.fail('This “)” has no “(” to close');
    return root;
  }

  private or(): PatternNode {
    const nodes = [this.and()];
    while (this.cursor.peek() === '|') {
      this.cursor.i += 1;
      nodes.push(this.and());
    }
    return nodes.length === 1 ? (nodes[0] as PatternNode) : { type: 'or', nodes };
  }

  private endsAnd(): boolean {
    const c = this.cursor.peek();
    return c === undefined || c === '|' || c === ')';
  }

  private and(): PatternNode {
    const at = this.cursor.i;
    const nodes: PatternNode[] = [];
    for (this.cursor.skipSpaces(); !this.endsAnd(); this.cursor.skipSpaces()) nodes.push(this.not());
    if (nodes.length === 0) this.cursor.fail('Nothing to match here: each side of “|”, and each ( ), needs a term', at);
    if (nodes.length === 1) return nodes[0] as PatternNode;
    return { type: 'and', nodes: nodes.map((node, i) => ({ node, i })).sort((x, y) => cost(x.node) - cost(y.node) || x.i - y.i).map(({ node }) => node) };
  }

  private nested<T>(read: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) this.cursor.fail(`Patterns nest at most ${MAX_DEPTH} deep`);
    try {
      return read();
    } finally {
      this.depth -= 1;
    }
  }

  private not(): PatternNode {
    if (this.cursor.peek() !== '!') return this.atom();
    this.cursor.i += 1;
    this.cursor.skipSpaces();
    if (this.endsAnd()) this.cursor.fail('A “!” needs a term after it');
    return { type: 'not', node: this.nested(() => this.not()) };
  }

  private atom(): PatternNode {
    const { cursor } = this;
    if (startsPartTerm(cursor)) return { type: 'part', term: readPartTerm(cursor) };
    switch (cursor.peek()) {
      case '(':
        return this.group();
      case '+':
      case '-':
        return readFeature(cursor);
      case ':':
        return readColour(cursor);
      case '=':
        return readNumber(cursor);
      case '@':
        return readSource(cursor);
      case '"':
      case '“':
        return readName(cursor);
      default:
        return cursor.fail(strayMessage(cursor));
    }
  }

  private group(): PatternNode {
    const open = this.cursor.i;
    this.cursor.i += 1;
    const inner = this.nested(() => this.or());
    if (this.cursor.peek() !== ')') this.cursor.fail('A “(” needs its “)”', open);
    this.cursor.i += 1;
    return inner;
  }
}

/** Reads a pattern, or says what is wrong with it and where. */
export function parsePattern(text: string): ParseResult {
  try {
    return { ok: true, pattern: { text, root: new PatternParser(new Cursor(text)).pattern() } };
  } catch (error: unknown) {
    if (error instanceof PatternSyntaxError) return { ok: false, error: { message: error.message, at: error.at } };
    throw error;
  }
}
