/**
 * Runs in the page before BrickBench does, sandboxed: gives the page
 * window.brickbench, the one way it hears from the desktop app. The page
 * checks what it gets (see src/desktop/protocol.ts).
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, type DesktopApi } from '../src/desktop/protocol';

function listen(channel: string, listener: (value: unknown) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: unknown): void => listener(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: DesktopApi = {
  onMenuCommand: (listener) => listen(CHANNELS.menu, listener),
  onOpenFile: (listener) => listen(CHANNELS.openFile, listener),
  ready: () => ipcRenderer.send(CHANNELS.ready),
};

contextBridge.exposeInMainWorld('brickbench', api);
