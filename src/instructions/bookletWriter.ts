import type { jsPDF } from 'jspdf';
import {
  coverImageArea,
  fitRect,
  inventoryPages,
  pageGeometry,
  stepPageLayout,
  toPdfText,
  type PageGeometry,
  type PageSize,
  type PartCount,
} from '../core/instructions/layout';

type Rgb = readonly [number, number, number];

const INK: Rgb = [29, 26, 22];
const MUTED: Rgb = [138, 130, 118];
const ACCENT: Rgb = [217, 72, 15];
/** Cool grey behind parts so white and light grey bricks still stand out on paper. */
const PANEL: Rgb = [232, 236, 240];
const PANEL_LINE: Rgb = [210, 217, 224];

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function coverSubtitle(meta: Pick<BookletMeta, 'pieces' | 'steps'>): string {
  return `Building instructions · ${count(meta.pieces, 'piece')} · ${count(meta.steps, 'step')}`;
}

export function inventorySummary(pieces: number, kinds: number): string {
  return `${count(pieces, 'piece')} · ${count(kinds, 'kind')}`;
}

/** jsPDF needs to be told each image's type; read it off the data URL. */
export function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
}

/** Picture and captions for one part-and-colour in the booklet. */
export interface PartArt {
  /** PNG data URL. */
  readonly image: string;
  readonly name: string;
  readonly detail: string;
}

export interface BookletMeta {
  readonly title: string;
  readonly pieces: number;
  readonly steps: number;
  readonly totalPages: number;
  readonly date: string;
}

/**
 * Writes a landscape building-instructions booklet page by page: a cover, the
 * parts list, then one page per step. jsPDF is loaded only when a booklet is made.
 */
export class BookletWriter {
  private pages = 0;

  private constructor(
    private readonly doc: jsPDF,
    private readonly page: PageGeometry,
    private readonly meta: BookletMeta,
    private readonly parts: ReadonlyMap<string, PartArt>,
  ) {}

  static async create(size: PageSize, meta: BookletMeta, parts: ReadonlyMap<string, PartArt>): Promise<BookletWriter> {
    const { jsPDF: Pdf } = await import('jspdf');
    const doc = new Pdf({ orientation: 'landscape', unit: 'mm', format: size, compress: true });
    doc.setProperties({ title: toPdfText(meta.title), subject: 'Building instructions', creator: 'BrickBench' });
    return new BookletWriter(doc, pageGeometry(size), meta, parts);
  }

  private newPage(): void {
    if (this.pages > 0) this.doc.addPage();
    this.pages += 1;
  }

  private style(size: number, weight: 'normal' | 'bold', color: Rgb): void {
    this.doc.setFont('helvetica', weight);
    this.doc.setFontSize(size);
    this.doc.setTextColor(color[0], color[1], color[2]);
  }

  /** Shortens text with an ellipsis until it fits `maxWidth` millimetres. */
  private fit(text: string, maxWidth: number): string {
    const safe = toPdfText(text);
    if (this.doc.getTextWidth(safe) <= maxWidth) return safe;
    let cut = safe;
    while (cut.length > 1 && this.doc.getTextWidth(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  }

  private footer(left: string): void {
    const { width, margin, height } = this.page;
    const y = height - margin + 4;
    this.style(7.5, 'normal', MUTED);
    this.doc.text(this.fit(left, width / 2), margin, y);
    this.doc.text(`${this.pages} / ${this.meta.totalPages}`, width - margin, y, { align: 'right' });
  }

  private panel(x: number, y: number, w: number, h: number, radius: number): void {
    this.doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
    this.doc.setDrawColor(PANEL_LINE[0], PANEL_LINE[1], PANEL_LINE[2]);
    this.doc.setLineWidth(0.3);
    this.doc.roundedRect(x, y, w, h, radius, radius, 'FD');
  }

  private partImage(key: string, x: number, y: number, size: number): void {
    const art = this.parts.get(key);
    if (art) this.doc.addImage(art.image, imageFormat(art.image), x, y, size, size, `part:${key}`);
  }

  addCover(hero: string, heroAspect: number): void {
    const { width, margin } = this.page;
    this.newPage();
    this.style(26, 'bold', INK);
    this.doc.text(this.fit(this.meta.title, width - 2 * margin), margin, margin + 10);
    this.style(11, 'normal', MUTED);
    this.doc.text(coverSubtitle(this.meta), margin, margin + 18);
    this.doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    this.doc.rect(margin, margin + 22, 16, 1.4, 'F');
    const image = fitRect(heroAspect, coverImageArea(this.page));
    this.doc.addImage(hero, imageFormat(hero), image.x, image.y, image.w, image.h, 'cover');
    this.footer(`Made with BrickBench · ${this.meta.date}`);
  }

  addInventory(items: readonly PartCount[]): void {
    const { width, margin } = this.page;
    const pages = inventoryPages(this.page, items);
    pages.forEach((inventory, index) => {
      this.newPage();
      this.style(16, 'bold', INK);
      this.doc.text(pages.length > 1 ? `Parts list (${index + 1}/${pages.length})` : 'Parts list', margin, margin + 7);
      this.style(9, 'normal', MUTED);
      this.doc.text(inventorySummary(this.meta.pieces, items.length), width - margin, margin + 7, { align: 'right' });
      for (const cell of inventory.cells) {
        const art = this.parts.get(cell.key);
        this.panel(cell.thumb.x - 5, cell.thumb.y - 2, cell.thumb.w + 10, cell.thumb.h + 4, 2);
        this.partImage(cell.key, cell.thumb.x, cell.thumb.y, cell.thumb.w);
        this.style(10, 'bold', INK);
        this.doc.text(`${cell.count}×`, cell.label.x, cell.label.y, { align: 'center' });
        this.style(6.8, 'normal', INK);
        this.doc.text(this.fit(art?.name ?? cell.key, 36), cell.caption.x, cell.caption.y, { align: 'center' });
        this.style(6, 'normal', MUTED);
        this.doc.text(this.fit(art?.detail ?? '', 36), cell.caption.x, cell.caption.y + 3.2, { align: 'center' });
      }
      this.footer(this.meta.title);
    });
  }

  addStep(number: number, image: string, imageAspect: number, items: readonly PartCount[]): void {
    this.newPage();
    const layout = stepPageLayout(this.page, items, imageAspect);
    this.style(40, 'bold', INK);
    this.doc.text(String(number), layout.number.x, layout.number.y);

    const box = layout.callout.box;
    this.panel(box.x, box.y, box.w, box.h, 2.5);
    this.style(9, 'bold', INK);
    for (const cell of layout.callout.cells) {
      this.partImage(cell.key, cell.thumb.x, cell.thumb.y, cell.thumb.w);
      this.doc.text(`${cell.count}×`, cell.label.x, cell.label.y, { align: 'center' });
    }

    this.doc.addImage(image, imageFormat(image), layout.image.x, layout.image.y, layout.image.w, layout.image.h, `step:${number}`);
    this.footer(`${this.meta.title} · step ${number} of ${this.meta.steps}`);
  }

  finish(): Blob {
    return this.doc.output('blob');
  }
}
