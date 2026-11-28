import { describe, expect, it } from 'bun:test';
import { isLocalHost } from './origins';

describe('who may use the bridge', () => {
  it('answers only requests addressed to this machine', () => {
    expect(isLocalHost('127.0.0.1:7425')).toBe(true);
    expect(isLocalHost('localhost:7425')).toBe(true);
    expect(isLocalHost('[::1]:7425')).toBe(true);
    // a DNS-rebinding page sends its own name
    expect(isLocalHost('evil.example:7425')).toBe(false);
    expect(isLocalHost('localhost.evil.example:7425')).toBe(false);
    expect(isLocalHost('bad host')).toBe(false);
    expect(isLocalHost(null)).toBe(false);
  });
});
