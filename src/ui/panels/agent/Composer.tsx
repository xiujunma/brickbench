import { useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';

/** What Safari reports for keys an input method is still working with. */
const IME_PROCESS_KEY_CODE = 229;

type Props = {
  readonly disabled: boolean;
  readonly running: boolean;
  readonly onAsk: (prompt: string) => void;
  readonly onStop: () => void;
};

/** Where the user writes to the agent: Enter sends, Shift+Enter starts a new line. */
export function Composer({ disabled, running, onAsk, onStop }: Props) {
  const [draft, setDraft] = useState('');
  const send = (): void => {
    if (disabled || running || draft.trim() === '') return;
    onAsk(draft);
    setDraft('');
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.keyCode === IME_PROCESS_KEY_CODE) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label className="visually-hidden" htmlFor="agent-prompt">
        Ask the agent to build something
      </label>
      <textarea
        id="agent-prompt"
        className="chat-input"
        rows={3}
        maxLength={8000}
        placeholder={disabled ? 'Waiting for the agent…' : 'Describe what to build or change…'}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="chat-actions">
        <span className="chat-hint">Enter sends · Shift+Enter new line</span>
        {running ? (
          <button type="button" className="btn btn-outline btn-danger" onClick={onStop}>
            <Icon name="stop" size={14} />
            Stop
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={disabled || draft.trim() === ''}>
            <Icon name="send" size={14} />
            Send
          </button>
        )}
      </div>
    </form>
  );
}
