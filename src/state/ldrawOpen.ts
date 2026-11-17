/**
 * Opens LDraw models and BrickLink Studio files from File › Open. Loaded on
 * demand, with the importer and zip.js, when such a file is chosen.
 */
import { partNumbersOf } from '../core/inventory/match';
import { importLDraw, type ImportReport } from '../core/io/ldrawImport/importLDraw';
import { readStudioModel } from '../core/io/ldrawImport/studio';
import type { Result } from '../core/io/modelFile';
import { createIdFactory } from '../core/model/ids';
import { PARTS, getPart } from '../core/parts/catalog';
import type { StoreApi } from 'zustand/vanilla';
import { getEngine } from '../editor/engineRegistry';
import { setImportReport, type ShownImport } from './importReport';
import type { PartLibrary } from './library';
import type { EditorState } from './types';

/** Largest LDraw text, or Studio file, we will open: well over the 50,000 parts a model may have. */
export const MAX_LDRAW_BYTES = 64 * 1024 * 1024;
const importIds = createIdFactory('l');

/** What opening a file needs from the rest of the app: the editor, the parts library, and a way to ask before replacing the model. */
export interface OpenDependencies {
  readonly editor: StoreApi<EditorState>;
  readonly library: Pick<PartLibrary, 'load'>;
  /** Asks before the current model is replaced; true to go ahead. */
  readonly confirm: (prompt: string) => boolean;
}

function readModelText(file: File, kind: 'ldraw' | 'studio'): Promise<Result<string>> {
  if (kind === 'studio') return readStudioModel(file, MAX_LDRAW_BYTES);
  return file.text().then((value) => ({ ok: true, value }));
}

const hasMissingParts = (report: ImportReport): boolean => report.leftOut.some((group) => group.reason === 'missing');

/** Whether the report has more to say than "everything came in as it was". */
function worthShowing(report: ImportReport): boolean {
  return (
    report.placed < report.parts ||
    report.unreadable > 0 ||
    report.looping > 0 ||
    [report.plain, report.moved, report.squared, report.recoloured].some((list) => list.length > 0)
  );
}

function count(n: number): string {
  return n.toLocaleString('en');
}

function openedMessage(name: string, report: ImportReport): string {
  const parts = report.placed === report.parts ? `all ${count(report.parts)} parts` : `${count(report.placed)} of ${count(report.parts)} parts`;
  return `Opened “${name}”: ${parts} came in.`;
}

/**
 * Opens an LDraw or Studio file as the model, then reports what could not
 * come in. Nothing changes when the file cannot be read, when none of its
 * parts can come in, when the parts library failed to load and parts are
 * missing for it (the next try loads it again), or when the person keeps
 * the model they have.
 */
export async function openLDrawModel(file: File, kind: 'ldraw' | 'studio', deps: OpenDependencies): Promise<void> {
  const { toast, loadDocument, openDialog } = deps.editor.getState();
  const showReport = (shown: ShownImport): void => {
    setImportReport(shown);
    openDialog('import-report');
  };
  if (file.size > MAX_LDRAW_BYTES) {
    toast(`That file is too large to open (over ${MAX_LDRAW_BYTES / 1024 / 1024} MB).`, 'error');
    return;
  }
  const text = await readModelText(file, kind);
  if (!text.ok) {
    toast(text.error, 'error');
    return;
  }
  // every part the model names must be known before matching, or library parts would be left out
  const library = await deps.library.load();
  const numbers = partNumbersOf(PARTS, library.entries, library.aliases);
  const result = importLDraw(text.value, file.name, { lookup: getPart, numbers, nextId: importIds });
  if (!result.ok) {
    toast(result.error, 'error');
    return;
  }
  const { doc, report } = result.value;
  if (library.status === 'failed' && hasMissingParts(report)) {
    toast(`The parts library could not be loaded, so “${doc.name}” was not opened. Check your connection and try again.`, 'error');
    return;
  }
  const note = library.status === 'missing' && hasMissingParts(report) ? 'This copy of BrickBench was built without the LDraw parts library, so only its basic parts could come in.' : null;
  if (report.placed === 0) {
    toast(`None of the parts in “${doc.name}” could come in, so the current model stays.`, 'error');
    showReport({ name: doc.name, report, note });
    return;
  }
  const coverage = report.placed < report.parts ? ` ${count(report.placed)} of its ${count(report.parts)} parts can come in.` : '';
  if (!deps.confirm(`Open “${doc.name}”?${coverage}`)) return;
  loadDocument(doc);
  getEngine()?.frameAll();
  toast(openedMessage(doc.name, report), 'success');
  if (note || worthShowing(report)) showReport({ name: doc.name, report, note });
}
