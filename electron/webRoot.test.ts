import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { resolveAppFile } from './webRoot';

const ROOT = '/opt/brickbench/web';

describe('resolveAppFile', () => {
  it('serves the app and its files from the web folder', () => {
    expect(resolveAppFile(ROOT, 'brickbench://app/')).toBe(join(ROOT, 'index.html'));
    expect(resolveAppFile(ROOT, 'brickbench://app/index.html')).toBe(join(ROOT, 'index.html'));
    expect(resolveAppFile(ROOT, 'brickbench://app/assets/index-abc.js?v=2#top')).toBe(join(ROOT, 'assets/index-abc.js'));
    expect(resolveAppFile(ROOT, 'brickbench://app/ldraw/parts/3626bp01.bin')).toBe(join(ROOT, 'ldraw/parts/3626bp01.bin'));
    expect(resolveAppFile(ROOT, 'brickbench://app/ldraw/parts/a%20b.bin')).toBe(join(ROOT, 'ldraw/parts/a b.bin'));
  });

  it('keeps paths that climb above the root at the root, as URLs do', () => {
    expect(resolveAppFile(ROOT, 'brickbench://app/../secret.txt')).toBe(join(ROOT, 'secret.txt'));
    expect(resolveAppFile(ROOT, 'brickbench://app/%2e%2e/secret.txt')).toBe(join(ROOT, 'secret.txt'));
  });

  it('serves nothing outside the folder, however the path is spelled', () => {
    for (const url of [
      'brickbench://app/assets/%2E%2E%2F%2E%2E%2Fsecret.txt',
      'brickbench://app/a/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd',
      'brickbench://app/..%5Csecret.txt',
      'brickbench://app/%00.js',
      'brickbench://app/%E0%A4%A',
    ]) {
      expect(resolveAppFile(ROOT, url)).toBeNull();
    }
  });

  it('serves only its own scheme and host', () => {
    expect(resolveAppFile(ROOT, 'brickbench://other/index.html')).toBeNull();
    expect(resolveAppFile(ROOT, 'https://app/index.html')).toBeNull();
    expect(resolveAppFile(ROOT, 'not a url')).toBeNull();
  });
});
