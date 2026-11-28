/**
 * The app's agent: the link to the bridge, the chat, and the tools agents run
 * in this window. Only the desktop app has one: it runs the agent bridge
 * itself and talks to the page over IPC. A web page, hosted or local, never
 * connects to a bridge; its Agent panel points to the desktop app.
 */
import { requestContext } from '../agent/attachments';
import { createChangeCap } from '../agent/changeCap';
import { createAgentChat } from '../agent/chat';
import { agentStorage } from '../agent/connection';
import { runTool, type AgentHost } from '../agent/execute';
import { createPreferences } from '../agent/preferences';
import { desktopSocket } from '../agent/desktopSocket';
import { createAgentLink, type AgentLink } from '../agent/link';
import type { Vec3 } from '../core/grid';
import { allBricks } from '../core/model/model';
import type { Model } from '../core/model/types';
import { getPart } from '../core/parts/catalog';
import { desktopApi } from '../desktop/protocol';
import { getEngine } from '../editor/engineRegistry';
import { editorStore, nextId } from '../state/editorStore';
import { partLibrary } from '../state/library';
import { inventory } from '../state/inventory';
import { finderFor } from '../state/partFinder';

/** The chat's settings: what goes with a request, the user's own instructions, a cap on changes. */
export const agentPreferences = createPreferences(agentStorage());

/** Which way the user's camera looked when they sent the request with their view; null when they did not. */
let attachedView: Vec3 | null = null;

/** A cap on the changes one request may make, when the user sets one. */
const changeCap = createChangeCap(
  () => agentPreferences.getState().changeCap,
  () => [editorStore.getState().history.present, editorStore.getState().name],
);

const host: AgentHost = {
  store: editorStore,
  lookup: getPart,
  nextId,
  finder: () => finderFor(partLibrary.store.getState().entries),
  loadLibrary: async () => (await partLibrary.load()).status === 'ready',
  // the renderer loads only when an agent first looks
  look: async (request) => (await import('../agent/look')).renderLook(request),
  ownedLists: () => inventory.store.getState().lists,
  // the view the user sent with the request, or while they share their view, where their camera looks now
  userView: () => attachedView ?? (agentPreferences.getState().attachView ? (getEngine()?.viewDirection() ?? null) : null),
};

const desktop = desktopApi();

/** The link to the desktop app's agent bridge; null on a web page, which has no agent. */
export const agentLink: AgentLink | null = desktop
  ? createAgentLink({
      createSocket: () => desktopSocket(desktop.agent),
      runTool: (tool, input) => changeCap.run(tool, () => runTool(host, tool, input)),
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
    changeCap.begin();
  },
  onRunEnd: () => {
    if (beforeRun) editorStore.getState().squashHistorySince(beforeRun);
    beforeRun = null;
    changeCap.end();
    attachedView = null;
  },
});

/**
 * Asks the agent, with what the user has set to go with each request: the
 * selected bricks and their view (which way the camera looks now), and their
 * own instructions.
 */
export function askAgent(prompt: string): void {
  const preferences = agentPreferences.getState();
  const state = editorStore.getState();
  const selected = preferences.attachSelection && state.selection.size > 0 ? allBricks(state.history.present).filter((b) => state.selection.has(b.id)) : [];
  const view = preferences.attachView ? (getEngine()?.viewDirection() ?? null) : null;
  const { context, note } = requestContext({ selected, view: preferences.attachView });
  // kept for the request only once it has gone, before any tool call can come for it
  if (agentChat.ask(prompt, { context, instructions: preferences.instructions, note })) attachedView = view;
}

// a dropped connection ends the request in progress: the bridge stops the agent with it
agentLink?.store.subscribe((state, previous) => {
  if (previous.status === 'connected' && state.status !== 'connected') agentChat.connectionLost();
});
