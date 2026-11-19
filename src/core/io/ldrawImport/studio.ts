/**
 * Reads the model out of a BrickLink Studio file (.io). An .io file is a
 * ZIP archive holding the model in standard LDraw as model.ldr, beside
 * Studio's own formats, instructions and a thumbnail. Studio locked the
 * archive with a fixed password until about 2024; newer files are open.
 */
import type { Result } from '../modelFile';

/** The password Studio locked .io files with, published on the LDraw wiki. */
export const STUDIO_PASSWORD = 'soho0909';
/** The archive member holding the model in standard LDraw. */
const MODEL_ENTRY = 'model.ldr';

/**
 * The LDraw text of the model in a Studio file, locked with Studio's
 * password or not. A model over `maxBytes` is refused before it is
 * unpacked; zip.js refuses archives that understate a member's size.
 */
export async function readStudioModel(file: Blob, maxBytes: number): Promise<Result<string>> {
  const zip = await import('@zip.js/zip.js/lib/zip-native.js');
  const reader = new zip.ZipReader(new zip.BlobReader(file), { password: STUDIO_PASSWORD, useWebWorkers: false, checkSignature: true });
  // a wrong password gets past ZipCrypto's one-byte check about one time in 256, then unpacks as garbage
  let locked = false;
  try {
    const entries = await reader.getEntries();
    const model = entries.find((entry) => entry.filename.toLowerCase() === MODEL_ENTRY);
    if (!model || model.directory) return { ok: false, error: 'This Studio file has no LDraw model in it.' };
    if (model.uncompressedSize > maxBytes) {
      return { ok: false, error: `This Studio model is too big to open (over ${Math.max(1, Math.round(maxBytes / 1024 / 1024))} MB of LDraw).` };
    }
    locked = model.encrypted;
    return { ok: true, value: await model.getData(new zip.TextWriter()) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (locked || message === zip.ERR_INVALID_PASSWORD || message === zip.ERR_ENCRYPTED || message === zip.ERR_UNSUPPORTED_ENCRYPTION) {
      return { ok: false, error: 'This Studio file is locked with a password BrickBench does not know.' };
    }
    if (message === zip.ERR_EOCDR_NOT_FOUND || message === zip.ERR_BAD_FORMAT) return { ok: false, error: 'This is not a Studio file BrickBench can read.' };
    return { ok: false, error: `This Studio file is damaged (${message}).` };
  } finally {
    await reader.close();
  }
}
