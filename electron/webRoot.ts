import { isAbsolute, join, relative, sep } from 'node:path';
import { APP_HOST, APP_SCHEME } from '../src/desktop/protocol';

/**
 * The file a brickbench://app/… request asks for, inside `root` (the built
 * web app), or null when it asks for anything else: another host, or a path
 * that would lead out of the folder, however it is spelled.
 */
export function resolveAppFile(root: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    // a malformed %-escape
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const file = join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));
  const inside = relative(root, file);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  return file;
}
