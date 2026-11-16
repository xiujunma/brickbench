import { Fragment, memo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../../../agent/markdown';

// Keys are positions: a reply's blocks come straight from its text and never move about.

function inline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'strong':
        return <strong key={i}>{inline(node.children)}</strong>;
      case 'em':
        return <em key={i}>{inline(node.children)}</em>;
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {inline(node.children)}
          </a>
        );
    }
  });
}

function blocks(nodes: readonly Block[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'paragraph':
        return (
          <p key={i}>
            {node.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      case 'heading':
        return (
          <p key={i} className="chat-heading">
            {inline(node.children)}
          </p>
        );
      case 'code':
        return (
          <pre key={i}>
            <code>{node.text}</code>
          </pre>
        );
      case 'rule':
        return <hr key={i} />;
      case 'list': {
        const items = node.items.map((item, j) => <li key={j}>{blocks(item)}</li>);
        return node.ordered ? (
          <ol key={i} start={node.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
    }
  });
}

/** A reply's blocks; should reading ever fail, the reply still shows, as plain text. */
function readReply(text: string): readonly Block[] {
  try {
    return parseMarkdown(text);
  } catch {
    return [{ kind: 'paragraph', lines: text.split('\n').map((line) => [{ kind: 'text', text: line }]) }];
  }
}

type Props = {
  readonly text: string;
};

/**
 * Markdown from the agent, drawn as React elements, so a reply can format text
 * but never add markup. Memoised: the transcript redraws on every new line.
 */
export const Markdown = memo(function Markdown({ text }: Props) {
  return <>{blocks(readReply(text))}</>;
});
