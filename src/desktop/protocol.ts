/**
 * What the desktop app (Electron, in electron/) and the page say to each
 * other. The main process sends menu commands, files to open and where saved
 * files went; the page says when it is ready for them. The Agent panel talks
 * to the agent bridge the app runs, as a browser does over a WebSocket.
 * Shared by both sides, so it imports nothing.
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
  /** main → page: how a file the page saved fared in the Save dialog. */
  saved: 'brickbench:saved',
  /** page → main: connect the Agent panel to the app's agent bridge, starting it. */
  agentOpen: 'brickbench:agent-open',
  /** page → main: a message for the bridge. */
  agentSend: 'brickbench:agent-send',
  /** page → main: disconnect, which stops the bridge. */
  agentClose: 'brickbench:agent-close',
  /** main → page: the bridge's side of the link (AgentLinkEvent). */
  agentEvent: 'brickbench:agent-event',
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
  'about',
] as const;

export type MenuCommand = (typeof MENU_COMMANDS)[number];

/** A file the desktop app hands the page to open. */
export interface OpenFilePayload {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Largest file the desktop app hands over: as large as File › Open takes in the page. */
export const MAX_OPEN_BYTES = 64 * 1024 * 1024;

/** How a save went, as Electron reports a download: saved, cancelled in the Save dialog, or failed. */
export const SAVE_STATES = ['completed', 'cancelled', 'interrupted'] as const;

/** Where a file the page saved went: its name, the folder it is in, and how the save went. */
export interface SavedPayload {
  readonly name: string;
  /** The folder's own name ("Documents"), "" when nothing was saved. */
  readonly folder: string;
  readonly state: (typeof SAVE_STATES)[number];
}

/**
 * What the app's agent bridge tells the page: a connection is open, a
 * message for it, or it has closed. Each names the connection it is for, so
 * nothing meant for one the page has let go of reaches the next.
 */
export type AgentLinkEvent =
  | { readonly type: 'open'; readonly id: string }
  | { readonly type: 'message'; readonly id: string; readonly data: string }
  | { readonly type: 'close'; readonly id: string };

/** The longest message either way: a picture of the model fits. */
export const MAX_AGENT_MESSAGE = 16 * 1024 * 1024;

/** A connection's id: made by the page, short. */
export function isConnectionId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value);
}

/** An event from the app's agent bridge, or null for anything malformed. */
export function toAgentLinkEvent(value: unknown): AgentLinkEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, id, data } = value as { readonly type?: unknown; readonly id?: unknown; readonly data?: unknown };
  if (!isConnectionId(id)) return null;
  if (type === 'open' || type === 'close') return { type, id };
  return type === 'message' && typeof data === 'string' && data.length <= MAX_AGENT_MESSAGE ? { type, id, data } : null;
}

/** The Agent panel's link to the agent bridge the desktop app runs, one connection (named by the page) at a time. */
export interface DesktopAgentApi {
  /** Connects, starting the bridge; an "open" event follows, or "close" if it could not start. */
  open(id: string): void;
  send(id: string, text: string): void;
  /** Disconnects, which stops the bridge. */
  close(id: string): void;
  /** Calls `listener` with each event from the bridge; returns a function that stops listening. */
  onEvent(listener: (event: unknown) => void): () => void;
}

/** What the desktop app's preload script gives the page, as window.brickbench. */
export interface DesktopApi {
  readonly agent: DesktopAgentApi;
  /** Calls `listener` for each menu command; returns a function that stops listening. */
  onMenuCommand(listener: (command: unknown) => void): () => void;
  /** Calls `listener` for each file to open; returns a function that stops listening. */
  onOpenFile(listener: (payload: unknown) => void): () => void;
  /** Calls `listener` each time a save is done with; returns a function that stops listening. */
  onSaved(listener: (payload: unknown) => void): () => void;
  /** Tells the app the page is listening. */
  ready(): void;
}

/** The desktop app's API when the page runs in it (its preload script puts it there), else null. */
export function desktopApi(): DesktopApi | null {
  return (globalThis as { readonly brickbench?: DesktopApi }).brickbench ?? null;
}

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && (MENU_COMMANDS as readonly string[]).includes(value);
}

/** A file or folder name, not a path. */
const isName = (value: unknown, allowEmpty = false): value is string =>
  typeof value === 'string' && value.length <= 255 && (allowEmpty || value.length > 0) && !/[\\/]/.test(value);

/** The file in a payload from the app, or null for anything else: messages are checked, not trusted. */
export function toOpenFile(payload: unknown): File | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { name, data } = payload as { readonly name?: unknown; readonly data?: unknown };
  if (!isName(name)) return null;
  if (!(data instanceof Uint8Array) || data.byteLength > MAX_OPEN_BYTES) return null;
  return new File([data as Uint8Array<ArrayBuffer>], name);
}

/** How a save went, from a payload from the app, or null for anything malformed. */
export function toSaved(payload: unknown): SavedPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { name, folder, state } = payload as { readonly name?: unknown; readonly folder?: unknown; readonly state?: unknown };
  if (!isName(name) || !isName(folder, true) || !(SAVE_STATES as readonly unknown[]).includes(state)) return null;
  return { name, folder, state: state as SavedPayload['state'] };
}

/** What to tell the person about a save: where the file went, or that it failed; nothing when they cancelled it themselves. */
export function savedNotice(saved: SavedPayload): { readonly message: string; readonly tone: 'success' | 'error' } | null {
  if (saved.state === 'cancelled') return null;
  if (saved.state === 'interrupted') return { message: `Could not save “${saved.name}”.`, tone: 'error' };
  return { message: saved.folder ? `Saved “${saved.name}” in ${saved.folder}.` : `Saved “${saved.name}”.`, tone: 'success' };
}

export interface DesktopActions {
  readonly run: (command: MenuCommand) => void;
  readonly openFile: (file: File) => void;
  readonly saved: (saved: SavedPayload) => void;
}

/**
 * Wires the page to the desktop app: menu commands to `run`, files to
 * `openFile`, saves to `saved`. Anything malformed is dropped. Returns a
 * function that stops.
 */
export function connectDesktop(api: DesktopApi, actions: DesktopActions): () => void {
  const stopMenu = api.onMenuCommand((command) => {
    if (isMenuCommand(command)) actions.run(command);
  });
  const stopFiles = api.onOpenFile((payload) => {
    const file = toOpenFile(payload);
    if (file) actions.openFile(file);
  });
  const stopSaves = api.onSaved((payload) => {
    const saved = toSaved(payload);
    if (saved) actions.saved(saved);
  });
  api.ready();
  return () => {
    stopMenu();
    stopFiles();
    stopSaves();
  };
}
