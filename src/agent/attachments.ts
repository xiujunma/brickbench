/**
 * What goes with a request to the agent besides its words: the bricks the
 * user has selected, so "these" means something, and their view, which the
 * agent sees with the look tool's "user" view. Written for the agent, after
 * the words; the chat shows a note of it instead.
 */
import type { Brick } from '../core/model/types';
import { MAX_CONTEXT_LENGTH } from './protocol';

/** The most selected bricks listed one by one; the rest are counted. */
export const MAX_LISTED = 200;
/** The most the list runs to, however long the bricks' ids, leaving room for the rest within what the bridge takes. */
export const MAX_LIST_LENGTH = MAX_CONTEXT_LENGTH - 1000;

export interface Attachments {
  /** The selected bricks; empty when none are, or when they do not go with the request. */
  readonly selected: readonly Brick[];
  /** The user's view goes with it. */
  readonly view: boolean;
}

export interface RequestContext {
  /** For the agent, after the user's words; null when nothing goes with them. */
  readonly context: string | null;
  /** For the chat, under the user's words, such as "With 3 selected bricks and your view."; null when nothing goes with them. */
  readonly note: string | null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A line for each brick, as many as fit. */
function listBricks(bricks: readonly Brick[]): string[] {
  const lines: string[] = [];
  let length = 0;
  for (const b of bricks.slice(0, MAX_LISTED)) {
    const line = JSON.stringify({ id: b.id, part: b.partId, color: b.colorId, x: b.x, y: b.y, z: b.z, r: b.r });
    if (length + line.length + 1 > MAX_LIST_LENGTH) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines;
}

export function requestContext(attachments: Attachments): RequestContext {
  const parts: string[] = [];
  const said: string[] = [];
  const { selected } = attachments;
  if (selected.length > 0) {
    const listed = listBricks(selected);
    const more = selected.length - listed.length;
    parts.push(
      [
        `The user has ${plural(selected.length, 'brick', 'bricks')} selected in BrickBench, so "this" or "these" most likely means ${selected.length === 1 ? 'it' : 'them'} (ids for paint_bricks, move_bricks and remove_bricks):`,
        ...listed,
        ...(more > 0 ? [`and ${more} more, which get_model lists.`] : []),
      ].join('\n'),
    );
    said.push(plural(selected.length, 'selected brick', 'selected bricks'));
  }
  if (attachments.view) {
    parts.push('The user has attached their view: call look with view "user" to see the model from where they look at it.');
    said.push('your view');
  }
  if (parts.length === 0) return { context: null, note: null };
  return { context: parts.join('\n\n'), note: `With ${said.join(' and ')}.` };
}
