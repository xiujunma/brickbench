import type { MeshFinish } from '../../src/core/ldraw/format.ts';

/** A colour as a part fixes it: what it looks like and how it is finished. */
export interface LDrawColour {
  readonly hex: string;
  readonly finish: MeshFinish;
}

export type ColourTable = ReadonlyMap<number, LDrawColour>;

const DEFINITION = /^\s*0\s+!COLOUR\s+\S+\s+CODE\s+(\d+)\s+VALUE\s+#([0-9a-f]{6})\b(.*)$/i;
/** Codes the table does not know are drawn in a neutral grey. */
const UNKNOWN: LDrawColour = { hex: '#808080', finish: 'solid' };

/** Colours at least this opaque (of 255), such as milky white and glow-in-the-dark, are drawn solid. */
const NEARLY_OPAQUE = 224;

/** Translucent colours, chrome, then pearl for the other metallic looks: the app's finishes. */
function finishOf(attributes: string): MeshFinish {
  const alpha = /\bALPHA\s+(\d+)/i.exec(attributes);
  if (alpha && Number(alpha[1]) < NEARLY_OPAQUE) return 'transparent';
  if (/\bCHROME\b/i.test(attributes)) return 'chrome';
  if (/\b(PEARLESCENT|METAL|MATTE_METALLIC)\b/i.test(attributes)) return 'pearl';
  return 'solid';
}

/** Reads LDraw's colour definitions (LDConfig.ldr): every code, its colour and finish. */
export function readColourTable(text: string): ColourTable {
  const table = new Map<number, LDrawColour>();
  for (const line of text.split(/\r?\n/)) {
    const match = DEFINITION.exec(line);
    if (match?.[1] && match[2]) table.set(Number(match[1]), { hex: `#${match[2].toLowerCase()}`, finish: finishOf(match[3] ?? '') });
  }
  return table;
}

/**
 * A colour by its code: from the table, or for LDraw's direct colours
 * (0x2RRGGBB opaque, 0x3RRGGBB translucent) from the code itself.
 */
export function colourFor(table: ColourTable, code: number): LDrawColour {
  const known = table.get(code);
  if (known) return known;
  const kind = Math.floor(code / 0x1000000);
  if (kind === 2 || kind === 3) return { hex: `#${(code % 0x1000000).toString(16).padStart(6, '0')}`, finish: kind === 3 ? 'transparent' : 'solid' };
  return UNKNOWN;
}
