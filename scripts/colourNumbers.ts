/**
 * Writes src/core/inventory/colourNumbers.ts: Rebrickable's and BrickLink's
 * colour numbers as LDraw colour codes, for reading parts lists.
 *
 *   bun scripts/colourNumbers.ts <rebrickable-colours.json> <LDConfig.ldr>
 *
 * The first file is Rebrickable's colour list with its cross-references, as
 * its API answers /api/v3/lego/colors/ ({ results: [...] }); the second is
 * LDraw's colour table, as in .ldraw-cache/ldraw after `bun run ldraw`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface RebrickableColour {
  readonly id: number;
  readonly name: string;
  readonly external_ids: Readonly<Record<string, { readonly ext_ids: readonly number[]; readonly ext_descrs?: readonly (readonly string[])[] }>>;
}

const OUT = join(import.meta.dir, '..', 'src', 'core', 'inventory', 'colourNumbers.ts');
/** Rebrickable's "[Unknown]" and "[No Color/Any Color]". */
const NOT_COLOURS = new Set([-1, 9999]);

/** The LDraw codes LDConfig.ldr defines, and the LEGO colour each one's note names. */
function readLDConfig(text: string): { readonly codes: ReadonlySet<number>; readonly byLego: ReadonlyMap<number, number> } {
  const codes = new Set<number>();
  const byLego = new Map<number, number>();
  let pending: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const note = /^0\s+\/\/\s*LEGOID\s+([\d\s/]+)\s+-/.exec(line);
    if (note?.[1]) {
      pending = note[1].split('/').map((s) => Number(s.trim())).filter(Number.isFinite);
      continue;
    }
    const definition = /^0\s+!COLOUR\s+\S+\s+CODE\s+(\d+)/.exec(line);
    if (!definition?.[1]) continue;
    const code = Number(definition[1]);
    codes.add(code);
    for (const lego of pending) if (!byLego.has(lego)) byLego.set(lego, code);
    pending = [];
  }
  return { codes, byLego };
}

/** Rows of [from, to] pairs, ten to a line. */
function rows(pairs: readonly (readonly [number, number])[]): string {
  const cells = pairs.map(([from, to]) => `[${from}, ${to}]`);
  const lines: string[] = [];
  for (let i = 0; i < cells.length; i += 10) lines.push(`  ${cells.slice(i, i + 10).join(', ')},`);
  return lines.join('\n');
}

function main([coloursFile, ldconfigFile]: readonly string[]): void {
  if (!coloursFile || !ldconfigFile) throw new Error('Usage: bun scripts/colourNumbers.ts <rebrickable-colours.json> <LDConfig.ldr>');
  const colours = (JSON.parse(readFileSync(coloursFile, 'utf8')) as { readonly results: readonly RebrickableColour[] }).results;
  const ldraw = readLDConfig(readFileSync(ldconfigFile, 'utf8'));

  // LDraw's own note of which LEGO colour a code is wins over Rebrickable's link to an LDraw code
  const ldrawCode = (colour: RebrickableColour): number | undefined => {
    const viaLego = (colour.external_ids.LEGO?.ext_ids ?? []).map((id) => ldraw.byLego.get(Number(id))).find((code) => code !== undefined);
    const code = viaLego ?? colour.external_ids.LDraw?.ext_ids[0];
    return code !== undefined && ldraw.codes.has(code) ? code : undefined;
  };

  const rebrickable: [number, number][] = [];
  const bricklink = new Map<number, { readonly code: number; readonly named: boolean }>();
  for (const colour of colours) {
    const code = ldrawCode(colour);
    if (NOT_COLOURS.has(colour.id) || code === undefined) continue;
    rebrickable.push([colour.id, code]);
    const links = colour.external_ids.BrickLink;
    (links?.ext_ids ?? []).forEach((id, i) => {
      // BrickLink files some colours under one number: it keeps the colour BrickLink names
      const named = (links?.ext_descrs?.[i]?.[0] ?? '').toLowerCase() === colour.name.toLowerCase();
      const held = bricklink.get(id);
      if (!held || (named && !held.named)) bricklink.set(id, { code, named });
    });
  }
  const byNumber = (a: readonly [number, number], b: readonly [number, number]): number => a[0] - b[0];
  const bricklinkPairs = [...bricklink].map(([id, { code }]): [number, number] => [id, code]).sort(byNumber);

  writeFileSync(
    OUT,
    `/**
 * Colour numbers of the two big part catalogues, Rebrickable and BrickLink,
 * as LDraw colour codes (the codes BrickBench's colours use).
 *
 * Taken from Rebrickable's colour list and its cross-references to LDraw,
 * BrickLink and LEGO. Where LDraw's own colour table (LDConfig.ldr) notes
 * which LEGO colour a code is, that code wins: it puts Rebrickable's Flat
 * Silver on LDraw's Flat_Silver (315), not Pearl_Silver. BrickLink files
 * some colours under one number (Pearl Titanium under Pearl Dark Gray); such
 * a number keeps the colour BrickLink names.
 *
 * Written by scripts/colourNumbers.ts; run it again when the catalogues add colours.
 */

/** Rebrickable colour id → LDraw colour code. */
export const REBRICKABLE_COLOURS: ReadonlyMap<number, number> = new Map([
${rows(rebrickable.sort(byNumber))}
]);

/** BrickLink colour id → LDraw colour code. */
export const BRICKLINK_COLOURS: ReadonlyMap<number, number> = new Map([
${rows(bricklinkPairs)}
]);
`,
  );
  console.log(`Wrote ${rebrickable.length} Rebrickable and ${bricklinkPairs.length} BrickLink colour numbers to ${OUT}.`);
}

main(process.argv.slice(2));
