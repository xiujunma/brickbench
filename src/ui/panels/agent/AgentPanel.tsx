import { useEffect } from 'react';
import { agentStorage, AGENT_PORT, forgetAgent } from '../../../agent/connection';
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

const MCP_COMMAND = `claude mcp add --transport http brickbench http://127.0.0.1:${AGENT_PORT}/mcp`;

function StatusLine() {
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
        <button type="button" className="link-button" onClick={() => forgetAgent(agentLink, agentStorage())}>
          Disconnect
        </button>
      )}
      {status === 'off' && (
        <button type="button" className="link-button" onClick={() => agentLink.connect()}>
          Connect
        </button>
      )}
    </div>
  );
}

function BridgeHelp() {
  return (
    <div className="agent-help">
      <strong>Start the agent bridge</strong>
      <p>In a terminal in the BrickBench folder, run:</p>
      <code className="agent-command">bun run agent</code>
      <p>This panel connects by itself once it is running. Replies come from Claude Code on this computer, using your own login.</p>
    </div>
  );
}

function Welcome({ disabled }: { readonly disabled: boolean }) {
  return (
    <div className="agent-welcome">
      <p>
        Ask Claude Code to build in your model. You see every brick as it goes in, and you can undo anything it does.
      </p>
      <div className="agent-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="chip" disabled={disabled} onClick={() => agentChat.ask(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
      <details className="agent-terminal">
        <summary>Build from a terminal instead</summary>
        <p>Add BrickBench to Claude Code once, then ask it to build in BrickBench while this page is open:</p>
        <code className="agent-command">{MCP_COMMAND}</code>
      </details>
    </div>
  );
}

type Props = {
  readonly onClose: () => void;
};

/** Chat with an agent that builds in the model: Claude Code, through the local agent bridge. */
export function AgentPanel({ onClose }: Props) {
  const status = useAgentLink((s) => s.status);
  const agent = useAgentLink((s) => s.agent);
  const entries = useAgentChat((s) => s.entries);
  const running = useAgentChat((s) => s.running);
  const ready = status === 'connected' && agent?.available === true;

  useEffect(() => {
    agentLink.connect();
  }, []);

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
          <button type="button" className="btn" disabled={running || entries.length === 0} onClick={() => agentChat.newConversation()}>
            New chat
          </button>
          <button type="button" className="icon-btn" aria-label="Close the agent" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
      <StatusLine />
      {status === 'unreachable' && <BridgeHelp />}
      {status === 'connected' && agent && !agent.available && (
        <div className="agent-help">
          <strong>The chat cannot run here</strong>
          <p>{agent.detail}</p>
        </div>
      )}
      {entries.length === 0 && !running ? <Welcome disabled={!ready} /> : <Transcript entries={entries} running={running} />}
      <Composer disabled={!ready} running={running} onAsk={(prompt) => agentChat.ask(prompt)} onStop={() => agentChat.stop()} />
    </aside>
  );
}
