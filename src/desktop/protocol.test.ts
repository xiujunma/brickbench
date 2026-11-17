import { describe, expect, it } from 'bun:test';
import { MAX_OPEN_BYTES, connectDesktop, isMenuCommand, toOpenFile, type DesktopApi, type MenuCommand } from './protocol';

/** A stand-in for the preload API that the test drives by hand. */
function fakeApi() {
  const menu = new Set<(command: unknown) => void>();
  const files = new Set<(payload: unknown) => void>();
  let readyCalls = 0;
  const api: DesktopApi = {
    onMenuCommand: (listener) => {
      menu.add(listener);
      return () => menu.delete(listener);
    },
    onOpenFile: (listener) => {
      files.add(listener);
      return () => files.delete(listener);
    },
    ready: () => {
      readyCalls += 1;
    },
  };
  return {
    api,
    sendMenu: (command: unknown) => menu.forEach((listener) => listener(command)),
    sendFile: (payload: unknown) => files.forEach((listener) => listener(payload)),
    listeners: () => menu.size + files.size,
    readyCalls: () => readyCalls,
  };
}

describe('isMenuCommand', () => {
  it('knows the commands the menu sends, and nothing else', () => {
    expect(isMenuCommand('save')).toBe(true);
    expect(isMenuCommand('undo')).toBe(true);
    expect(isMenuCommand('format-disk')).toBe(false);
    expect(isMenuCommand(3)).toBe(false);
  });
});

describe('toOpenFile', () => {
  it('turns a payload into a file', async () => {
    const file = toOpenFile({ name: 'wall.ldr', data: new TextEncoder().encode('0 Wall') });
    expect(file?.name).toBe('wall.ldr');
    expect(await file?.text()).toBe('0 Wall');
  });

  it('drops anything malformed, oversized or named like a path', () => {
    const data = new Uint8Array(4);
    for (const payload of [null, 'wall.ldr', { name: 'wall.ldr' }, { name: '', data }, { name: '../wall.ldr', data }, { name: 'a\\b.ldr', data }, { name: 'x'.repeat(256), data }, { name: 'wall.ldr', data: [1, 2] }]) {
      expect(toOpenFile(payload)).toBeNull();
    }
    const big = new Uint8Array(1);
    Object.defineProperty(big, 'byteLength', { value: MAX_OPEN_BYTES + 1 });
    expect(toOpenFile({ name: 'big.ldr', data: big })).toBeNull();
  });
});

describe('connectDesktop', () => {
  it('runs menu commands, opens files, says it is ready, and stops when asked', () => {
    const fake = fakeApi();
    const ran: MenuCommand[] = [];
    const opened: string[] = [];
    const stop = connectDesktop(fake.api, { run: (command) => ran.push(command), openFile: (file) => opened.push(file.name) });
    expect(fake.readyCalls()).toBe(1);

    fake.sendMenu('save');
    fake.sendMenu('rm -rf');
    fake.sendFile({ name: 'whale.io', data: new Uint8Array([0x50, 0x4b]) });
    fake.sendFile({ name: 'nothing' });
    expect(ran).toEqual(['save']);
    expect(opened).toEqual(['whale.io']);

    stop();
    expect(fake.listeners()).toBe(0);
  });
});
