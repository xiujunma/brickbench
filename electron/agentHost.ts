/**
 * The agent bridge inside the desktop app, the only place the agent works:
 * it starts when the Agent panel connects and stops when it disconnects or
 * the window goes. The window talks to it over IPC (main.ts wires the
 * channels here); agents, Claude Code among them, reach its MCP server on
 * this computer. Nothing here needs Electron, so tests run it.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccess, type Access } from '../agent/access';
import { createAppLink } from '../agent/appLink';
import { createBridgeHandlers, type BridgeHandlers, type TabSocket } from '../agent/bridge';
import type { StdioMcpServer } from '../agent/acp/schema';
import { createChat, type AcpSetup } from '../agent/chatSetup';
import { serveWithNode, type NodeServer } from '../agent/nodeServer';
import { portOf, type Environment } from '../agent/settings';
import { isConnectionId, MAX_AGENT_MESSAGE, type AgentLinkEvent } from '../src/desktop/protocol';
import { claudeAddCommand, RUN_AS_NODE } from './terminalCommand';

export const NO_CLAUDE =
  'Claude Code is not installed on this computer, so the chat cannot run. Install it from https://code.claude.com, then click Disconnect and Connect here. Other MCP agents can still connect.';

export interface DesktopBridge {
  readonly handlers: BridgeHandlers;
  /** Its MCP server's address, such as http://127.0.0.1:7425. */
  readonly url: string;
  /** For the person, when the bridge starts: settings it cannot keep, for one. */
  readonly notes: readonly string[];
  /** Stops the agent at once, lets agents in a terminal out, then stops the server. */
  stop(): Promise<void>;
}

export interface BridgeSetup {
  /** The app's folder for the bridge, in its user data: the connection file for agents in a terminal, their setting, and their server. */
  readonly folder: string;
  /** The app's executable, which runs the server for agents in a terminal as plain Node. */
  readonly executable: string;
  /** That server, bundled (mcp.cjs, in the app): copied into the folder each time the bridge starts. */
  readonly serverScript: string;
}

/** The server for agents in a terminal, in the app's folder for the bridge. */
export const MCP_SCRIPT = 'mcp.cjs';

/**
 * Puts a fresh copy of the server for agents in a terminal beside the
 * connection file, and says how to add it to Claude Code, or why it cannot:
 * then the panel offers agents in a terminal nothing.
 */
async function terminalServer(setup: BridgeSetup): Promise<{ readonly command: string; readonly script: string } | { readonly failure: string }> {
  const script = join(setup.folder, MCP_SCRIPT);
  try {
    const source = await readFile(setup.serverScript);
    await rm(script, { force: true });
    await writeFile(script, source, { mode: 0o600 });
  } catch (error: unknown) {
    return { failure: `Agents in a terminal cannot connect: the server for them could not be put in place (${error instanceof Error ? error.message : String(error)}).` };
  }
  return { command: claudeAddCommand({ executable: setup.executable, script }, process.platform), script };
}

/**
 * BrickBench's MCP server as the chat's own agents over ACP start it: the
 * same server, with a connection file of its own holding the chat's token,
 * only the user can read, in the bridge's working folder.
 */
async function chatServer(workDir: string, url: string, token: string, executable: string, script: string): Promise<StdioMcpServer> {
  const connection = join(workDir, 'chat-connection.json');
  await writeFile(connection, JSON.stringify({ url, token }), { mode: 0o600 });
  return { name: 'brickbench', command: executable, args: [script, connection], env: [{ name: RUN_AS_NODE, value: '1' }] };
}

/** Starts the bridge: its server first, on this computer only, so the chat's agent can be told where it is and with which token. */
export async function startDesktopBridge(env: Environment, setup: BridgeSetup): Promise<DesktopBridge> {
  const workDir = await mkdtemp(join(tmpdir(), 'brickbench-agent-'));
  const cleanUp = (): Promise<void> => rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  let handlers: BridgeHandlers | null = null;
  let server: NodeServer | null = null;
  let access: Access | null = null;
  try {
    server = await serveWithNode((request) => (handlers ? handlers.fetch(request) : new Response('Starting.', { status: 503 })), portOf(env));
    access = await createAccess({ folder: setup.folder, url: server.url });
    const terminal = await terminalServer(setup);
    // with no server for them, and no switch in the panel, agents in a terminal stay out, however the box was left
    if ('failure' in terminal) await access.close();
    const link = createAppLink();
    const acp: AcpSetup =
      'script' in terminal
        ? { mcpServer: await chatServer(workDir, server.url, access.chatToken, setup.executable, terminal.script) }
        : { unavailable: 'Agents over ACP cannot run here: the server BrickBench gives them could not be put in place.' };
    const chat = await createChat({
      lookup: { env, platform: process.platform, home: homedir(), cwd: process.cwd() },
      link,
      mcp: { url: `${server.url}/mcp`, token: access.chatToken },
      workDir,
      noClaude: NO_CLAUDE,
      // its settings come from the app's environment, read again only when it opens
      restart: 'quit BrickBench and open it again',
      acp,
      folder: setup.folder,
    });
    const { runner } = chat;
    handlers = createBridgeHandlers(runner, { access, link, chooser: chat.chooser, ...('command' in terminal ? { terminalCommand: terminal.command } : {}) });
    const open = server;
    const opened = access;
    return {
      handlers,
      url: open.url,
      notes: 'failure' in terminal ? [...chat.notes, terminal.failure] : chat.notes,
      stop: async () => {
        runner.stop();
        // an agent's program, kept running between requests, ends with the bridge
        runner.close?.();
        await opened.close().catch(() => undefined);
        await open.close();
        await cleanUp();
      },
    };
  } catch (error: unknown) {
    await access?.close().catch(() => undefined);
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
