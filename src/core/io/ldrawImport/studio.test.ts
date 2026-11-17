import { describe, expect, it } from 'bun:test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/lib/zip-native.js';
import { STUDIO_PASSWORD, readStudioModel } from './studio';

const MODEL = '﻿0 FILE whale.io\r\n0 Untitled Model\r\n1 272 0 -8 -20 1 0 0 0 1 0 0 0 1 3034.dat\r\n';
const MB = 1024 * 1024;

async function archive(files: Readonly<Record<string, string>>, password?: string): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  for (const [name, text] of Object.entries(files)) {
    await writer.add(name, new TextReader(text), password ? { password, zipCrypto: true } : {});
  }
  return writer.close();
}

/** Rewrites the uncompressed size every header of a one-file archive claims. */
async function claimSize(blob: Blob, size: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  for (let at = 0; at + 4 <= bytes.length; at++) {
    const signature = view.getUint32(at, true);
    if (signature === 0x04034b50) view.setUint32(at + 22, size, true);
    if (signature === 0x02014b50) view.setUint32(at + 24, size, true);
  }
  return new Blob([bytes]);
}

describe('readStudioModel', () => {
  it('reads the model from a newer, unlocked Studio file', async () => {
    const io = await archive({ '.info': '{"version":"2.26.7_1"}', 'model.ldr': MODEL, 'model2.ldr': 'other' });
    const result = await readStudioModel(io, MB);
    expect(result).toEqual({ ok: true, value: MODEL.slice(1) });
  });

  it('reads the model from an older Studio file locked with the Studio password', async () => {
    const io = await archive({ 'model.ldr': MODEL }, STUDIO_PASSWORD);
    expect(await readStudioModel(io, MB)).toEqual({ ok: true, value: MODEL.slice(1) });
  });

  it('says so when a file is locked with another password', async () => {
    const io = await archive({ 'model.ldr': MODEL }, 'something else');
    expect(await readStudioModel(io, MB)).toEqual({ ok: false, error: 'This Studio file is locked with a password BrickBench does not know.' });
  });

  it('says so when there is no LDraw model inside', async () => {
    const io = await archive({ 'model.lxfml': '<LXFML/>' });
    expect(await readStudioModel(io, MB)).toEqual({ ok: false, error: 'This Studio file has no LDraw model in it.' });
  });

  it('refuses models over the size limit, even when the archive understates them', async () => {
    const big = `0 Big\r\n${'1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\r\n'.repeat(2000)}`;
    const io = await archive({ 'model.ldr': big });
    expect(await readStudioModel(io, 1000)).toEqual({ ok: false, error: 'This Studio model is too big to open (over 1 MB of LDraw).' });
    expect(await readStudioModel(await claimSize(io, 10), 1000)).toEqual({ ok: false, error: 'This Studio file is damaged (Invalid uncompressed size).' });
  });

  it('tells files that are not archives apart', async () => {
    expect(await readStudioModel(new Blob(['0 just LDraw text']), MB)).toEqual({ ok: false, error: 'This is not a Studio file BrickBench can read.' });
  });
});
