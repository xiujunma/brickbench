/**
 * Runs in the page before BrickBench does, sandboxed: gives the page
 * window.brickbench, the one way it hears from the desktop app, and the
 * Agent panel's link to the app's agent bridge. The page checks what it gets
 * (see src/desktop/protocol.ts).
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
  agent: {
    open: (id) => ipcRenderer.send(CHANNELS.agentOpen, id),
    send: (id, text) => ipcRenderer.send(CHANNELS.agentSend, id, text),
    close: (id) => ipcRenderer.send(CHANNELS.agentClose, id),
    onEvent: (listener) => listen(CHANNELS.agentEvent, listener),
  },
  onMenuCommand: (listener) => listen(CHANNELS.menu, listener),
  onOpenFile: (listener) => listen(CHANNELS.openFile, listener),
  onSaved: (listener) => listen(CHANNELS.saved, listener),
  ready: () => ipcRenderer.send(CHANNELS.ready),
};

contextBridge.exposeInMainWorld('brickbench', api);
