/**
 * Writes src/core/io/ldrawImport/colourTable.ts: every colour LDraw's
 * colour table defines, with its name, value and finish, so a model built
 * in colours outside BrickBench's palette opens in the nearest ones.
 *
 *   bun scripts/ldrawColours.ts .ldraw-cache/ldraw/LDConfig.ldr
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Kind = 'solid' | 'transparent' | 'metallic';

const OUT = join(import.meta.dir, '..', 'src', 'core', 'io', 'ldrawImport', 'colourTable.ts');
/** "The colour of whatever holds me" and "my edge colour": not colours of their own. */
const PLACEHOLDERS = new Set([16, 24]);
const METALLIC = /\b(CHROME|PEARLESCENT|METAL|MATTE_METALLIC)\b/;

interface Row {
  readonly code: number;
  readonly name: string;
  readonly hex: string;
  readonly kind: Kind;
}

function kindOf(line: string): Kind {
  const alpha = /\bALPHA\s+(\d+)/.exec(line);
  if (alpha?.[1] && Number(alpha[1]) < 255) return 'transparent';
  return METALLIC.test(line) ? 'metallic' : 'solid';
}

function readRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})/.exec(line);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const code = Number(match[2]);
    if (PLACEHOLDERS.has(code)) continue;
    rows.push({ code, name: match[1].replace(/_/g, ' '), hex: `#${match[3].toUpperCase()}`, kind: kindOf(line) });
  }
  return rows.sort((a, b) => a.code - b.code);
}

function main([ldconfigFile]: readonly string[]): void {
  if (!ldconfigFile) throw new Error('Usage: bun scripts/ldrawColours.ts <LDConfig.ldr>');
  const rows = readRows(readFileSync(ldconfigFile, 'utf8'));
  if (rows.length === 0) throw new Error(`${ldconfigFile} defines no colours.`);
  const quote = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const body = rows.map((r) => `  [${r.code}, ${quote(r.name)}, '${r.hex}', '${r.kind}'],`).join('\n');
  writeFileSync(
    OUT,
    `/**
 * Every colour in LDraw's colour table (LDConfig.ldr): code, name, value and
 * finish. Written by scripts/ldrawColours.ts; do not edit by hand.
 */
export type LDrawColourKind = 'solid' | 'transparent' | 'metallic';

export const LDRAW_COLOURS: readonly (readonly [code: number, name: string, hex: string, kind: LDrawColourKind])[] = [
${body}
];
`,
  );
  console.log(`Wrote ${rows.length} colours to ${OUT}.`);
}

main(process.argv.slice(2));
