import { describe, expect, it } from 'bun:test';
import { COLORS, COLOR_GROUPS, DEFAULT_COLOR_ID, getColor, isOpaqueColor } from './colors';

describe('colour palette', () => {
  it('uses unique LDraw codes', () => {
    const ids = COLORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses #RRGGBB values', () => {
    for (const color of COLORS) expect(color.hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('puts every colour in exactly one group', () => {
    const grouped = COLOR_GROUPS.flatMap((g) => g.colors.map((c) => c.id));
    const byCode = (a: number, b: number) => a - b;
    expect([...grouped].sort(byCode)).toEqual(COLORS.map((c) => c.id).sort(byCode));
  });

  it('looks colours up by code', () => {
    expect(getColor(4)?.name).toBe('Red');
    expect(getColor(-99)).toBeUndefined();
  });

  it('treats transparent colours as see-through and unknown codes as opaque', () => {
    expect(isOpaqueColor(47)).toBe(false);
    expect(isOpaqueColor(4)).toBe(true);
    expect(isOpaqueColor(12345)).toBe(true);
  });

  it('has a default colour in the palette', () => {
    expect(getColor(DEFAULT_COLOR_ID)).toBeDefined();
  });
});
