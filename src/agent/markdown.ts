/**
 * Reads the markdown agents reply in: paragraphs, headings, lists (nested by
 * indentation), fenced code and rules, with bold, italic, code and web links
 * inside them. It returns plain data, never HTML, so the panel draws replies
 * as React elements and nothing in one can add markup of its own.
 *
 * Replies come from outside the app, so reading is bounded: lists, bold,
 * italic and links nest at most MAX_DEPTH deep, deeper markers reading as
 * text, and a search that fails is remembered, so a line full of unmatched
 * markers is still read in linear time.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  /** Line breaks inside a paragraph are kept: replies are not hard-wrapped. */
  | { readonly kind: 'paragraph'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly kind: 'heading'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'rule' }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly Block[])[] };

/** How deep lists, bold, italic and links nest; deeper markers read as plain text. */
const MAX_DEPTH = 8;

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
const WEB_ADDRESS = /^https?:\/\/\S+$/i;

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);
const isEscape = (text: string, at: number): boolean => text[at] === '\\' && PUNCTUATION.test(text[at + 1] ?? '');

function runLength(text: string, at: number, char: string): number {
  let end = at;
  while (text[end] === char) end++;
  return end - at;
}

/**
 * One line being read, with the searches on it that failed and where they
 * started: the same search from further on would fail too.
 */
interface Line {
  readonly text: string;
  /** Per number of backticks, the earliest start with no closing run after it. */
  readonly noCode: Map<number, number>;
  /** Per marker ("*", "**", "_" or "__"), the earliest start with no closer after it. */
  readonly noCloser: Map<string, number>;
  /** Where the last "](" is: no link starts after it. */
  readonly lastLinkMiddle: number;
}

/** Where the code span opened by `run` backticks closes: the next run of exactly as many, or -1. */
function codeCloser(line: Line, from: number, run: number): number {
  const failed = line.noCode.get(run);
  if (failed !== undefined && from >= failed) return -1;
  const { text } = line;
  for (let at = text.indexOf('`', from); at !== -1; ) {
    const length = runLength(text, at, '`');
    if (length === run) return at;
    at = text.indexOf('`', at + length);
  }
  line.noCode.set(run, from);
  return -1;
}

/** One space of padding on both sides of a code span is dropped, as in `` `x` ``. */
function trimCode(code: string): string {
  return code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '' ? code.slice(1, -1) : code;
}

/** Emphasis opens on a marker followed by text; `_` never opens inside a word. */
function opens(text: string, at: number, char: string, width: number): boolean {
  if (isSpace(text[at + width])) return false;
  return char !== '_' || !WORD.test(text[at - 1] ?? ' ');
}

/** Emphasis closes on a marker after text; a longer run closes on its last markers. */
function closes(text: string, at: number, char: string, width: number): boolean {
  const before = text[at - 1];
  const after = text[at + width];
  if (isSpace(before) || after === char) return false;
  if (width === 1 && before === char) return false;
  return char !== '_' || !WORD.test(after ?? ' ');
}

/** Where emphasis opened just before `start` closes, stepping over escapes and code spans, or -1. */
function emphasisCloser(line: Line, start: number, char: string, width: number): number {
  const marker = char.repeat(width);
  const failed = line.noCloser.get(marker);
  if (failed !== undefined && start >= failed) return -1;
  const { text } = line;
  let at = start;
  while (at < text.length) {
    if (isEscape(text, at)) {
      at += 2;
    } else if (text[at] === '`') {
      const run = runLength(text, at, '`');
      const close = codeCloser(line, at + run, run);
      at = close === -1 ? at + run : close + run;
    } else if (at > start && text.startsWith(marker, at) && closes(text, at, char, width)) {
      return at;
    } else {
      at++;
    }
  }
  line.noCloser.set(marker, start);
  return -1;
}

/** A web link at `at`, [label](https://…), with a label and address of sensible length. */
function linkAt(text: string, at: number): { readonly label: string; readonly href: string; readonly end: number } | null {
  const pattern = /\[([^\]\n]{1,500})\]\(([^()\s]{1,2048})\)/y;
  pattern.lastIndex = at;
  const [whole, label, href] = pattern.exec(text) ?? [];
  return whole && label && href && WEB_ADDRESS.test(href) ? { label, href, end: at + whole.length } : null;
}

function readInline(text: string, depth: number): Inline[] {
  const line: Line = { text, noCode: new Map(), noCloser: new Map(), lastLinkMiddle: text.lastIndexOf('](') };
  const nests = depth < MAX_DEPTH;
  const out: Inline[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer) out.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? '';
    if (isEscape(text, at)) {
      buffer += text[at + 1];
      at += 2;
      continue;
    }
    if (char === '`') {
      const run = runLength(text, at, '`');
      const close = codeCloser(line, at + run, run);
      if (close === -1) {
        buffer += '`'.repeat(run);
        at += run;
        continue;
      }
      flush();
      out.push({ kind: 'code', text: trimCode(text.slice(at + run, close)) });
      at = close + run;
      continue;
    }
    if (char === '[' && nests && at < line.lastLinkMiddle) {
      const link = linkAt(text, at);
      if (link) {
        flush();
        out.push({ kind: 'link', href: link.href, children: readInline(link.label, depth + 1) });
        at = link.end;
        continue;
      }
    }
    if ((char === '*' || char === '_') && nests) {
      const run = runLength(text, at, char);
      const width = run >= 2 ? 2 : 1;
      const close = opens(text, at, char, width) ? emphasisCloser(line, at + width, char, width) : -1;
      if (close !== -1) {
        flush();
        out.push({ kind: width === 2 ? 'strong' : 'em', children: readInline(text.slice(at + width, close), depth + 1) });
        at = close + width;
        continue;
      }
      buffer += char.repeat(run);
      at += run;
      continue;
    }
    buffer += char;
    at++;
  }
  flush();
  return out;
}

/** Reads one line of text: bold, italic, code spans, web links and backslash escapes. Anything else stays text. */
export function parseInline(text: string): Inline[] {
  return readInline(text, 0);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(?=\S)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;

const isBlank = (line: string): boolean => line.trim() === '';
const indentOf = (line: string): number => line.length - line.trimStart().length;
const startsBlock = (line: string): boolean => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || ITEM.test(line);

function nextNonBlank(lines: readonly string[], from: number): number {
  for (let at = from; at < lines.length; at++) if (!isBlank(lines[at] ?? '')) return at;
  return -1;
}

/** A heading's text: after its opening #s, without a closing run of #s that follows a space. */
function headingText(line: string, opening: number): string {
  const text = line.trimEnd();
  let end = text.length;
  while (end > opening && text[end - 1] === '#') end--;
  const closed = end < text.length && (end === opening || /[ \t]/.test(text[end - 1] ?? ''));
  return text.slice(opening, closed ? end : text.length).trim();
}

interface Marker {
  readonly indent: number;
  readonly ordered: boolean;
  readonly start: number;
  /** Lines indented this far belong to the item. */
  readonly inside: number;
  readonly text: string;
}

function readMarker(line: string): Marker | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const indent = match[1]?.length ?? 0;
  const token = match[2] ?? '-';
  const gap = Math.min(4, Math.max(1, match[3]?.length ?? 1));
  const ordered = /\d/.test(token);
  // nested lists are often indented by two, even under "1. "
  const inside = Math.min(indent + token.length + gap, indent + 2);
  return { indent, ordered, start: ordered ? Number.parseInt(token, 10) : 1, inside, text: match[4] ?? '' };
}

type Read = readonly [Block, number];

function readFence(lines: readonly string[], start: number, fence: string): Read {
  const indent = indentOf(lines[start] ?? '');
  const body: string[] = [];
  let at = start + 1;
  for (; at < lines.length; at++) {
    const line = lines[at] ?? '';
    const close = FENCE.exec(line)?.[1];
    if (close && close[0] === fence[0] && close.length >= fence.length && isBlank(line.trimStart().slice(close.length))) {
      return [{ kind: 'code', text: body.join('\n') }, at + 1];
    }
    body.push(line.slice(Math.min(indent, indentOf(line))));
  }
  return [{ kind: 'code', text: body.join('\n') }, at];
}

function readParagraph(lines: readonly string[], start: number): Read {
  const body: string[] = [];
  let at = start;
  for (; at < lines.length; at++) {
    const line = lines[at] ?? '';
    if (isBlank(line) || (at > start && startsBlock(line))) break;
    body.push(line.trim());
  }
  return [{ kind: 'paragraph', lines: body.map(parseInline) }, at];
}

/** One item's lines: its own, then indented ones (blank lines included) and lazy continuations of its text. */
function readItem(lines: readonly string[], start: number, marker: Marker): readonly [readonly string[], number] {
  const body = [marker.text];
  let at = start + 1;
  let afterBlank = false;
  while (at < lines.length) {
    const line = lines[at] ?? '';
    if (isBlank(line)) {
      // blank lines stay in the item only when an indented line follows them
      const next = nextNonBlank(lines, at);
      if (next === -1 || indentOf(lines[next] ?? '') < marker.inside) break;
      for (; at < next; at++) body.push('');
      afterBlank = true;
    } else if (indentOf(line) >= marker.inside) {
      body.push(line.slice(marker.inside));
      afterBlank = false;
      at++;
    } else if (!afterBlank && !startsBlock(line)) {
      body.push(line.trim());
      at++;
    } else {
      break;
    }
  }
  return [body, at];
}

function readList(lines: readonly string[], start: number, first: Marker, depth: number): Read {
  const items: Block[][] = [];
  let at = start;
  let marker: Marker | null = first;
  while (marker) {
    const [body, end] = readItem(lines, at, marker);
    items.push(parseBlocks(body, depth + 1));
    const next = nextNonBlank(lines, end);
    const sibling = next === -1 ? null : readMarker(lines[next] ?? '');
    // the list goes on past blank lines to the next item of the same kind
    const continues = sibling !== null && sibling.ordered === first.ordered;
    at = continues ? next : end;
    marker = continues ? sibling : null;
  }
  return [{ kind: 'list', ordered: first.ordered, start: first.start, items }, at];
}

function readBlock(lines: readonly string[], at: number, depth: number): Read {
  const line = lines[at] ?? '';
  const fence = FENCE.exec(line)?.[1];
  if (fence) return readFence(lines, at, fence);
  const heading = HEADING.exec(line);
  if (heading) return [{ kind: 'heading', children: parseInline(headingText(line, heading[0].length)) }, at + 1];
  if (RULE.test(line)) return [{ kind: 'rule' }, at + 1];
  const marker = depth < MAX_DEPTH ? readMarker(line) : null;
  if (marker) return readList(lines, at, marker, depth);
  return readParagraph(lines, at);
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = [];
  for (let at = nextNonBlank(lines, 0); at !== -1; ) {
    const [block, end] = readBlock(lines, at, depth);
    blocks.push(block);
    at = nextNonBlank(lines, end);
  }
  return blocks;
}

/** Reads a whole reply into blocks. */
export function parseMarkdown(text: string): Block[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length)));
  return parseBlocks(lines, 0);
}
