import { readFileSync } from 'node:fs';

/** A GitHub-style table: its header cells and its rows of cells, with \| unescaped. */
export interface MarkdownTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

const isRow = (line: string | undefined): boolean => (line ?? '').trim().startsWith('|');
const isRule = (line: string | undefined): boolean => /^\|\s*:?-{3}/.test((line ?? '').trim());

/** Every table in a markdown file, in order, so tests can check the examples a page gives. */
export function markdownTables(path: string): MarkdownTable[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const tables: MarkdownTable[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isRow(lines[i]) || !isRule(lines[i + 1])) continue;
    const header = cells(lines[i] as string);
    const rows: string[][] = [];
    for (i += 2; isRow(lines[i]); i++) rows.push(cells(lines[i] as string));
    tables.push({ header, rows });
  }
  return tables;
}

/** The text of each `code span` in a cell. */
export function codeSpans(cell: string | undefined): string[] {
  return [...(cell ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
}
