/**
 * The app's agent: the link to the bridge, the chat, and the tools agents run
 * in this window. Only the desktop app has one: it runs the agent bridge
 * itself and talks to the page over IPC. A web page, hosted or local, never
 * connects to a bridge; its Agent panel points to the desktop app.
 */
import { createAgentChat } from '../agent/chat';
import { runTool, type AgentHost } from '../agent/execute';
import { desktopSocket } from '../agent/desktopSocket';
import { createAgentLink, type AgentLink } from '../agent/link';
import type { Model } from '../core/model/types';
import { getPart } from '../core/parts/catalog';
import { desktopApi } from '../desktop/protocol';
import { editorStore, nextId } from '../state/editorStore';
import { partLibrary } from '../state/library';
import { inventory } from '../state/inventory';
import { finderFor } from '../state/partFinder';

const host: AgentHost = {
  store: editorStore,
  lookup: getPart,
  nextId,
  finder: () => finderFor(partLibrary.store.getState().entries),
  loadLibrary: async () => (await partLibrary.load()).status === 'ready',
  // the renderer loads only when an agent first looks
  look: async (request) => (await import('../agent/look')).renderLook(request),
  ownedLists: () => inventory.store.getState().lists,
};

const desktop = desktopApi();

/** The link to the desktop app's agent bridge; null on a web page, which has no agent. */
export const agentLink: AgentLink | null = desktop
  ? createAgentLink({
      createSocket: () => desktopSocket(desktop.agent),
      runTool: (tool, input) => runTool(host, tool, input),
      onAgentEvent: (event) => agentChat.receive(event),
      isFocused: () => typeof document === 'undefined' || document.hasFocus(),
    })
  : null;

/** The model as it was when the agent started on a request, so the whole request is one step to undo. */
let beforeRun: Model | null = null;

export const agentChat = createAgentChat({
  send: (message) => agentLink?.send(message) ?? false,
  onRunStart: () => {
    beforeRun = editorStore.getState().history.present;
  },
  onRunEnd: () => {
    if (beforeRun) editorStore.getState().squashHistorySince(beforeRun);
    beforeRun = null;
  },
});

// a dropped connection ends the request in progress: the bridge stops the agent with it
agentLink?.store.subscribe((state, previous) => {
  if (previous.status === 'connected' && state.status !== 'connected') agentChat.connectionLost();
});
