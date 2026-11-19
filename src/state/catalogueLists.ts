/**
 * File › Parts list › buying: the parts a model needs as a BrickLink wanted
 * list or a Rebrickable parts list. With the user's sets added, only what
 * they are missing; without, every part.
 */
import { brickLinkWantedList, rebrickableCsv, toCatalogue, type WantedLot } from '../core/inventory/catalogueExport';
import type { Catalogue } from '../core/inventory/read';
import { allotStock, ownedCounts } from '../core/inventory/stock';
import { slugify } from '../core/io/ldraw';
import { buildPartsList, type PartsListRow } from '../core/io/partsList';
import { LDRAW_PREFIX } from '../core/ldraw/catalogIndex';
import { getPart } from '../core/parts/catalog';
import { editorStore } from './editorStore';
import { saveText } from './files';
import { inventory } from './inventory';
import { partLibrary } from './library';
import { bricksOf } from './selectors';

interface CatalogueFormat {
  readonly name: string;
  readonly write: (lines: Parameters<typeof brickLinkWantedList>[0]) => string;
  readonly suffix: string;
  readonly type: string;
  readonly next: string;
}

const FORMATS: Readonly<Record<Catalogue, CatalogueFormat>> = {
  bricklink: {
    name: 'BrickLink',
    write: brickLinkWantedList,
    suffix: 'bricklink-wanted.xml',
    type: 'application/xml',
    next: 'upload it on BrickLink under Wanted › Upload',
  },
  rebrickable: {
    name: 'Rebrickable',
    write: rebrickableCsv,
    suffix: 'rebrickable-parts.csv',
    type: 'text/csv',
    next: 'import it into a parts list on Rebrickable',
  },
};

/** Left-out lots a message names before it just counts the rest. */
const LEFT_OUT_SHOWN = 3;

const lotOf = (row: PartsListRow, quantity: number): WantedLot[] =>
  row.ldraw !== null && quantity > 0 ? [{ part: row.ldraw.toLowerCase(), colour: row.colorId, quantity, label: `${row.partName} in ${row.colorName}` }] : [];

/** What to buy for the model: with the user's sets added, what they are missing; without, everything. */
export function wantedLots(): WantedLot[] {
  const rows = buildPartsList(bricksOf(editorStore.getState().history.present), getPart);
  const { lists } = inventory.store.getState();
  if (lists.length === 0) return rows.flatMap((row) => lotOf(row, row.quantity));
  return allotStock(rows, ownedCounts(lists), getPart).flatMap((row) => lotOf(row, row.missing));
}

/** Downloads the parts to buy in a catalogue's numbers and colours, saying what it could not include. */
export async function exportCatalogueList(catalogue: Catalogue): Promise<void> {
  const { name, toast } = editorStore.getState();
  const format = FORMATS[catalogue];
  const lots = wantedLots();
  if (lots.length === 0) {
    toast(inventory.store.getState().lists.length > 0 ? 'Your sets have every part this model needs.' : 'The model is empty.', 'info');
    return;
  }
  // library parts note the catalogues' numbers where they differ from LDraw's; without the library, LDraw's are used
  await partLibrary.load();
  const list = toCatalogue(lots, catalogue, (part) => getPart(`${LDRAW_PREFIX}${part}`)?.keywords ?? []);
  if (list.lines.length === 0) {
    toast(`${format.name} has none of the model's colours, so there is nothing to list.`, 'error');
    return;
  }
  const shown = list.leftOut.slice(0, LEFT_OUT_SHOWN).map((lot) => lot.label);
  const more = list.leftOut.length > LEFT_OUT_SHOWN ? ` and ${list.leftOut.length - LEFT_OUT_SHOWN} more` : '';
  const leftOut = list.leftOut.length > 0 ? ` Left out, in colours ${format.name} doesn't have: ${shown.join(', ')}${more}.` : '';
  saveText(format.write(list.lines), `${slugify(name)}-${format.suffix}`, format.type, `Downloaded ${list.lines.length} lots for ${format.name}: ${format.next}.${leftOut}`, toast);
}
