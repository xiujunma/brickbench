import { inflateSync } from 'node:zlib';
import { encode } from 'fast-png';
import { describe, expect, it } from 'bun:test';
import { BookletWriter, coverSubtitle, imageFormat, inventorySummary, type PartArt } from './bookletWriter';

function pngDataUrl(width = 6, height = 4): string {
  const bytes = encode({ width, height, data: new Uint8Array(width * height * 4).fill(180), channels: 4 });
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

/** The PDF byte for byte (TextDecoder's "latin1" is Windows-1252, which changes some bytes). */
async function pdfSource(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}

const pageObjects = (source: string) => source.match(/\/Type \/Page(?!s)/g) ?? [];

/** What each page draws: the PDF's page streams (compressed, unlike its pictures), inflated. */
function drawings(source: string): string[] {
  const streams = [...source.matchAll(/\bobj\s*(<<(?:(?!endobj)[\s\S])*?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  return streams
    .filter(([, dictionary = '']) => dictionary.includes('/FlateDecode') && !dictionary.includes('/Image'))
    .map(([, , data = '']) => inflateSync(Buffer.from(data, 'latin1')).toString('latin1'))
    .filter((stream) => / Do\b|\bTj\b/.test(stream));
}

const picturesDrawn = (page: string) => page.match(/ Do\b/g)?.length ?? 0;

const picture = pngDataUrl();
const parts: ReadonlyMap<string, PartArt> = new Map([
  ['brick-2x4|4', { image: picture, name: 'Brick 2 × 4', detail: 'Red · 3001' }],
  ['plate-1x1|1', { image: picture, name: 'Plate 1 × 1', detail: 'Blue · 3024' }],
]);
const meta = { title: 'Tiny house 🏠', pieces: 3, steps: 2, totalPages: 4, date: '2026-11-11' };

describe('BookletWriter', () => {
  it('writes a cover, the parts list and one page per step', async () => {
    const writer = await BookletWriter.create('a4', meta, parts);
    writer.addCover(picture, 1.5);
    writer.addInventory([
      { key: 'brick-2x4|4', count: 2 },
      { key: 'plate-1x1|1', count: 1 },
    ]);
    writer.addStep(1, picture, 1.2, [{ key: 'brick-2x4|4', count: 2 }]);
    writer.addStep(2, picture, 1.2, [{ key: 'plate-1x1|1', count: 1 }]);
    const source = await pdfSource(writer.finish());
    expect(source.startsWith('%PDF-')).toBe(true);
    expect(pageObjects(source)).toHaveLength(4);
  });

  it('names a sub-assembly over its steps, and draws no parts box for a step that only adds one', async () => {
    const writer = await BookletWriter.create('a4', meta, parts);
    writer.addStep(1, picture, 1.2, [{ key: 'brick-2x4|4', count: 2 }], 'Roof');
    writer.addStep(2, picture, 1.2, [], 'Add the Roof');
    writer.addStep(3, picture, 1.2, [{ key: 'plate-1x1|1', count: 1 }]);
    const pages = drawings(await pdfSource(writer.finish()));
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('(Roof) Tj');
    expect(pages[1]).toContain('(Add the Roof) Tj');
    expect(pages[2]).not.toContain('Roof');
    // the step's picture, and one for each kind of part in its box, on its rounded panel
    expect(pages.map(picturesDrawn)).toEqual([2, 1, 2]);
    expect(pages.map((page) => / c$/m.test(page))).toEqual([true, false, true]);
  });

  it('spreads a long parts list over several pages and uses US Letter when asked', async () => {
    // long names get shortened to fit their cell
    const name = (i: number) => `Part ${i} with a name far too long to fit under its picture`;
    const many = new Map([...Array.from({ length: 30 }, (_, i) => [`p${i}|4`, { image: picture, name: name(i), detail: '' }] as const)]);
    const writer = await BookletWriter.create('letter', { ...meta, totalPages: 3 }, many);
    writer.addCover(picture, 1.5);
    writer.addInventory([...many.keys()].map((key) => ({ key, count: 1 })));
    const source = await pdfSource(writer.finish());
    expect(pageObjects(source)).toHaveLength(3);
    // 11 × 8.5 in landscape, in points; jsPDF writes whole numbers as "792."
    expect(source).toMatch(/\/MediaBox \[0 0 792\.?\d* 612\.?\d*\]/);
  });

  it('names the PDF after the model', async () => {
    const writer = await BookletWriter.create('a4', meta, parts);
    writer.addCover(picture, 1.5);
    const source = await pdfSource(writer.finish());
    expect(source).toContain('/Title (Tiny house ?)');
  });
});

describe('wording', () => {
  it('counts pieces and steps in proper English', () => {
    expect(coverSubtitle({ ...meta, pieces: 1, steps: 1 })).toBe('Building instructions · 1 piece · 1 step');
    expect(coverSubtitle({ ...meta, pieces: 78, steps: 14 })).toBe('Building instructions · 78 pieces · 14 steps');
    expect(inventorySummary(1, 1)).toBe('1 piece · 1 kind');
    expect(inventorySummary(78, 27)).toBe('78 pieces · 27 kinds');
  });
});

describe('imageFormat', () => {
  it('reads the image type from a data URL', () => {
    expect(imageFormat('data:image/png;base64,AAAA')).toBe('PNG');
    expect(imageFormat('data:image/jpeg;base64,AAAA')).toBe('JPEG');
  });
});
