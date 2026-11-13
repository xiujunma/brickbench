/** The app's agent: the link to the bridge, the chat, and the tools agents run in this tab. */
import { createAgentChat } from '../agent/chat';
import { bridgeUrl } from '../agent/connection';
import { runTool, type AgentHost } from '../agent/execute';
import { createAgentLink, type AgentLink } from '../agent/link';
import type { Model } from '../core/model/types';
import { getPart } from '../core/parts/catalog';
import { editorStore, nextId } from '../state/editorStore';
import { partLibrary } from '../state/library';
import { finderFor } from '../state/partFinder';

const host: AgentHost = {
  store: editorStore,
  lookup: getPart,
  nextId,
  finder: () => finderFor(partLibrary.store.getState().entries),
  loadLibrary: async () => (await partLibrary.load()).status === 'ready',
  // the renderer loads only when an agent first looks
  look: async (request) => (await import('../agent/look')).renderLook(request),
};

export const agentLink: AgentLink = createAgentLink({
  url: bridgeUrl(typeof location === 'undefined' ? '' : location.search),
  createSocket: (url) => new WebSocket(url),
  runTool: (tool, input) => runTool(host, tool, input),
  onAgentEvent: (event) => agentChat.receive(event),
  isFocused: () => typeof document === 'undefined' || document.hasFocus(),
});

/** The model as it was when the agent started on a request, so the whole request is one step to undo. */
let beforeRun: Model | null = null;

export const agentChat = createAgentChat({
  send: (message) => agentLink.send(message),
  onRunStart: () => {
    beforeRun = editorStore.getState().history.present;
  },
  onRunEnd: () => {
    if (beforeRun) editorStore.getState().squashHistorySince(beforeRun);
    beforeRun = null;
  },
});

// a dropped connection ends the request in progress: the bridge stops the agent with it
agentLink.store.subscribe((state, previous) => {
  if (previous.status === 'connected' && state.status !== 'connected') agentChat.connectionLost();
});
