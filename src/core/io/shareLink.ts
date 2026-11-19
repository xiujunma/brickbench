/**
 * Models carried in a link: the saved model, compressed and written into the
 * address's fragment (#model=1.…). Browsers never send the fragment to the
 * site, so a shared model goes from one person to the other and nowhere else.
 */
import type { Result } from './modelFile';

/** What starts a share link's fragment; the 1 is the format, for links that come later. */
export const SHARE_FRAGMENT = '#model=1.';
/** Longest link offered: past this, chat apps and mail cut links short. A file shares better. */
export const MAX_LINK_LENGTH = 16_000;
/** Most a shared model may unpack to, so a crafted link cannot exhaust the tab. */
export const MAX_SHARED_BYTES = 4 * 1024 * 1024;

const FORMAT = 'deflate-raw';
const BASE64URL = /^[A-Za-z0-9_-]*$/;
/** Bytes per call to String.fromCharCode, well within the arguments a call may take. */
const CHUNK = 0x8000;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The bytes base64url text holds, or null when it is not base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream(FORMAT));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Unpacks deflated text, stopping once it passes `limit` bytes; null when it does. */
async function inflate(bytes: Uint8Array, limit: number): Promise<string | null> {
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream(FORMAT)).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(read.value);
  }
  return new TextDecoder().decode(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
}

/** The fragment that carries a saved model (its file text). */
export async function shareFragment(modelText: string): Promise<string> {
  return `${SHARE_FRAGMENT}${toBase64Url(await deflate(modelText))}`;
}

/**
 * The model text a fragment carries; null when the fragment is not a share
 * link at all, and an error when it is one that cannot be read, most often
 * because it was cut short on the way.
 */
export async function readShareFragment(fragment: string, limit = MAX_SHARED_BYTES): Promise<Result<string> | null> {
  if (!fragment.startsWith(SHARE_FRAGMENT)) return null;
  const broken: Result<string> = { ok: false, error: 'This share link is broken, most likely cut short on the way. Ask for the model’s file instead.' };
  const bytes = fromBase64Url(fragment.slice(SHARE_FRAGMENT.length));
  if (bytes === null || bytes.length === 0) return broken;
  try {
    const text = await inflate(bytes, limit);
    return text === null ? { ok: false, error: 'The model in this share link is too big to open.' } : { ok: true, value: text };
  } catch {
    // the compressed data ends early or is not deflate data
    return broken;
  }
}
