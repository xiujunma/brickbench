import { useEffect, useRef } from 'react';
import type { ChatEntry } from '../../../agent/chat';
import { Icon } from '../../components/Icon';
import { Markdown } from './Markdown';

/** How close to the bottom counts as reading the latest, so new lines scroll into view. */
const FOLLOW_PX = 48;

function Entry({ entry }: { readonly entry: ChatEntry }) {
  switch (entry.kind) {
    case 'user':
      return <p className="chat-user">{entry.text}</p>;
    case 'agent':
      return (
        <div className="chat-agent">
          <Markdown text={entry.text} />
        </div>
      );
    case 'tool':
      return (
        <p className="chat-tool">
          <Icon name="brick" size={13} />
          <span>{entry.text}</span>
        </p>
      );
    case 'error':
      // errors can name a command in backticks, as in "run `claude mcp add …`"
      return (
        <div className="chat-error" role="alert">
          <Markdown text={entry.text} />
        </div>
      );
    case 'note':
      return <p className="chat-note">{entry.text}</p>;
  }
}

type Props = {
  readonly entries: readonly ChatEntry[];
  readonly running: boolean;
};

/** The conversation, newest at the bottom, following along while the agent works. */
export function Transcript({ entries, running }: Props) {
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const latest = entries.at(-1);
  // the newest request, which a note of what went with it may follow
  const lastAsked = entries.findLast((entry) => entry.kind === 'user')?.id;

  // a new request always brings the conversation back to its end
  useEffect(() => {
    following.current = true;
  }, [lastAsked]);

  useEffect(() => {
    const element = log.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [latest, running]);

  return (
    <div
      ref={log}
      className="chat-log"
      role="log"
      aria-label="Conversation with the agent"
      // scrollable from the keyboard
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_PX;
      }}
    >
      {entries.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
      {running && (
        <p className="chat-working" role="status">
          <span className="chat-pulse" aria-hidden="true" />
          Working…
        </p>
      )}
    </div>
  );
}
