import { partNumbersOf } from '../core/inventory/match';
import { MAX_LIST_BYTES, PartsListError, readPartsList, type PartsListFile } from '../core/inventory/read';
import { PARTS } from '../core/parts/catalog';
import { editorStore } from './editorStore';
import { pickFile } from './files';
import { inventory, isStorable, listSize, MAX_LISTS, nameFromFile, ownedListFrom } from './inventory';
import { partLibrary } from './library';

/** Rebrickable CSV, BrickLink XML and BrickStore files. */
const ACCEPT = '.csv,.xml,.bsx,.txt,text/csv,text/xml,application/xml';

/** A random id; crypto.getRandomValues also works where randomUUID does not (plain http). */
function newListId(): string {
  return [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readFile(file: File): Promise<PartsListFile | string> {
  if (file.size > MAX_LIST_BYTES) return 'That file is too large to be a parts list.';
  try {
    return readPartsList(await file.text());
  } catch (error: unknown) {
    if (error instanceof PartsListError) return error.message;
    return `Could not read the file: ${error instanceof Error ? error.message : 'something went wrong'}`;
  }
}

const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** What a list left out before matching: minifigures and the like, and lines that could not be read. */
function leftOutNote(read: PartsListFile): string | null {
  const notes = [
    read.notParts > 0 ? count(read.notParts, 'minifigure, set or alternate', 'minifigures, sets or alternates') : null,
    read.unreadable > 0 ? count(read.unreadable, 'line that could not be read', 'lines that could not be read') : null,
  ].filter(Boolean);
  return notes.length > 0 ? `Left out ${notes.join(' and ')}.` : null;
}

/** Reads a parts list file, matches it to BrickBench's parts (the library's included) and keeps it. */
export async function addPartsListFile(file: File): Promise<void> {
  const { toast } = editorStore.getState();
  if (inventory.store.getState().lists.length >= MAX_LISTS) {
    toast(`You have ${MAX_LISTS} parts lists, the most BrickBench keeps. Remove one to add another.`, 'error');
    return;
  }
  const read = await readFile(file);
  if (typeof read === 'string') {
    toast(read, 'error');
    return;
  }
  const library = await partLibrary.load();
  const ready = library.status === 'ready';
  const numbers = partNumbersOf(PARTS, ready ? library.entries : [], library.aliases);
  const { list, cut } = ownedListFrom(read, nameFromFile(file.name), numbers, newListId());
  const { usable, unusable } = listSize(list);
  if (usable === 0) {
    toast(
      ready
        ? `None of the parts in “${list.name}” are parts BrickBench has.`
        : `The parts library could not be loaded, so the parts in “${list.name}” could not be matched. Try again once it loads.`,
      'error',
    );
    return;
  }
  if (!isStorable(list)) {
    toast(`“${list.name}” is too large to keep.`, 'error');
    return;
  }
  const kept = inventory.addList(list);
  const missing = unusable > 0 ? ` ${unusable.toLocaleString('en')} more ${unusable === 1 ? 'is' : 'are'} not in BrickBench yet.` : '';
  toast(`Added ${usable.toLocaleString('en')} parts from “${list.name}”.${missing}`, 'success');
  const leftOut = leftOutNote(read);
  if (leftOut) toast(leftOut, 'info');
  if (cut) toast(`“${list.name}” is a very long list: only part of it was kept.`, 'info');
  if (!ready) toast('The parts library could not be loaded, so only basic parts were matched. The rest are matched again once it loads.', 'info');
  if (!kept) toast('Your parts could not be kept in this browser: they will be gone when BrickBench closes.', 'error');
}

export async function addPartsList(): Promise<void> {
  const file = await pickFile(ACCEPT);
  if (file) await addPartsListFile(file);
}
