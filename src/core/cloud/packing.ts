/**
 * How a model travels to the site and back: its file, deflated and in
 * base64url, as a share link carries it (../io/shareLink.ts), and its
 * thumbnail, a JPEG, in base64url too.
 */
import type { Result } from '../io/modelFile';
import { deflate, fromBase64Url, inflate, toBase64Url } from '../io/shareLink';

/** Most a model kept online may unpack to: as big as a model file the editor opens. */
export const MAX_UNPACKED_BYTES = 20 * 1024 * 1024;

export async function packModel(text: string): Promise<string> {
  return toBase64Url(await deflate(text));
}

/** The model file a model online holds, or why it cannot be read. */
export async function unpackModel(data: string, limit = MAX_UNPACKED_BYTES): Promise<Result<string>> {
  const broken: Result<string> = { ok: false, error: 'The model online is damaged and cannot be opened.' };
  const bytes = fromBase64Url(data);
  if (bytes === null || bytes.length === 0) return broken;
  try {
    const text = await inflate(bytes, limit);
    return text === null ? { ok: false, error: 'The model online is too big to open.' } : { ok: true, value: text };
  } catch {
    return broken;
  }
}

const JPEG_DATA_URL = 'data:image/jpeg;base64,';

/** A JPEG data URL, as a canvas gives one, in base64url; null when it is not a JPEG. */
export function thumbnailFromDataUrl(url: string): string | null {
  if (!url.startsWith(JPEG_DATA_URL)) return null;
  return url.slice(JPEG_DATA_URL.length).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
