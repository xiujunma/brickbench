import { describe, expect, it } from 'bun:test';
import { isAllowedOrigin, isLocalHost, parseOrigins } from './origins';

describe('who may use the bridge', () => {
  it('lets in pages served from this machine', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost:4173')).toBe(true);
    expect(isAllowedOrigin('https://localhost')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:5173')).toBe(true);
  });

  it('keeps out other sites, odd schemes and pages that give no origin', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false);
    expect(isAllowedOrigin('file://localhost')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
  });

  it('given a list, lets in only those pages', () => {
    const only = parseOrigins(' http://localhost:5173 , nonsense, https://bench.local ,');
    expect(only).toEqual(['http://localhost:5173', 'https://bench.local']);
    expect(isAllowedOrigin('http://localhost:5173', only)).toBe(true);
    expect(isAllowedOrigin('https://bench.local', only)).toBe(true);
    // another local server is no longer enough
    expect(isAllowedOrigin('http://localhost:3000', only)).toBe(false);
    expect(parseOrigins(undefined)).toEqual([]);
  });

  it('answers only requests addressed to this machine', () => {
    expect(isLocalHost('127.0.0.1:7425')).toBe(true);
    expect(isLocalHost('localhost:7425')).toBe(true);
    expect(isLocalHost('[::1]:7425')).toBe(true);
    // a DNS-rebinding page sends its own name
    expect(isLocalHost('evil.example:7425')).toBe(false);
    expect(isLocalHost('bad host')).toBe(false);
    expect(isLocalHost(null)).toBe(false);
  });
});
