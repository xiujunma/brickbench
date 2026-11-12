import { describe, expect, it } from 'bun:test';
import {
  exceedsPageLimit,
  fitRect,
  inventoryPages,
  layoutCallout,
  pageGeometry,
  pageCount,
  stepPageLayout,
  toPdfText,
} from './layout';

describe('pageGeometry', () => {
  it('uses landscape A4 and US Letter sizes in millimetres', () => {
    expect(pageGeometry('a4')).toMatchObject({ width: 297, height: 210 });
    expect(pageGeometry('letter')).toMatchObject({ width: 279.4, height: 215.9 });
  });
});

describe('fitRect', () => {
  it('fits wide content to the width and centres it vertically', () => {
    expect(fitRect(2, { x: 10, y: 10, w: 100, h: 100 })).toEqual({ x: 10, y: 35, w: 100, h: 50 });
  });

  it('fits tall content to the height and centres it horizontally', () => {
    expect(fitRect(0.5, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });
});

describe('layoutCallout', () => {
  it('wraps parts into rows that fit the width', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ key: `p${i}`, count: i + 1 }));
    const callout = layoutCallout(items, { x: 12, y: 30 }, 60);
    const rows = new Set(callout.cells.map((cell) => cell.thumb.y));
    expect(rows.size).toBe(2);
    for (const cell of callout.cells) {
      expect(cell.thumb.x).toBeGreaterThanOrEqual(callout.box.x);
      expect(cell.thumb.x + cell.thumb.w).toBeLessThanOrEqual(callout.box.x + callout.box.w + 1e-9);
      expect(cell.label.y).toBeLessThanOrEqual(callout.box.y + callout.box.h);
    }
    expect(callout.box.w).toBeLessThanOrEqual(60);
  });

  it('shrinks the box around a single part', () => {
    const callout = layoutCallout([{ key: 'p', count: 2 }], { x: 0, y: 0 }, 60);
    expect(callout.box.w).toBeLessThan(40);
    expect(callout.cells).toHaveLength(1);
  });
});

describe('stepPageLayout', () => {
  it('puts the step number and parts on the left and the picture on the right', () => {
    const page = pageGeometry('a4');
    const layout = stepPageLayout(page, [{ key: 'a', count: 1 }], 1.6);
    expect(layout.image.x).toBeGreaterThan(layout.callout.box.x + layout.callout.box.w);
    expect(layout.image.x + layout.image.w).toBeLessThanOrEqual(page.width - page.margin + 1e-9);
    expect(layout.image.y + layout.image.h).toBeLessThanOrEqual(page.height - page.margin + 1e-9);
    expect(layout.number.y).toBeLessThan(layout.callout.box.y);
  });
});

describe('exceedsPageLimit', () => {
  it('rules out booklets that cannot fit even before planning steps', () => {
    const page = pageGeometry('a4');
    expect(exceedsPageLimit(page, 100, 6, 10)).toBe(false);
    expect(exceedsPageLimit(page, 10_000, 6, 10)).toBe(true);
    expect(exceedsPageLimit(page, 10_000, 40, 10)).toBe(false);
  });
});

describe('inventoryPages', () => {
  it('splits the parts list into full pages', () => {
    const page = pageGeometry('a4');
    const items = Array.from({ length: 50 }, (_, i) => ({ key: `p${i}`, count: 1 }));
    const pages = inventoryPages(page, items);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((p) => p.cells.map((c) => c.key))).toEqual(items.map((i) => i.key));
    for (const p of pages) {
      for (const cell of p.cells) expect(cell.thumb.y + cell.thumb.h).toBeLessThan(page.height - page.margin);
    }
  });

  it('counts the pages of a whole booklet', () => {
    const page = pageGeometry('a4');
    expect(pageCount(page, 12, 10)).toBe(1 + 1 + 12);
    expect(pageCount(page, 0, 0)).toBe(1);
  });
});

describe('toPdfText', () => {
  it('keeps text the PDF base fonts can show', () => {
    expect(toPdfText('Slope 45° 2 × 4 – “café”')).toBe('Slope 45° 2 × 4 – “café”');
  });

  it('joins decomposed accents before checking them', () => {
    expect(toPdfText('Cafe\u0301')).toBe('Café');
  });

  it('simplifies accents outside Latin-1 and replaces what is left', () => {
    expect(toPdfText('Łódź castle 🏰 城')).toBe('Lódz castle ? ?');
  });
});
