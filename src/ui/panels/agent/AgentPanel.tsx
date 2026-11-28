import { useEffect, type ReactNode } from 'react';
import { agentStorage, forgetAgent } from '../../../agent/connection';
import type { AgentLink } from '../../../agent/link';
import { agentChat, agentLink } from '../../../app/agent';
import { Icon } from '../../components/Icon';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import { useAgentChat, useAgentLink } from './useAgent';

const SUGGESTIONS = [
  'Build a small red house with a door and two windows',
  'Make a tower ten bricks tall that narrows towards the top',
  'Lay out a green garden with a path and a few trees',
];

/** Where to read about the desktop app, the only place the agent works. */
export const DESKTOP_APP_URL = 'https://github.com/xiujunma/brickbench#desktop-app';

/** The command that adds BrickBench to Claude Code, for the bridge's MCP server where the bridge says it is. */
const mcpCommand = (mcpUrl: string): string => `claude mcp add --transport http brickbench ${mcpUrl}`;

function StatusLine({ link }: { readonly link: AgentLink }) {
  const status = useAgentLink((s) => s.status);
  const agent = useAgentLink((s) => s.agent);
  const text =
    status === 'connected'
      ? (agent?.name ?? 'Connected')
      : status === 'connecting'
        ? 'Connecting…'
        : status === 'unreachable'
          ? 'Bridge not running'
          : 'Not connected';
  return (
    <div className="agent-status" data-status={status}>
      <span className="agent-dot" aria-hidden="true" />
      <span className="agent-status-text" role="status">
        {text}
      </span>
      {status === 'connected' && (
        <button type="button" className="link-button" onClick={() => forgetAgent(link, agentStorage())}>
          Disconnect
        </button>
      )}
      {status === 'off' && (
        <button type="button" className="link-button" onClick={() => link.connect()}>
          Connect
        </button>
      )}
    </div>
  );
}

function BridgeHelp() {
  return (
    <div className="agent-help">
      <strong>The agent bridge did not start</strong>
      <p>BrickBench keeps trying. If it never starts, quit BrickBench and open it again.</p>
    </div>
  );
}

function Welcome({ disabled }: { readonly disabled: boolean }) {
  const mcpUrl = useAgentLink((s) => s.mcpUrl);
  return (
    <div className="agent-welcome">
      <p>Ask the agent to build in your model. You see every brick as it goes in, and you can undo anything it does.</p>
      <div className="agent-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="chip" disabled={disabled} onClick={() => agentChat.ask(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
      {mcpUrl && (
        <details className="agent-terminal">
          <summary>Build from a terminal instead</summary>
          <p>Add BrickBench to Claude Code once, then ask it to build in BrickBench while the app is open:</p>
          <code className="agent-command">{mcpCommand(mcpUrl)}</code>
        </details>
      )}
    </div>
  );
}

type Props = {
  readonly onClose: () => void;
};

type ShellProps = Props & {
  readonly actions?: ReactNode;
  readonly children: ReactNode;
};

/** The panel's frame: its heading, a close button, and Esc to put it away. */
function PanelShell({ onClose, actions, children }: ShellProps) {
  return (
    <aside
      className="panel panel-agent"
      aria-label="Agent"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="panel-head agent-head">
        <h2>
          <Icon name="sparkle" size={16} /> Agent
        </h2>
        <div className="agent-head-actions">
          {actions}
          <button type="button" className="icon-btn" aria-label="Close the agent" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
      {children}
    </aside>
  );
}

/** On a web page, hosted or local: the agent works only in the desktop app, so the panel says where to find it. */
function DesktopOnly({ onClose }: Props) {
  return (
    <PanelShell onClose={onClose}>
      <div className="agent-help agent-desktop-only">
        <strong>The agent works in the desktop app</strong>
        <p>
          BrickBench’s desktop app runs an AI agent on your computer, such as Claude Code with your own login, and it builds in your model while you watch.
          Agents in a terminal can build there too, through MCP.
        </p>
        <a href={DESKTOP_APP_URL} target="_blank" rel="noopener noreferrer">
          About the desktop app
        </a>
      </div>
    </PanelShell>
  );
}

/** In the desktop app: chat with an agent that builds in the model (Claude Code, or a model behind an API) through the app's agent bridge. */
function AgentChat({ link, onClose }: Props & { readonly link: AgentLink }) {
  const status = useAgentLink((s) => s.status);
  const agent = useAgentLink((s) => s.agent);
  const entries = useAgentChat((s) => s.entries);
  const running = useAgentChat((s) => s.running);
  const ready = status === 'connected' && agent?.available === true;

  useEffect(() => {
    link.connect();
  }, [link]);

  const newChat = (
    <button type="button" className="btn" disabled={running || entries.length === 0} onClick={() => agentChat.newConversation()}>
      New chat
    </button>
  );
  return (
    <PanelShell onClose={onClose} actions={newChat}>
      <StatusLine link={link} />
      {status === 'unreachable' && <BridgeHelp />}
      {status === 'connected' && agent && !agent.available && (
        <div className="agent-help">
          <strong>The chat cannot run here</strong>
          <p>{agent.detail}</p>
        </div>
      )}
      {entries.length === 0 && !running ? <Welcome disabled={!ready} /> : <Transcript entries={entries} running={running} />}
      <Composer disabled={!ready} running={running} onAsk={(prompt) => agentChat.ask(prompt)} onStop={() => agentChat.stop()} />
    </PanelShell>
  );
}

export function AgentPanel({ onClose }: Props) {
  return agentLink ? <AgentChat link={agentLink} onClose={onClose} /> : <DesktopOnly onClose={onClose} />;
}
