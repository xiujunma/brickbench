/**
 * Reads public/_headers, the response headers the hosted site sends (in
 * Cloudflare Pages' format: a path pattern, then indented "Name: value"
 * lines). `vite preview` sends the headers for every path ("/*"), so the
 * browser tests run under the hosted site's security policy.
 */
import { readFileSync } from 'node:fs';

export type HeaderRules = ReadonlyMap<string, Readonly<Record<string, string>>>;

/** Each path pattern's headers, in file order. Comments and blank lines are skipped. */
export function parseHeaders(text: string): HeaderRules {
  const rules = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.trimEnd();
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = {};
      rules.set(line, current);
      continue;
    }
    const header = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (!current || !header?.[1] || !header[2]) throw new Error(`_headers line ${n + 1} is not a header under a path: "${line.trim()}"`);
    current[header[1]] = header[2];
  }
  return rules;
}

/** The headers every response gets, from the "/*" rule of a _headers file. */
export function headersForEveryPath(path: string): Record<string, string> {
  return { ...(parseHeaders(readFileSync(path, 'utf8')).get('/*') ?? {}) };
}
