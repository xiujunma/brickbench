import { describe, expect, it } from 'bun:test';
import { headersForEveryPath, parseHeaders } from './siteHeaders';

describe('site headers', () => {
  it('reads each path’s headers, skipping comments and blank lines', () => {
    const rules = parseHeaders('# a comment\n\n/*\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n\n/assets/*\n  Cache-Control: public, max-age=60\n');
    expect([...rules.keys()]).toEqual(['/*', '/assets/*']);
    expect(rules.get('/*')).toEqual({ 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    expect(rules.get('/assets/*')).toEqual({ 'Cache-Control': 'public, max-age=60' });
  });

  it('refuses a header with no path above it, or a line that is not a header', () => {
    expect(() => parseHeaders('  X-Frame-Options: DENY')).toThrow('_headers line 1 is not a header under a path: "X-Frame-Options: DENY"');
    expect(() => parseHeaders('/*\n  not a header')).toThrow('_headers line 2');
  });

  it('gives the site’s own headers for every path, with a security policy among them', () => {
    const headers = headersForEveryPath(new URL('../public/_headers', import.meta.url).pathname);
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    // the page connects to its own site only: the agent works only in the desktop app
    expect(headers['Content-Security-Policy']).toContain("connect-src 'self';");
    expect(headers['Content-Security-Policy']).not.toContain('127.0.0.1');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
