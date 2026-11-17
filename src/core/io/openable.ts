/** What File › Open reads: BrickBench's own models, LDraw models and BrickLink Studio files. */
export type OpenableKind = 'brickbench' | 'ldraw' | 'studio';

/** LDraw model files: single models, multi-part models, MLCad's, and models saved as parts. */
const LDRAW_EXTENSIONS = ['.ldr', '.mpd', '.l3b', '.dat'] as const;
const STUDIO_EXTENSION = '.io';

/** The endings of files File › Open reads. */
export const OPENABLE_EXTENSIONS = ['.brickbench.json', '.json', ...LDRAW_EXTENSIONS, STUDIO_EXTENSION] as const;

/** The file picker's filter for File › Open. */
export const OPEN_ACCEPT = [...OPENABLE_EXTENSIONS, 'application/json'].join(',');

/** Whether File › Open reads files with this name. */
export function isOpenableName(fileName: string): boolean {
  const name = fileName.toLowerCase();
  return OPENABLE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/** "PK\x03\x04": the start of a ZIP archive, as Studio files are. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
/** An LDraw line: a line type, a space, and more. */
const LDRAW_LINE = /^\s*[0-5]\s/;

/**
 * What kind of file this is, by its name, or by its first bytes (`head`)
 * when the name does not say: a renamed or extensionless download.
 */
export function openableKind(fileName: string, head: Uint8Array): OpenableKind {
  const name = fileName.toLowerCase();
  if (name.endsWith(STUDIO_EXTENSION)) return 'studio';
  if (LDRAW_EXTENSIONS.some((extension) => name.endsWith(extension))) return 'ldraw';
  if (name.endsWith('.json')) return 'brickbench';
  if (ZIP_MAGIC.every((byte, i) => head[i] === byte)) return 'studio';
  const text = new TextDecoder().decode(head).replace(/^﻿/, '');
  return LDRAW_LINE.test(text) ? 'ldraw' : 'brickbench';
}
