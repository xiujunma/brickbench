import { describe, expect, it } from 'bun:test';
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../src/desktop/protocol';
import { menuTemplate, type MenuActions } from './menu';

function actions(platform: NodeJS.Platform, dev = false) {
  const calls: string[] = [];
  const value: MenuActions = {
    platform,
    dev,
    command: (command: MenuCommand) => calls.push(command),
    open: () => calls.push('open dialog'),
    openExternal: (url) => calls.push(url),
  };
  return { value, calls };
}

/** Every item in the menu, submenus included. */
function items(template: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? items(item.submenu) : [])]);
}

const click = (item: MenuItemConstructorOptions | undefined): void => {
  (item?.click as (() => void) | undefined)?.();
};

describe('menuTemplate', () => {
  it('sends commands to the page and asks for files itself', () => {
    const { value, calls } = actions('darwin');
    const all = items(menuTemplate(value));
    for (const id of ['new', 'save', 'export-ldraw', 'timelapse', 'undo', 'redo', 'frame', 'help', 'about', 'open']) click(all.find((item) => item.id === id));
    click(all.find((item) => item.label === 'LDraw Parts Library'));
    expect(calls).toEqual(['new', 'save', 'export-ldraw', 'timelapse', 'undo', 'redo', 'frame', 'help', 'about', 'open dialog', 'https://library.ldraw.org']);
  });

  it('keeps the keys the page uses: ⌘S, ⌘O and ⌘Z, and no single letters', () => {
    const all = items(menuTemplate(actions('darwin').value));
    expect(all.find((item) => item.id === 'save')?.accelerator).toBe('CmdOrCtrl+S');
    expect(all.find((item) => item.id === 'open')?.accelerator).toBe('CmdOrCtrl+O');
    expect(all.find((item) => item.id === 'undo')?.accelerator).toBe('CmdOrCtrl+Z');
    expect(all.find((item) => item.id === 'frame')?.accelerator).toBeUndefined();
    // text boxes on macOS need the native roles for these
    expect(all.filter((item) => item.role).map((item) => item.role)).toEqual(expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']));
  });

  it('follows each platform: an app menu on macOS, Quit in File elsewhere', () => {
    const mac = menuTemplate(actions('darwin').value);
    const windows = menuTemplate(actions('win32').value);
    expect(mac[0]?.role).toBe('appMenu');
    expect(items(mac).some((item) => item.role === 'close')).toBe(true);
    expect(windows[0]?.label).toBe('File');
    expect(items(windows).some((item) => item.role === 'quit')).toBe(true);
  });

  it('offers reloading and the developer tools only in development', () => {
    expect(items(menuTemplate(actions('linux').value)).some((item) => item.role === 'toggleDevTools')).toBe(false);
    expect(items(menuTemplate(actions('linux', true).value)).some((item) => item.role === 'toggleDevTools')).toBe(true);
  });
});
