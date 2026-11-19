import { describe, expect, it } from 'bun:test';
import { fromBase64Url, readShareFragment, SHARE_FRAGMENT, shareFragment, toBase64Url } from './shareLink';

const MODEL = JSON.stringify({
  format: 'brickbench.model',
  version: 1,
  name: 'Tower “one” ✓',
  bricks: Array.from({ length: 400 }, (_, i) => ({ part: 'brick-2x4', color: 4, x: (i % 10) * 4, y: Math.floor(i / 10) * 3, z: 0, r: 0 })),
});

describe('share links', () => {
  it('carry a model in a compact fragment, and give it back as it was', async () => {
    const fragment = await shareFragment(MODEL);
    expect(fragment.startsWith(SHARE_FRAGMENT)).toBe(true);
    expect(fragment).toMatch(/^#model=1\.[A-Za-z0-9_-]+$/);
    expect(fragment.length).toBeLessThan(MODEL.length / 10);
    expect(await readShareFragment(fragment)).toEqual({ ok: true, value: MODEL });
  });

  it('leave other fragments alone', async () => {
    expect(await readShareFragment('')).toBeNull();
    expect(await readShareFragment('#parts')).toBeNull();
    expect(await readShareFragment('#model=2.abc')).toBeNull();
  });

  it('say a link cut short or mangled on the way is broken', async () => {
    const fragment = await shareFragment(MODEL);
    const broken = { ok: false as const, error: expect.stringContaining('This share link is broken') as string };
    expect(await readShareFragment(fragment.slice(0, fragment.length - 40))).toEqual(broken);
    expect(await readShareFragment(`${SHARE_FRAGMENT}not base64!`)).toEqual(broken);
    expect(await readShareFragment(SHARE_FRAGMENT)).toEqual(broken);
    expect(await readShareFragment(`${SHARE_FRAGMENT}${toBase64Url(new TextEncoder().encode('plain text, not deflated'))}`)).toEqual(broken);
  });

  it('refuse a model that unpacks to more than a tab should hold', async () => {
    const fragment = await shareFragment('x'.repeat(100_000));
    expect(await readShareFragment(fragment, 10_000)).toEqual({ ok: false, error: 'The model in this share link is too big to open.' });
  });
});

describe('base64url', () => {
  it('round-trips any bytes, long runs included, without padding or unsafe characters', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7919) % 256);
    const text = toBase64Url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64Url(text)).toEqual(bytes);
    expect(fromBase64Url(toBase64Url(Uint8Array.of(251, 255)))).toEqual(Uint8Array.of(251, 255));
  });

  it('turns down text that cannot be base64url', () => {
    expect(fromBase64Url('a+b/')).toBeNull();
    expect(fromBase64Url('abcde')).toBeNull();
  });
});
