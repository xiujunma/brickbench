/**
 * The agent bridge inside the desktop app, the only place the agent works:
 * it starts when the Agent panel connects and stops when it disconnects or
 * the window goes. The window talks to it over IPC (main.ts wires the
 * channels here); agents, Claude Code among them, reach its MCP server on
 * this computer. Nothing here needs Electron, so tests run it.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppLink } from '../agent/appLink';
import { createBridgeHandlers, type BridgeHandlers, type TabSocket } from '../agent/bridge';
import { createChat } from '../agent/chatSetup';
import { serveWithNode, type NodeServer } from '../agent/nodeServer';
import { portOf, type Environment } from '../agent/settings';
import { isConnectionId, MAX_AGENT_MESSAGE, type AgentLinkEvent } from '../src/desktop/protocol';

export const NO_CLAUDE =
  'Claude Code is not installed on this computer, so the chat cannot run. Install it from https://code.claude.com, then click Disconnect and Connect here. Other MCP agents can still connect.';

export interface DesktopBridge {
  readonly handlers: BridgeHandlers;
  /** Its MCP server's address, such as http://127.0.0.1:7425. */
  readonly url: string;
  /** For the person, when the bridge starts: settings it cannot keep, for one. */
  readonly notes: readonly string[];
  /** Stops the agent at once, then the server. */
  stop(): Promise<void>;
}

/** Starts the bridge: its MCP server first, on this computer only, so Claude Code can be told where it is. */
export async function startDesktopBridge(env: Environment): Promise<DesktopBridge> {
  const workDir = await mkdtemp(join(tmpdir(), 'brickbench-agent-'));
  const cleanUp = (): Promise<void> => rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  let handlers: BridgeHandlers | null = null;
  let server: NodeServer | null = null;
  try {
    server = await serveWithNode((request) => (handlers ? handlers.fetch(request) : new Response('Starting.', { status: 503 })), portOf(env));
    const mcpUrl = `${server.url}/mcp`;
    const link = createAppLink();
    const { runner, notes } = await createChat({
      lookup: { env, platform: process.platform, home: homedir(), cwd: process.cwd() },
      link,
      mcpUrl,
      workDir,
      noClaude: NO_CLAUDE,
      // its settings come from the app's environment, read again only when it opens
      restart: 'quit BrickBench and open it again',
    });
    handlers = createBridgeHandlers(runner, { link, mcpUrl: () => mcpUrl });
    const open = server;
    return {
      handlers,
      url: open.url,
      notes,
      stop: async () => {
        runner.stop();
        await open.close();
        await cleanUp();
      },
    };
  } catch (error: unknown) {
    await server?.close();
    await cleanUp();
    throw error;
  }
}

/** The app's window, as the host needs it: Electron's webContents. */
export interface AgentWindow {
  send(channel: string, event: AgentLinkEvent): void;
  isDestroyed(): boolean;
}

export interface AgentHost {
  /** The window's panel connects (as `id`): start the bridge if need be, then say so. */
  open(window: AgentWindow, id: unknown): void;
  /** A message from the window's panel, for the bridge. */
  send(window: AgentWindow, id: unknown, text: unknown): void;
  /** The window's panel disconnects: stop the bridge. */
  close(window: AgentWindow, id: unknown): void;
  /** Stops the bridge, if it runs, as when the page goes or the app quits; the agent stops at once, and a page still there hears it closed. */
  stop(): Promise<void>;
}

export interface AgentHostOptions {
  readonly start: () => Promise<DesktopBridge>;
  /** The channel events for the window go on. */
  readonly channel: string;
  /** Where to tell of problems and notes, as nobody watches the main process otherwise: stderr in the app. */
  readonly report: (message: string) => void;
}

interface Connection {
  readonly window: AgentWindow;
  readonly id: string;
  readonly socket: TabSocket;
}

export function createAgentHost(options: AgentHostOptions): AgentHost {
  let running: DesktopBridge | null = null;
  let connection: Connection | null = null;
  /** Starts and stops, one after another, so no bridge starts twice or is left behind. */
  let queue: Promise<void> = Promise.resolve();

  const inTurn = (step: () => Promise<void>): Promise<void> => {
    const turn = queue.then(step);
    queue = turn.catch(() => undefined);
    return turn;
  };

  const tell = (window: AgentWindow, event: AgentLinkEvent): void => {
    if (!window.isDestroyed()) window.send(options.channel, event);
  };

  /** Lets go of the window's connection, which stops the agent if it was chatting there; returns it. */
  const leave = (): Connection | null => {
    const current = connection;
    connection = null;
    if (current && running) running.handlers.tabs.close(current.socket);
    return current;
  };

  const stop = (): Promise<void> => {
    const left = leave();
    // a page that is still there reconnects when it wants the agent again
    if (left) tell(left.window, { type: 'close', id: left.id });
    return inTurn(async () => {
      const bridge = running;
      running = null;
      await bridge?.stop();
    });
  };

  /** Runs in turn: starts the bridge if none runs, then connects the window, unless it has let go meanwhile. */
  const connect = async (current: Connection): Promise<void> => {
    if (connection !== current) return;
    if (!running) {
      try {
        running = await options.start();
      } catch (error: unknown) {
        options.report(`The agent bridge could not start: ${error instanceof Error ? error.message : String(error)}`);
        if (connection === current) {
          connection = null;
          tell(current.window, { type: 'close', id: current.id });
        }
        return;
      }
      for (const note of running.notes) options.report(note);
    }
    if (connection !== current) return;
    tell(current.window, { type: 'open', id: current.id });
    running.handlers.tabs.open(current.socket);
  };

  const isCurrent = (window: AgentWindow, id: unknown): boolean => connection?.window === window && connection.id === id;

  return {
    open(window, id) {
      if (!isConnectionId(id)) return;
      const left = leave();
      if (left && left.id !== id) tell(left.window, { type: 'close', id: left.id });
      const socket: TabSocket = {
        data: { tab: 1 },
        // only while this is the window's connection: a stopped run's last word goes nowhere
        send: (text) => {
          if (connection?.socket === socket) tell(window, { type: 'message', id, data: text });
        },
      };
      const current: Connection = { window, id, socket };
      connection = current;
      void inTurn(() => connect(current));
    },
    send(window, id, text) {
      const current = connection;
      if (!current || !isCurrent(window, id) || typeof text !== 'string' || text.length > MAX_AGENT_MESSAGE || !running) return;
      running.handlers.tabs.message(current.socket, text);
    },
    close(window, id) {
      if (isCurrent(window, id)) void stop();
    },
    stop,
  };
}
