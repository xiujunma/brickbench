import { toLDraw, slugify } from '../core/io/ldraw';
import { parseDocument, serializeDocument, type ParsedDocument, type Result } from '../core/io/modelFile';
import { buildPartsList, partsListCsv } from '../core/io/partsList';
import { createIdFactory } from '../core/model/ids';
import { getPart } from '../core/parts/catalog';
import { getEngine } from '../editor/engineRegistry';
import { cottageSample } from '../samples/cottage';
import { editorStore } from './editorStore';
import { downloadBlob, downloadText, pickFile } from './files';
import { partLibrary, usesLibraryParts } from './library';
import { bricksOf } from './selectors';
import { discardBackup, readBackup } from './sessionBackup';

/** Largest model file we will read. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MODEL_EXTENSION = '.brickbench.json';
const importIds = createIdFactory('f');

function state() {
  return editorStore.getState();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export function saveModelFile(): void {
  const { name, history, settings, toast } = state();
  downloadText(serializeDocument({ name, model: history.present, settings }), `${slugify(name)}${MODEL_EXTENSION}`, 'application/json');
  toast('Model saved to your downloads.', 'success');
}

/** Parses a model, loading the LDraw library first if it uses library parts (or they would be dropped). */
async function parseModelText(text: string): Promise<Result<ParsedDocument>> {
  if (usesLibraryParts(text)) await partLibrary.load();
  return parseDocument(text, getPart, importIds);
}

function confirmReplace(prompt: string): boolean {
  return state().history.present.bricks.size === 0 || window.confirm(`${prompt} The current model will be replaced (save it first if you want to keep it).`);
}

function showDocument(parsed: ParsedDocument, message: string): void {
  const { loadDocument, toast } = state();
  loadDocument(parsed.doc);
  getEngine()?.frameAll();
  toast(message, 'success');
  for (const warning of parsed.warnings) toast(warning, 'info');
}

export async function openModelFile(): Promise<void> {
  const file = await pickFile(`${MODEL_EXTENSION},.json,application/json`);
  if (!file) return;
  const { toast } = state();
  if (file.size > MAX_FILE_BYTES) {
    toast('That file is too large to be a BrickBench model.', 'error');
    return;
  }
  try {
    const result = await parseModelText(await file.text());
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    if (!confirmReplace(`Open “${result.value.doc.name}”?`)) return;
    showDocument(result.value, `Opened “${result.value.doc.name}”.`);
  } catch (error: unknown) {
    toast(`Could not read the file: ${errorMessage(error)}`, 'error');
  }
}

/** Opens the copy kept when the last session could not be restored in full. */
export async function recoverEarlierSession(): Promise<void> {
  const { toast } = state();
  const text = readBackup();
  if (text === null) {
    discardBackup();
    toast('There is no earlier session to recover.', 'info');
    return;
  }
  const result = await parseModelText(text);
  if (!result.ok) {
    toast(`The earlier session could not be opened: ${result.error}`, 'error');
    return;
  }
  if (!confirmReplace('Open your earlier session?')) return;
  showDocument(result.value, `Recovered “${result.value.doc.name}”.`);
  if (result.value.skippedBricks === 0) discardBackup();
  else toast('Some bricks still could not be restored, so the copy is kept for another try.', 'error');
}

export function newModel(): void {
  const { history, newModel: reset } = state();
  if (history.present.bricks.size > 0 && !window.confirm('Start a new model? The current one will be cleared (save it first if you want to keep it).')) {
    return;
  }
  reset();
  getEngine()?.resetView();
}

export function openSample(): void {
  const { history, loadDocument, toast } = state();
  if (history.present.bricks.size > 0 && !window.confirm('Open the sample cottage? Your current model will be replaced (save it first if you want to keep it).')) {
    return;
  }
  loadDocument(cottageSample(importIds));
  getEngine()?.frameAll();
  toast('Opened the sample cottage. Have a look around, then make it your own.', 'success');
}

export function exportLDrawFile(): void {
  const { name, history, toast } = state();
  const { text, skipped } = toLDraw(name, history.present, getPart);
  downloadText(text, `${slugify(name)}.ldr`, 'text/plain');
  toast(skipped > 0 ? `Exported LDraw file (${skipped} bricks had no LDraw part).` : 'Exported LDraw file.', 'success');
}

export function exportPartsCsv(): void {
  const { name, history, toast } = state();
  downloadText(partsListCsv(buildPartsList(bricksOf(history.present), getPart)), `${slugify(name)}-parts.csv`, 'text/csv');
  toast('Parts list downloaded.', 'success');
}

export async function exportGlbFile(): Promise<void> {
  const { name, toast } = state();
  const engine = getEngine();
  if (!engine) {
    toast('The 3D view is not ready yet.', 'error');
    return;
  }
  try {
    downloadBlob(await engine.exportGlb(name), `${slugify(name)}.glb`);
    toast('Exported glTF model.', 'success');
  } catch (error: unknown) {
    toast(`glTF export failed: ${errorMessage(error)}`, 'error');
  }
}

export async function exportImage(): Promise<void> {
  const { name, toast } = state();
  const engine = getEngine();
  if (!engine) {
    toast('The 3D view is not ready yet.', 'error');
    return;
  }
  try {
    downloadBlob(await engine.capturePng(), `${slugify(name)}.png`);
    toast('Image saved.', 'success');
  } catch (error: unknown) {
    toast(`Could not capture the view: ${errorMessage(error)}`, 'error');
  }
}
