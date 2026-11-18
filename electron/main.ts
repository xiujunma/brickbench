/**
 * BrickBench as a desktop app: one window showing the built web app, served
 * from brickbench://app (so fetch, modules and storage work as on the web),
 * with a native menu, and model files opened from Finder, Explorer or the
 * command line. Built and run by scripts/desktop.ts.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, session, shell, type WebContents } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OPENABLE_EXTENSIONS } from '../src/core/io/openable';
import { APP_ORIGIN, APP_SCHEME, CHANNELS, MAX_OPEN_BYTES, type MenuCommand, type OpenFilePayload, type SavedPayload } from '../src/desktop/protocol';
import { filesToOpen } from './launchFiles';
import { menuTemplate } from './menu';
import { resolveAppFile } from './webRoot';

/** A Vite dev server to show instead of the built app: `BRICKBENCH_DEV_URL=http://localhost:5173`. */
const DEV_URL = process.env['BRICKBENCH_DEV_URL'] ?? null;
/** The built web app: in the app's archive when packaged, else dist/ beside the staged app (or as given). */
const WEB_ROOT = app.isPackaged ? join(app.getAppPath(), 'web') : (process.env['BRICKBENCH_WEB_ROOT'] ?? join(app.getAppPath(), '..', 'dist'));
const START_URL = DEV_URL ?? `${APP_ORIGIN}/index.html`;

let window: BrowserWindow | null = null;
/** Whether the page listens for files yet; until then they wait here. */
let pageReady = false;
const waiting: string[] = [];

// must happen before the app is ready: the scheme behaves like https, so fetch and modules work
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

function isOwnUrl(url: string): boolean {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  return DEV_URL !== null && url.startsWith(new URL(DEV_URL).origin);
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** Serves the built web app, and nothing outside it. */
async function serveAppFile(request: Request): Promise<Response> {
  const file = resolveAppFile(WEB_ROOT, request.url);
  if (!file) return notFound();
  try {
    if (!(await stat(file)).isFile()) return notFound();
  } catch {
    return notFound();
  }
  return net.fetch(pathToFileURL(file).href);
}

function send(command: MenuCommand): void {
  window?.webContents.send(CHANNELS.menu, command);
}

/** Hands a model file to the page, once it listens; files too big to open are refused here. */
async function openPath(path: string): Promise<void> {
  if (!window || !pageReady) {
    waiting.push(path);
    return;
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) return;
    if (info.size > MAX_OPEN_BYTES) {
      dialog.showErrorBox('BrickBench', `${basename(path)} is too large to open (over ${MAX_OPEN_BYTES / 1024 / 1024} MB).`);
      return;
    }
    const payload: OpenFilePayload = { name: basename(path), data: new Uint8Array(await readFile(path)) };
    window.webContents.send(CHANNELS.openFile, payload);
  } catch (error: unknown) {
    dialog.showErrorBox('BrickBench', `${basename(path)} could not be opened: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function chooseAndOpen(): Promise<void> {
  if (!window) return;
  const extensions = OPENABLE_EXTENSIONS.map((extension) => extension.slice(extension.lastIndexOf('.') + 1));
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile'],
    filters: [{ name: 'Models (BrickBench, LDraw, Studio)', extensions: [...new Set(extensions)] }],
  });
  const [path] = result.filePaths;
  if (!result.canceled && path) await openPath(path);
}

function createWindow(): void {
  const created = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'BrickBench',
    backgroundColor: '#f1ede5',
    show: false,
    webPreferences: { preload: join(app.getAppPath(), 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  window = created;
  pageReady = false;
  created.once('ready-to-show', () => created.show());
  created.on('closed', () => {
    if (window === created) window = null;
  });
  void created.loadURL(START_URL);
}

/**
 * Saves (the page's downloads) ask where to go, with Electron's own Save
 * dialog; once it is done, the page hears where each file went, or that it
 * was cancelled or failed, and says so.
 */
function reportSaves(): void {
  session.defaultSession.on('will-download', (_event, item, contents) => {
    item.once('done', (_done, state) => {
      if (contents.isDestroyed()) return;
      const path = item.getSavePath();
      const payload: SavedPayload = { name: path ? basename(path) : item.getFilename(), folder: path && state === 'completed' ? basename(dirname(path)) : '', state };
      contents.send(CHANNELS.saved, payload);
    });
  });
}

/** Pages stay on BrickBench: links to the web open in the browser, and nothing else opens or navigates. */
function guard(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isOwnUrl(url)) return { action: 'allow' };
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

if (!app.requestSingleInstanceLock()) {
  // another BrickBench is running: it gets our files (see 'second-instance')
  app.quit();
} else {
  waiting.push(...filesToOpen(process.argv, process.cwd()));

  // macOS: files opened from Finder or dropped on the Dock icon, perhaps before the app is ready
  app.on('open-file', (event, path) => {
    event.preventDefault();
    // with every window closed the app still runs on macOS: open one for the file
    if (app.isReady() && !window) createWindow();
    void openPath(path);
  });

  app.on('second-instance', (_event, argv, cwd) => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
    for (const path of filesToOpen(argv, cwd)) void openPath(path);
  });

  app.on('web-contents-created', (_event, contents) => guard(contents));

  ipcMain.on(CHANNELS.ready, (event) => {
    if (event.sender !== window?.webContents) return;
    pageReady = true;
    for (const path of waiting.splice(0)) void openPath(path);
  });

  void app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, serveAppFile);
    // BrickBench needs no camera, microphone, location or notifications
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen'));
    reportSaves();
    app.setAboutPanelOptions({
      applicationName: 'BrickBench',
      applicationVersion: app.getVersion(),
      credits: 'Library parts from the LDraw.org Parts Library (CC BY 4.0). LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise or endorse this software.',
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        menuTemplate({
          platform: process.platform,
          dev: !app.isPackaged,
          command: send,
          open: () => void chooseAndOpen(),
          openExternal: (url) => void shell.openExternal(url),
        }),
      ),
    );
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
