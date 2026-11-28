import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { agentPreferences } from '../../../app/agent';
import { MAX_INSTRUCTIONS_LENGTH } from '../../../agent/protocol';
import { capFromDraft, DEFAULT_CHANGE_CAP, MAX_CHANGE_CAP, MIN_CHANGE_CAP, type AgentPreferences } from '../../../agent/preferences';
import { useEditor } from '../../../state/editorStore';

const usePreferences = <T,>(selector: (preferences: AgentPreferences) => T): T => useStore(agentPreferences, selector);
const set = (change: Partial<AgentPreferences>): void => agentPreferences.setState(change);

/** Under the message: whether the selected bricks and the user's view go with it. */
export function AttachToggles() {
  const attachSelection = usePreferences((p) => p.attachSelection);
  const attachView = usePreferences((p) => p.attachView);
  const selected = useEditor((s) => s.selection.size);
  return (
    <div className="chat-attach">
      <label className="agent-check">
        <input type="checkbox" checked={attachSelection} onChange={(event) => set({ attachSelection: event.target.checked })} />
        Selected bricks{selected > 0 ? ` (${selected})` : ''}
      </label>
      <label className="agent-check">
        <input type="checkbox" checked={attachView} onChange={(event) => set({ attachView: event.target.checked })} />
        My view
      </label>
    </div>
  );
}

/** Keeps the cap a typed number stands for, unless the limit was turned off meanwhile; says what it kept. */
function keepCap(draft: string): number | null {
  const current = agentPreferences.getState().changeCap;
  if (current === null) return null;
  const kept = capFromDraft(draft, current);
  if (kept !== current) set({ changeCap: kept });
  return kept;
}

/**
 * The cap as the user types it, kept as they leave the field, press Enter or
 * put the panel away, and not on the way: typing 30 would otherwise cap a
 * request already running at 3.
 */
function CapInput({ cap }: { readonly cap: number }) {
  const [draft, setDraft] = useState(String(cap));
  const typed = useRef(draft);
  useEffect(() => () => void keepCap(typed.current), []);
  const settle = (): void => {
    const kept = keepCap(typed.current);
    if (kept !== null) setDraft(String(kept));
  };
  return (
    <input
      type="number"
      className="agent-cap"
      aria-label="Most changes per request"
      min={MIN_CHANGE_CAP}
      max={MAX_CHANGE_CAP}
      value={draft}
      onChange={(event) => {
        typed.current = event.target.value;
        setDraft(event.target.value);
      }}
      onBlur={settle}
      onKeyDown={(event) => event.key === 'Enter' && settle()}
    />
  );
}

/** The user's own instructions for the agent, and a cap on the changes one request may make. */
export function ChatSettings() {
  const instructions = usePreferences((p) => p.instructions);
  const changeCap = usePreferences((p) => p.changeCap);
  return (
    <details className="agent-terminal">
      <summary>Chat settings</summary>
      <label className="agent-field" htmlFor="agent-instructions">
        Your instructions for the agent
      </label>
      <textarea
        id="agent-instructions"
        className="chat-input agent-instructions"
        rows={3}
        maxLength={MAX_INSTRUCTIONS_LENGTH}
        placeholder="Such as: build in pastel colours, and make walls two bricks thick"
        value={instructions}
        onChange={(event) => set({ instructions: event.target.value })}
      />
      <p>They go with every request; some agents take a change only at the next new chat.</p>
      <label className="agent-check">
        <input type="checkbox" checked={changeCap !== null} onChange={(event) => set({ changeCap: event.target.checked ? DEFAULT_CHANGE_CAP : null })} />
        Limit changes per request
      </label>
      {changeCap !== null && (
        <div className="agent-cap-row">
          At most <CapInput cap={changeCap} /> changes, then the agent stops and says what is left.
        </div>
      )}
    </details>
  );
}
