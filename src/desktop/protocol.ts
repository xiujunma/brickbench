/**
 * What the desktop app (Electron, in electron/) and the page say to each
 * other. The main process sends menu commands and files to open; the page
 * says when it is ready for them. Shared by both sides, so it imports nothing.
 */

/** The scheme and host the desktop app serves BrickBench from: brickbench://app/index.html. */
export const APP_SCHEME = 'brickbench';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

export const CHANNELS = {
  /** main → page: a command chosen from the app menu. */
  menu: 'brickbench:menu',
  /** main → page: a file to open (from Finder or Explorer, or File › Open in the menu). */
  openFile: 'brickbench:open-file',
  /** page → main: the page listens now, so files waiting to open can come. */
  ready: 'brickbench:ready',
} as const;

/** Menu commands the page carries out, as its own File menu and keys do. */
export const MENU_COMMANDS = [
  'new',
  'open-sample',
  'save',
  'export-ldraw',
  'export-glb',
  'export-png',
  'instructions',
  'timelapse',
  'parts-list',
  'my-parts',
  'undo',
  'redo',
  'frame',
  'reset-view',
  'help',
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

/** A file the desktop app hands the page to open. */
export interface OpenFilePayload {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Largest file the desktop app hands over: as large as File › Open takes in the page. */
export const MAX_OPEN_BYTES = 64 * 1024 * 1024;

/** What the desktop app's preload script gives the page, as window.brickbench. */
export interface DesktopApi {
  /** Calls `listener` for each menu command; returns a function that stops listening. */
  onMenuCommand(listener: (command: unknown) => void): () => void;
  /** Calls `listener` for each file to open; returns a function that stops listening. */
  onOpenFile(listener: (payload: unknown) => void): () => void;
  /** Tells the app the page is listening. */
  ready(): void;
}

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value);
}

/** The file in a payload from the app, or null for anything else: messages are checked, not trusted. */
export function toOpenFile(payload: unknown): File | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { name, data } = payload as { readonly name?: unknown; readonly data?: unknown };
  if (typeof name !== 'string' || name.length === 0 || name.length > 255 || /[\\/]/.test(name)) return null;
  if (!(data instanceof Uint8Array) || data.byteLength > MAX_OPEN_BYTES) return null;
  return new File([data as Uint8Array<ArrayBuffer>], name);
}

/**
 * Wires the page to the desktop app: menu commands to `run`, files to
 * `openFile`. Anything malformed is dropped. Returns a function that stops.
 */
export function connectDesktop(api: DesktopApi, actions: { readonly run: (command: MenuCommand) => void; readonly openFile: (file: File) => void }): () => void {
  const stopMenu = api.onMenuCommand((command) => {
    if (isMenuCommand(command)) actions.run(command);
  });
  const stopFiles = api.onOpenFile((payload) => {
    const file = toOpenFile(payload);
    if (file) actions.openFile(file);
  });
  api.ready();
  return () => {
    stopMenu();
    stopFiles();
  };
}
