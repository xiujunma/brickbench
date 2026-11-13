/**
 * Who may talk to the bridge. It listens on this machine only, but any web
 * page can try a localhost address, so pages must come from this machine (or
 * be one of a list the user gives), and the Host header must name it, which
 * stops DNS rebinding.
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

/** Whether a page at this origin may connect: one served from this machine, or, given a list, only those. */
export function isAllowedOrigin(origin: string | null, only: readonly string[] = []): boolean {
  if (!origin) return false;
  if (only.length > 0) return only.includes(origin);
  const url = parseUrl(origin);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname);
}

/** Whether a request was addressed to this machine by name or address. */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const url = parseUrl(`http://${host}`);
  return url !== null && LOCAL_HOSTS.has(url.hostname);
}

/** The only origins to let in, from a comma-separated setting such as BRICKBENCH_AGENT_ORIGINS. */
export function parseOrigins(setting: string | undefined): string[] {
  return (setting ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => /^https?:\/\/[^/]+$/.test(origin));
}
