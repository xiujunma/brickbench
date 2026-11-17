import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { convertLibrary, keptAliases, writeLibraryFiles } from './convertLibrary.ts';
import { isSafeName } from './library.ts';
import { isCompleteBuild, MARKER, StagedOutput, writeInfo } from './output.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ldraw-out-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SOURCE = { url: 'https://example.org/complete.zip', sha256: 'abc' };

/** Builds a tiny library folder: one brick, one printed variant, one stud primitive. */
function makeLibrary(): string {
  const root = join(dir, 'ldraw');
  mkdirSync(join(root, 'parts'), { recursive: true });
  mkdirSync(join(root, 'p'), { recursive: true });
  const brick = ['0 Brick  1 x  1', '0 Author: Jane Doe [jdoe]', '0 !LDRAW_ORG Part UPDATE 2020-01', '0 BFC CERTIFY CCW',
    '4 16 -10 0 -10 10 0 -10 10 0 10 -10 0 10', '4 16 -10 24 -10 -10 24 10 10 24 10 10 24 -10', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat'];
  writeFileSync(join(root, 'parts', '3005.dat'), brick.join('\n'));
  writeFileSync(join(root, 'parts', '3005p01.dat'), ['0 Brick  1 x  1 with Smile Pattern', '0 !LDRAW_ORG Part'].join('\n'));
  writeFileSync(join(root, 'p', 'stud.dat'), ['0 Stud', '0 Author: James Jessiman', '0 BFC CERTIFY CCW', '3 16 -6 -4 0 6 -4 0 0 -4 6'].join('\n'));
  writeFileSync(join(root, 'CAreadme.txt'), 'licence');
  return root;
}

describe('converting a library folder', () => {
  it('writes a mesh per kept part, an index, credits and the licence', () => {
    const root = makeLibrary();
    const out = join(dir, 'out');
    mkdirSync(join(out, 'parts'), { recursive: true });
    const converted = convertLibrary(root, join(out, 'parts'), { only: null, limit: Infinity });
    writeLibraryFiles(out, root, converted, '2026-11-11T00:00:00Z');

    expect(converted.entries.map((e) => e.id)).toEqual(['3005']);
    expect(converted.entries[0]).toMatchObject({ name: 'Brick 1 × 1', author: 'Jane Doe', w: 1, d: 1, h: 3, snug: true });
    expect(converted.tally.counts.get('printed')).toBe(1);
    expect(existsSync(join(out, 'parts', '3005.bin'))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).parts).toHaveLength(1);
    const credits = readFileSync(join(out, 'CREDITS.txt'), 'utf8');
    expect(credits).toContain('parts/3005.dat\tBrick  1 x  1\tJane Doe');
    expect(credits).toContain('p/stud.dat\tStud\tJames Jessiman');
    expect(readFileSync(join(out, 'CAreadme.txt'), 'utf8')).toBe('licence');
  });

  it('lists the old numbers LDraw moved or aliased, followed to the parts it keeps', () => {
    const root = makeLibrary();
    // 3005a moved to 3005b, which moved on to 3005; 3005x is an alias drawing 3005; 3005z moved to a part left out
    writeFileSync(join(root, 'parts', '3005b.dat'), ['0 ~Moved to 3005', '0 !LDRAW_ORG Part'].join('\n'));
    writeFileSync(join(root, 'parts', '3005a.dat'), ['0 ~Moved to 3005B', '0 !LDRAW_ORG Part'].join('\n'));
    writeFileSync(join(root, 'parts', '3005x.dat'), ['0 =Brick  1 x  1', '0 !LDRAW_ORG Part Alias', '1 16 0 0 0 1 0 0 0 1 0 0 0 1 3005.dat'].join('\n'));
    writeFileSync(join(root, 'parts', '3005z.dat'), ['0 ~Moved to 3005p01', '0 !LDRAW_ORG Part'].join('\n'));
    writeFileSync(join(root, 'parts', '3005o.dat'), ['0 ~Brick  1 x  1 (Obsolete)', '0 !LDRAW_ORG Part'].join('\n'));
    const out = join(dir, 'out');
    mkdirSync(join(out, 'parts'), { recursive: true });
    const converted = convertLibrary(root, join(out, 'parts'), { only: null, limit: Infinity });
    writeLibraryFiles(out, root, converted, '2026-11-11T00:00:00Z');

    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).aliases).toEqual([
      ['3005a', '3005'],
      ['3005b', '3005'],
      ['3005x', '3005'],
    ]);
  });

  it('follows renames without looping, and leaves kept parts and dead ends out', () => {
    const loop = new Map([
      ['a', 'b'],
      ['b', 'a'],
      ['c', 'kept'],
      ['kept', 'other'],
    ]);
    expect(keptAliases(loop, new Set(['kept']))).toEqual([['c', 'kept']]);
  });

  it('writes no renames when LDraw has none', () => {
    const root = makeLibrary();
    const out = join(dir, 'out');
    mkdirSync(join(out, 'parts'), { recursive: true });
    writeLibraryFiles(out, root, convertLibrary(root, join(out, 'parts'), { only: null, limit: Infinity }), 'now');
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))).not.toHaveProperty('aliases');
  });

  it('can stop early or stick to chosen parts', () => {
    const root = makeLibrary();
    expect(convertLibrary(root, dir, { only: new Set(['9999']), limit: Infinity }).entries).toEqual([]);
    expect(convertLibrary(root, dir, { only: null, limit: 1 }).entries).toHaveLength(1);
  });

  it('never reads outside the library', () => {
    expect(isSafeName('s/3001s01.dat')).toBe(true);
    expect(isSafeName('48/4-4cyli.dat')).toBe(true);
    for (const name of ['../secret.dat', 's/../../x.dat', '/etc/passwd', 'c:/windows/x.dat', '']) expect(isSafeName(name), name).toBe(false);
  });
});

describe('staged library output', () => {
  function stage(out: string, partial = false, parts: readonly string[] = ['3005']): StagedOutput {
    const output = new StagedOutput(out);
    output.begin(SOURCE, partial);
    for (const id of parts) writeFileSync(join(output.staging, 'parts', `${id}.bin`), 'mesh');
    writeFileSync(join(output.staging, 'index.json'), JSON.stringify({ version: 1, parts: parts.map((id) => ({ id })) }));
    writeInfo(output.staging, { complete: true, partial, parts: parts.length, generated: 'now', source: SOURCE });
    return output;
  }

  it('replaces the library only once the new one is complete', () => {
    const out = join(dir, 'ldraw');
    stage(out).commit();
    expect(isCompleteBuild(out)).toBe(true);
    const second = stage(out, false, ['3001', '3005']);
    // until committed, the old library stays in place
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).parts).toHaveLength(1);
    second.commit();
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).parts).toHaveLength(2);
    expect(existsSync(`${out}.partial`)).toBe(false);
    expect(existsSync(`${out}.old`)).toBe(false);
  });

  it('does not count interrupted, partial or incomplete builds as complete', () => {
    const out = join(dir, 'ldraw');
    const interrupted = new StagedOutput(out);
    interrupted.begin(SOURCE, false);
    expect(isCompleteBuild(interrupted.staging)).toBe(false);
    interrupted.discard();
    expect(existsSync(interrupted.staging)).toBe(false);

    stage(out, true).commit();
    expect(isCompleteBuild(out)).toBe(false);

    stage(out).commit();
    rmSync(join(out, 'parts', '3005.bin'));
    expect(isCompleteBuild(out)).toBe(false);
  });

  it('refuses to replace or delete folders it did not build', () => {
    const out = join(dir, 'public');
    mkdirSync(out);
    writeFileSync(join(out, 'index.json'), '{}');
    expect(() => new StagedOutput(out).begin(SOURCE, false)).toThrow(/Refusing to overwrite/);

    const foreign = new StagedOutput(join(dir, 'other'));
    mkdirSync(foreign.staging);
    writeFileSync(join(foreign.staging, 'notes.txt'), 'mine');
    expect(() => foreign.discard()).toThrow(/Refusing to delete/);
    expect(existsSync(join(foreign.staging, MARKER))).toBe(false);
  });
});
