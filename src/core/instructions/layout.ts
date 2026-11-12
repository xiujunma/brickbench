/**
 * Page geometry for building-instruction booklets. Everything is in
 * millimetres on landscape pages, with the origin at the top-left.
 */
export type PageSize = 'a4' | 'letter';

export interface PageGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A part (part + colour key) and how many of it are needed. */
export interface PartCount {
  readonly key: string;
  readonly count: number;
}

const PAGES: Readonly<Record<PageSize, { readonly width: number; readonly height: number }>> = {
  a4: { width: 297, height: 210 },
  letter: { width: 279.4, height: 215.9 },
};

export const PAGE_MARGIN = 12;
/** Space at the bottom of a page for the footer line. */
export const FOOTER_HEIGHT = 7;

export function pageGeometry(size: PageSize): PageGeometry {
  return { ...PAGES[size], margin: PAGE_MARGIN };
}

/** Largest rectangle with the given aspect (width / height) that fits the box, centred in it. */
export function fitRect(aspect: number, box: Rect): Rect {
  if (aspect >= box.w / box.h) {
    const h = box.w / aspect;
    return { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h };
  }
  const w = box.h * aspect;
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h };
}

// ---- parts callout ------------------------------------------------------------

const CALLOUT_PAD = 4;
const CALLOUT_GAP = 3;
const CALLOUT_LABEL = 5;
const CALLOUT_THUMB = 14;
const CALLOUT_MIN_THUMB = 8;

export interface CalloutCell extends PartCount {
  readonly thumb: Rect;
  /** Centre of the baseline of the "2×" label under the part. */
  readonly label: Point;
}

export interface CalloutLayout {
  readonly box: Rect;
  readonly cells: readonly CalloutCell[];
}

/** Lays parts out in rows inside a box that grows down from `origin`. */
export function layoutCallout(items: readonly PartCount[], origin: Point, maxWidth: number, thumb = CALLOUT_THUMB): CalloutLayout {
  const columns = Math.max(1, Math.floor((maxWidth - 2 * CALLOUT_PAD + CALLOUT_GAP) / (thumb + CALLOUT_GAP)));
  const used = Math.max(1, Math.min(columns, items.length));
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const cellHeight = thumb + CALLOUT_LABEL;
  const cells = items.map((item, i): CalloutCell => {
    const x = origin.x + CALLOUT_PAD + (i % columns) * (thumb + CALLOUT_GAP);
    const y = origin.y + CALLOUT_PAD + Math.floor(i / columns) * (cellHeight + CALLOUT_GAP);
    return { ...item, thumb: { x, y, w: thumb, h: thumb }, label: { x: x + thumb / 2, y: y + thumb + CALLOUT_LABEL - 1.2 } };
  });
  return {
    box: {
      x: origin.x,
      y: origin.y,
      w: 2 * CALLOUT_PAD + used * thumb + (used - 1) * CALLOUT_GAP,
      h: 2 * CALLOUT_PAD + rows * cellHeight + (rows - 1) * CALLOUT_GAP,
    },
    cells,
  };
}

// ---- cover and step pages ----------------------------------------------------

/** Height of the title block at the top of the cover. */
export const COVER_HEADER = 28;
/** Width of the left column holding the step number and its parts. */
const STEP_COLUMN = 66;

/** Where the cover picture goes. */
export function coverImageArea(page: PageGeometry): Rect {
  return {
    x: page.margin,
    y: page.margin + COVER_HEADER,
    w: page.width - 2 * page.margin,
    h: page.height - 2 * page.margin - COVER_HEADER - FOOTER_HEIGHT,
  };
}

/** Where a step picture goes: everything right of the step column, above the footer. */
export function stepImageArea(page: PageGeometry): Rect {
  return {
    x: page.margin + STEP_COLUMN,
    y: page.margin,
    w: page.width - 2 * page.margin - STEP_COLUMN,
    h: page.height - 2 * page.margin - FOOTER_HEIGHT,
  };
}
const STEP_NUMBER_DROP = 14;
const CALLOUT_TOP = 20;

export interface StepPageLayout {
  /** Baseline-left of the big step number. */
  readonly number: Point;
  readonly callout: CalloutLayout;
  readonly image: Rect;
  /** Baseline of the footer line. */
  readonly footerY: number;
}

export function stepPageLayout(page: PageGeometry, items: readonly PartCount[], imageAspect: number): StepPageLayout {
  const top = page.margin;
  const calloutOrigin = { x: page.margin, y: top + CALLOUT_TOP };
  const room = page.height - page.margin - FOOTER_HEIGHT - calloutOrigin.y;
  // shrink the parts when a step needs many different ones
  let callout = layoutCallout(items, calloutOrigin, STEP_COLUMN - 4);
  for (let thumb = CALLOUT_THUMB - 1; callout.box.h > room && thumb >= CALLOUT_MIN_THUMB; thumb -= 1) {
    callout = layoutCallout(items, calloutOrigin, STEP_COLUMN - 4, thumb);
  }
  return {
    number: { x: page.margin, y: top + STEP_NUMBER_DROP },
    callout,
    image: fitRect(imageAspect, stepImageArea(page)),
    footerY: page.height - page.margin + 4,
  };
}

// ---- parts inventory ----------------------------------------------------------

const INVENTORY_TITLE = 18;
const INVENTORY_CELL_W = 40;
const INVENTORY_CELL_H = 37;
const INVENTORY_THUMB = 20;

export interface InventoryCell extends PartCount {
  readonly thumb: Rect;
  /** Centre of the count label baseline. */
  readonly label: Point;
  /** Centre of the first caption line (part name). */
  readonly caption: Point;
}

export interface InventoryPage {
  readonly cells: readonly InventoryCell[];
}

function inventoryGrid(page: PageGeometry): { columns: number; rows: number } {
  return {
    columns: Math.max(1, Math.floor((page.width - 2 * page.margin) / INVENTORY_CELL_W)),
    rows: Math.max(1, Math.floor((page.height - 2 * page.margin - INVENTORY_TITLE - FOOTER_HEIGHT) / INVENTORY_CELL_H)),
  };
}

/** Splits the parts list into pages of evenly spaced cells. */
export function inventoryPages(page: PageGeometry, items: readonly PartCount[]): InventoryPage[] {
  const { columns, rows } = inventoryGrid(page);
  const perPage = columns * rows;
  const pages: InventoryPage[] = [];
  for (let start = 0; start < items.length; start += perPage) {
    const cells = items.slice(start, start + perPage).map((item, i): InventoryCell => {
      const x = page.margin + (i % columns) * INVENTORY_CELL_W;
      const y = page.margin + INVENTORY_TITLE + Math.floor(i / columns) * INVENTORY_CELL_H;
      const centre = x + INVENTORY_CELL_W / 2;
      return {
        ...item,
        thumb: { x: centre - INVENTORY_THUMB / 2, y, w: INVENTORY_THUMB, h: INVENTORY_THUMB },
        label: { x: centre, y: y + INVENTORY_THUMB + 6.5 },
        caption: { x: centre, y: y + INVENTORY_THUMB + 10.8 },
      };
    });
    pages.push({ cells });
  }
  return pages;
}

/** Longest booklet we will make; beyond this the browser may run out of memory. */
export const MAX_PAGES = 400;

/**
 * Quick check before planning steps: even with every step full, would the
 * booklet run past MAX_PAGES?
 */
export function exceedsPageLimit(page: PageGeometry, bricks: number, partsPerStep: number, distinctParts: number): boolean {
  const fewestSteps = Math.ceil(bricks / Math.max(1, Math.floor(partsPerStep)));
  return pageCount(page, fewestSteps, distinctParts) > MAX_PAGES;
}

/** Pages in a booklet: cover, parts inventory, then one page per step. */
export function pageCount(page: PageGeometry, steps: number, distinctParts: number): number {
  const { columns, rows } = inventoryGrid(page);
  return 1 + Math.ceil(distinctParts / (columns * rows)) + steps;
}

// ---- text ---------------------------------------------------------------------

/** Characters of Windows-1252 outside the Latin-1 block; the PDF base fonts can show these too. */
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
/** Letters with no Unicode decomposition that still have an obvious plain form. */
const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ħ: 'H', ħ: 'h', ı: 'i', Ŀ: 'L', ŀ: 'l', Ŧ: 'T', ŧ: 't',
};

function isWinAnsi(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch);
}

/**
 * Keeps text inside what the PDF base fonts can draw: accents outside
 * Latin-1 are simplified ("ź" → "z") and anything else becomes "?".
 */
export function toPdfText(text: string): string {
  let out = '';
  // compose first, so "e" + combining acute becomes the Latin-1 "é"
  for (const ch of text.normalize('NFC')) {
    if (isWinAnsi(ch)) {
      out += ch;
      continue;
    }
    const plain = TRANSLITERATIONS[ch] ?? ch.normalize('NFKD').replace(/\p{M}/gu, '');
    out += plain.length > 0 && [...plain].every(isWinAnsi) ? plain : '?';
  }
  return out;
}
