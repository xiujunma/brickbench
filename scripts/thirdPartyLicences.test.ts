import { describe, expect, it } from 'bun:test';
import { bundledPackages, formatLicences, packageOf, readPackage, thirdPartyLicences, type PackageFiles } from './thirdPartyLicences';

/** Packages in memory: folder → files. */
function memory(packages: Readonly<Record<string, Readonly<Record<string, string>>>>): PackageFiles {
  return {
    read: (path) => {
      const at = path.lastIndexOf('/');
      const file = packages[path.slice(0, at)]?.[path.slice(at + 1)];
      if (file === undefined) throw new Error(`no file ${path}`);
      return file;
    },
    list: (dir) => Object.keys(packages[dir] ?? {}),
  };
}

const FILES = memory({
  '/app/node_modules/three': { 'package.json': '{"name":"three","version":"0.187.0","license":"MIT"}', LICENSE: 'MIT License\n\nCopyright three.js authors\n' },
  '/app/node_modules/@scope/pkg': { 'package.json': '{"name":"@scope/pkg","version":"1.0.0","license":{"type":"BSD-3-Clause"}}', 'LICENCE.md': 'BSD text', NOTICE: 'notice text' },
  '/app/node_modules/bare': { 'package.json': '{"name":"bare","version":"2.0.0"}', 'index.js': '' },
});

describe('third-party licences', () => {
  it('finds the package a module comes from, scoped or not, and none for the app’s own code', () => {
    expect(packageOf('/app/node_modules/three/build/three.module.js')).toEqual({ name: 'three', dir: '/app/node_modules/three' });
    expect(packageOf('\0/app/node_modules/@scope/pkg/dist/index.css?inline')).toEqual({ name: '@scope/pkg', dir: '/app/node_modules/@scope/pkg' });
    expect(packageOf('/app/node_modules/a/node_modules/b/index.js')).toEqual({ name: 'b', dir: '/app/node_modules/a/node_modules/b' });
    expect(packageOf('C:\\app\\node_modules\\three\\index.js')).toEqual({ name: 'three', dir: 'C:/app/node_modules/three' });
    expect(packageOf('/app/src/main.tsx')).toBeNull();
    expect(packageOf('/app/node_modules/')).toBeNull();
    expect(packageOf('/app/node_modules/@scope/')).toBeNull();
  });

  it('reads a package’s licence and every licence file it ships', () => {
    expect(readPackage('/app/node_modules/three', FILES)).toEqual({ name: 'three', version: '0.187.0', licence: 'MIT', text: 'MIT License\n\nCopyright three.js authors' });
    expect(readPackage('/app/node_modules/@scope/pkg', FILES)).toMatchObject({ licence: 'BSD-3-Clause', text: 'BSD text\n\nnotice text' });
    expect(readPackage('/app/node_modules/bare', FILES)).toEqual({ name: 'bare', version: '2.0.0', licence: 'unknown', text: null });
  });

  it('lists each bundled package once, by name, with its licence text', () => {
    const ids = ['/app/src/main.tsx', '/app/node_modules/three/a.js', '/app/node_modules/three/b.js', '/app/node_modules/bare/index.js'];
    const text = formatLicences(bundledPackages(ids, FILES));
    expect(text.startsWith('BrickBench includes code from these 2 packages.')).toBe(true);
    expect(text.indexOf('bare 2.0.0 (unknown)')).toBeLessThan(text.indexOf('three 0.187.0 (MIT)'));
    expect(text).toContain('Copyright three.js authors');
    expect(text).toContain('Licensed under unknown. The package includes no licence text.');
  });

  it('applies to builds only, writing the file from the packages the bundle holds', () => {
    const plugin = thirdPartyLicences();
    expect(plugin).toMatchObject({ name: 'brickbench:third-party-licences', apply: 'build' });
    type Emitted = { readonly fileName: string; readonly source: string };
    const generate = plugin.generateBundle as unknown as (
      this: { emitFile: (file: Emitted) => void },
      options: unknown,
      bundle: Readonly<Record<string, unknown>>,
    ) => void;
    const emitted: Emitted[] = [];
    const three = new URL('../node_modules/three/build/three.module.js', import.meta.url).pathname;
    generate.call({ emitFile: (file) => emitted.push(file) }, {}, {
      'index.js': { type: 'chunk', moduleIds: [three, '/app/src/main.tsx'] },
      'index.css': { type: 'asset' },
    });
    expect(emitted.map((file) => file.fileName)).toEqual(['third-party-licences.txt']);
    expect(emitted[0]?.source).toMatch(/three [\d.]+ \(MIT\)/);
  });
});
