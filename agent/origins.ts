/**
 * Who may talk to the bridge. It listens on this machine only, but any web
 * page can try a localhost address under a name of its own (DNS rebinding),
 * so the Host header must name this machine. Web pages are kept out
 * altogether by the bridge itself: they send an Origin, agents do not.
 */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    // not a URL at all
    return null;
  }
}

/** Whether a request was addressed to this machine by name or address. */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const url = parseUrl(`http://${host}`);
  return url !== null && LOCAL_HOSTS.has(url.hostname);
}
