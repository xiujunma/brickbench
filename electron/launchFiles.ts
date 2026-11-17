import { isAbsolute, resolve } from 'node:path';
import { isOpenableName } from '../src/core/io/openable';

/**
 * The model files among a command line's arguments, as absolute paths.
 * Opening a file with BrickBench on Windows and Linux starts it (or a
 * second copy, which hands its arguments over) with the file's path.
 */
export function filesToOpen(argv: readonly string[], cwd: string): string[] {
  return argv.filter((arg) => !arg.startsWith('-') && isOpenableName(arg)).map((arg) => (isAbsolute(arg) ? arg : resolve(cwd, arg)));
}
