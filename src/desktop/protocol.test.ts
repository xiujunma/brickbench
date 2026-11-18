import { describe, expect, it } from 'bun:test';
import { MAX_OPEN_BYTES, connectDesktop, desktopApi, isMenuCommand, savedNotice, toOpenFile, toSaved, type DesktopApi, type MenuCommand, type SavedPayload } from './protocol';

/** A stand-in for the preload API that the test drives by hand. */
function fakeApi() {
  const menu = new Set<(command: unknown) => void>();
  const files = new Set<(payload: unknown) => void>();
  const saves = new Set<(payload: unknown) => void>();
  let readyCalls = 0;
  const listenTo =
    (set: Set<(value: unknown) => void>) =>
    (listener: (value: unknown) => void): (() => void) => {
      set.add(listener);
      return () => set.delete(listener);
    };
  const api: DesktopApi = {
    onMenuCommand: listenTo(menu),
    onOpenFile: listenTo(files),
    onSaved: listenTo(saves),
    ready: () => {
      readyCalls += 1;
    },
  };
  return {
    api,
    sendMenu: (command: unknown) => menu.forEach((listener) => listener(command)),
    sendFile: (payload: unknown) => files.forEach((listener) => listener(payload)),
    sendSaved: (payload: unknown) => saves.forEach((listener) => listener(payload)),
    listeners: () => menu.size + files.size + saves.size,
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

describe('toSaved', () => {
  it('reads how a save went', () => {
    expect(toSaved({ name: 'house.brickbench.json', folder: 'Documents', state: 'completed' })).toEqual({ name: 'house.brickbench.json', folder: 'Documents', state: 'completed' });
    expect(toSaved({ name: 'house.brickbench.json', folder: '', state: 'cancelled' })).toEqual({ name: 'house.brickbench.json', folder: '', state: 'cancelled' });
  });

  it('drops anything malformed, or carrying a path rather than a name', () => {
    for (const payload of [null, 'saved', { name: '', folder: '', state: 'completed' }, { name: 'a.ldr', folder: '/Users/someone', state: 'completed' }, { name: 'a.ldr', folder: 'x', state: 'progressing' }, { name: 'a.ldr', state: 'completed' }]) {
      expect(toSaved(payload)).toBeNull();
    }
  });
});

describe('savedNotice', () => {
  it('says where a file went, or that it could not be saved, and nothing when the save was cancelled', () => {
    expect(savedNotice({ name: 'house.brickbench.json', folder: 'Documents', state: 'completed' })).toEqual({ message: 'Saved “house.brickbench.json” in Documents.', tone: 'success' });
    expect(savedNotice({ name: 'house.png', folder: '', state: 'completed' })).toEqual({ message: 'Saved “house.png”.', tone: 'success' });
    expect(savedNotice({ name: 'house.png', folder: '', state: 'interrupted' })).toEqual({ message: 'Could not save “house.png”.', tone: 'error' });
    expect(savedNotice({ name: 'house.png', folder: '', state: 'cancelled' })).toBeNull();
  });
});

describe('desktopApi', () => {
  it('finds the desktop app API only where the app put it', () => {
    const page = globalThis as { brickbench?: DesktopApi };
    expect(desktopApi()).toBeNull();
    const fake = fakeApi();
    page.brickbench = fake.api;
    try {
      expect(desktopApi()).toBe(fake.api);
    } finally {
      delete page.brickbench;
    }
  });
});

describe('connectDesktop', () => {
  it('runs menu commands, opens files, hears about saves, says it is ready, and stops when asked', () => {
    const fake = fakeApi();
    const ran: MenuCommand[] = [];
    const opened: string[] = [];
    const saved: SavedPayload[] = [];
    const stop = connectDesktop(fake.api, { run: (command) => ran.push(command), openFile: (file) => opened.push(file.name), saved: (result) => saved.push(result) });
    expect(fake.readyCalls()).toBe(1);

    fake.sendMenu('save');
    fake.sendMenu('rm -rf');
    fake.sendFile({ name: 'whale.io', data: new Uint8Array([0x50, 0x4b]) });
    fake.sendFile({ name: 'nothing' });
    fake.sendSaved({ name: 'house.brickbench.json', folder: 'Documents', state: 'completed' });
    fake.sendSaved({ name: 'house.brickbench.json', state: 'done' });
    expect(ran).toEqual(['save']);
    expect(opened).toEqual(['whale.io']);
    expect(saved).toEqual([{ name: 'house.brickbench.json', folder: 'Documents', state: 'completed' }]);

    stop();
    expect(fake.listeners()).toBe(0);
  });
});
