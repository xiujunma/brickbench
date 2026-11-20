import { describe, expect, it } from 'bun:test';
import { MAX_BRICKS as FILE_MAX_BRICKS } from '../io/modelFile';
import { packModel, thumbnailFromDataUrl, unpackModel } from './packing';
import { cleanName, MAX_BRICKS, MAX_MODEL_NAME, saveRequestSchema } from './protocol';

describe('names', () => {
  it('lose control characters and direction overrides, and close up their spaces', () => {
    expect(cleanName('  Red\u0000  castle\u202e ', 40)).toBe('Red castle');
    expect(cleanName('\u2066\u2069', 40)).toBe('');
    expect(cleanName('abcdef ghi', 7)).toBe('abcdef');
  });

  it('must show something: invisible characters alone make no name, while emoji keep their joiners', () => {
    expect(cleanName('\u200b\u3164\u2800', 40)).toBe('');
    expect(cleanName('\u200d \u200d', 40)).toBe('');
    expect(cleanName('Ada\u200b', 40)).toBe('Ada');
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
    expect(cleanName(family, 40)).toBe(family);
  });
});

describe('the protocol', () => {
  it('takes as many bricks as a model file holds', () => {
    expect(MAX_BRICKS).toBe(FILE_MAX_BRICKS);
  });

  it('cleans a saved model’s name and turns down an empty one', () => {
    const save = { bricks: 1, data: 'abc', thumbnail: null };
    expect(saveRequestSchema.parse({ ...save, name: ` ${'x'.repeat(200)}` }).name).toHaveLength(MAX_MODEL_NAME);
    expect(saveRequestSchema.safeParse({ ...save, name: '\u0007' }).success).toBe(false);
  });
});

describe('packing a model', () => {
  it('deflates its file into base64url and back', async () => {
    const text = JSON.stringify({ format: 'brickbench.model', bricks: Array.from({ length: 200 }, (_, i) => ({ part: 'brick-2x4', x: i })) });
    const packed = await packModel(text);
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(packed.length).toBeLessThan(text.length / 4);
    expect(await unpackModel(packed)).toEqual({ ok: true, value: text });
  });

  it('says when what comes back is damaged or would unpack too big', async () => {
    expect(await unpackModel('not base64!')).toEqual({ ok: false, error: 'The model online is damaged and cannot be opened.' });
    expect(await unpackModel('')).toMatchObject({ ok: false });
    expect(await unpackModel('AAAA')).toMatchObject({ ok: false, error: 'The model online is damaged and cannot be opened.' });
    expect(await unpackModel(await packModel('x'.repeat(5000)), 1000)).toEqual({ ok: false, error: 'The model online is too big to open.' });
  });

  it('takes a thumbnail from a canvas’s JPEG', () => {
    expect(thumbnailFromDataUrl('data:image/jpeg;base64,/9j/4A+/AA==')).toBe('_9j_4A-_AA');
    expect(thumbnailFromDataUrl('data:image/png;base64,iVBOR')).toBeNull();
  });
});
