/**
 * Runs an agent's tool call against the editor: checks the input, makes the
 * change as one step the user can undo, and answers in words the agent can
 * act on. Library parts are loaded on demand.
 */
import type { StoreApi } from 'zustand/vanilla';
import { canUndo } from '../core/history';
import type { OwnedList } from '../core/inventory/stock';
import type { SceneSettings } from '../core/io/modelFile';
import { isLDrawPartId } from '../core/ldraw/catalogIndex';
import type { IdFactory } from '../core/model/ids';
import { allBricks } from '../core/model/model';
import type { Brick, Model } from '../core/model/types';
import { colourInQuery } from '../core/parts/finder/colourWords';
import type { Finder } from '../core/parts/finder/finder';
import { readQuery } from '../core/parts/pattern';
import type { PartLookup } from '../core/parts/types';
import type { EditorState } from '../state/types';
import { BuildError, clearModel, describeModel, moveBricks, paintBricks, placeBricks, removeBricks, type Change } from './build';
import { paletteList, resolveColour, searchParts } from './catalog';
import { NO_LISTS_NOTE, overOwned, ownedColours, ownedLots, ownedPartIds, tally } from './owned';
import { isToolName, parseToolInput, type ToolInput, type ToolName, type ToolOutcome, type View } from './protocol';

export interface LookRequest {
  readonly bricks: readonly Brick[];
  /** Bricks to outline, e.g. the ones the agent just placed. */
  readonly highlight: readonly Brick[];
  readonly view: View;
  readonly settings: SceneSettings;
}

/** What the tools need from the app; tests pass their own. */
export interface AgentHost {
  readonly store: StoreApi<EditorState>;
  readonly lookup: PartLookup;
  readonly nextId: IdFactory;
  /** The finder over the basic parts and as much of the library as is loaded. */
  readonly finder: () => Finder;
  /** Loads the LDraw library; resolves whether its parts are there to use. */
  readonly loadLibrary: () => Promise<boolean>;
  readonly look: (request: LookRequest) => Promise<{ readonly data: string; readonly mimeType: 'image/jpeg' | 'image/png' }>;
  /** The parts lists of the sets the user owns; none when left out. */
  readonly ownedLists?: () => readonly OwnedList[];
}

type Handler<T extends ToolName> = (host: AgentHost, input: ToolInput<T>) => Promise<ToolOutcome> | ToolOutcome;

const LIBRARY_NOTE = 'Only the basic parts were searched: the LDraw library is not available.';
const EMPTY_NOTE = 'The model is empty: there is nothing to see yet.';

const modelOf = (host: AgentHost): Model => host.store.getState().history.present;
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Makes a change in the editor as one step to undo, and reports what it did. */
function apply<T>(host: AgentHost, change: Change<T>): ToolOutcome {
  if (change.next !== modelOf(host)) host.store.getState().commitModel(change.next);
  return { ok: true, data: change.result };
}

/** Whether library parts can be used; when the library cannot load, the basic parts still can. */
async function withLibrary(host: AgentHost): Promise<boolean> {
  try {
    return await host.loadLibrary();
  } catch {
    // reported to the agent where it matters: a note on searches, "unknown part" on bricks
    return false;
  }
}

async function lookAt(host: AgentHost, input: ToolInput<'look'>): Promise<ToolOutcome> {
  const bricks = allBricks(modelOf(host));
  if (bricks.length === 0) return { ok: true, data: { view: input.view, brick_count: 0, note: EMPTY_NOTE } };
  const wanted = new Set(input.highlight);
  const highlight = bricks.filter((b) => wanted.has(b.id));
  try {
    const image = await host.look({ bricks, highlight, view: input.view, settings: host.store.getState().settings });
    return { ok: true, data: { view: input.view, brick_count: bricks.length, highlighted: highlight.length }, image };
  } catch (error: unknown) {
    return { ok: false, error: `BrickBench could not draw the model: ${messageOf(error)}` };
  }
}

const listsOf = (host: AgentHost): readonly OwnedList[] => host.ownedLists?.() ?? [];

/** Why a query that looks like a part pattern was searched as words instead. */
function patternNote(query: string): string | null {
  const reading = readQuery(query);
  if (reading.kind !== 'broken') return null;
  return `As a part pattern the query does not read, so it was searched as words: ${reading.error.message} (at character ${reading.error.at + 1}).`;
}

async function findParts(host: AgentHost, input: ToolInput<'find_parts'>): Promise<ToolOutcome> {
  const library = await withLibrary(host);
  const lists = listsOf(host);
  const owned = lists.length > 0 ? ownedPartIds(lists) : undefined;
  const found = searchParts(host.finder(), input.query, input.limit, { only: input.owned_only ? owned : undefined, ownedParts: owned });
  const notes = [library ? null : LIBRARY_NOTE, input.owned_only && lists.length === 0 ? NO_LISTS_NOTE : null, patternNote(input.query)]
    .filter(Boolean)
    .join(' ');
  // with the user's sets known, each part says which of its colours they own and how many are left
  const counts = lists.length > 0 ? tally(lists, allBricks(modelOf(host)), host.lookup) : null;
  const parts = counts ? found.parts.map((p) => ({ ...p, owned: ownedColours(p.part, counts, host.lookup) })) : found.parts;
  return { ok: true, data: notes ? { ...found, parts, note: notes } : { ...found, parts } };
}

async function listOwnedParts(host: AgentHost, input: ToolInput<'list_owned_parts'>): Promise<ToolOutcome> {
  const lists = listsOf(host);
  if (lists.length === 0) return { ok: true, data: { lists: [], parts: [], total: 0, note: NO_LISTS_NOTE } };
  const library = await withLibrary(host);
  const { colorId, rest } = colourInQuery(input.query);
  const matching = rest === '' ? null : new Set(host.finder().find(rest, { only: ownedPartIds(lists) }).items.map((item) => item.partId));
  const lots = ownedLots(tally(lists, allBricks(modelOf(host)), host.lookup), host.lookup).filter(
    (lot) => (matching === null || matching.has(lot.part)) && (colorId === null || lot.color === colorId) && (!input.only_left || lot.left > 0),
  );
  return {
    ok: true,
    data: {
      lists: lists.map((list) => ({ name: list.name, copies: list.copies })),
      parts: lots.slice(0, input.limit),
      total: lots.length,
      truncated: lots.length > input.limit,
      ...(library ? {} : { note: 'The LDraw library is not available, so only the basic parts among them are listed.' }),
    },
  };
}

async function placeOwnedAware(host: AgentHost, input: ToolInput<'place_bricks'>): Promise<ToolOutcome> {
  if (input.bricks.some((b) => isLDrawPartId(b.part))) await withLibrary(host);
  const outcome = apply(host, placeBricks(modelOf(host), input, { lookup: host.lookup, nextId: host.nextId }));
  const lists = listsOf(host);
  if (!outcome.ok || lists.length === 0) return outcome;
  // building from the user's own parts: say which parts and colours now run past what they have
  const result = outcome.data as { readonly ids: readonly string[] };
  const model = modelOf(host);
  const placed = result.ids.flatMap((id) => model.bricks.get(id) ?? []);
  return { ok: true, data: { ...result, over_owned: overOwned(placed, tally(lists, allBricks(model), host.lookup), host.lookup) } };
}

/** Painting can use up a colour too: with the user's sets known, say which parts in it now run past what they have. */
function paintOwnedAware(host: AgentHost, input: ToolInput<'paint_bricks'>): ToolOutcome {
  const outcome = apply(host, paintBricks(modelOf(host), input, host.lookup));
  const lists = listsOf(host);
  const colour = resolveColour(input.color);
  if (!outcome.ok || lists.length === 0 || colour === null) return outcome;
  const bricks = allBricks(modelOf(host));
  const inColour = bricks.filter((brick) => brick.colorId === colour);
  return { ok: true, data: { ...(outcome.data as object), over_owned: overOwned(inColour, tally(lists, bricks, host.lookup), host.lookup) } };
}

function undoSteps(host: AgentHost, steps: number): ToolOutcome {
  let undone = 0;
  while (undone < steps && canUndo(host.store.getState().history)) {
    host.store.getState().undo();
    undone += 1;
  }
  return { ok: true, data: { undone, brick_count: modelOf(host).bricks.size } };
}

const HANDLERS: { readonly [T in ToolName]: Handler<T> } = {
  get_model: (host, input) => ({ ok: true, data: describeModel(modelOf(host), host.store.getState().name, input, host.lookup) }),
  find_parts: findParts,
  list_colors: () => ({ ok: true, data: { colors: paletteList() } }),
  list_owned_parts: listOwnedParts,
  place_bricks: placeOwnedAware,
  remove_bricks: (host, input) => apply(host, removeBricks(modelOf(host), input, host.lookup)),
  paint_bricks: paintOwnedAware,
  move_bricks: (host, input) => apply(host, moveBricks(modelOf(host), input, host.lookup)),
  clear_model: (host) => apply(host, clearModel(modelOf(host))),
  set_model_name: (host, input) => {
    host.store.getState().setName(input.name);
    return { ok: true, data: { name: host.store.getState().name } };
  },
  look: lookAt,
  undo: (host, input) => undoSteps(host, input.steps),
};

async function runValid<T extends ToolName>(host: AgentHost, tool: T, input: unknown): Promise<ToolOutcome> {
  const parsed = parseToolInput(tool, input);
  if (!parsed.ok) return parsed;
  const handler: Handler<T> = HANDLERS[tool];
  return handler(host, parsed.value);
}

/** Runs one tool call; whatever happens, the agent gets an answer. */
export async function runTool(host: AgentHost, tool: string, input: unknown): Promise<ToolOutcome> {
  if (!isToolName(tool)) return { ok: false, error: `Unknown tool "${tool}".` };
  try {
    return await runValid(host, tool, input);
  } catch (error: unknown) {
    if (error instanceof BuildError) return { ok: false, error: error.message };
    console.error(`Agent tool ${tool} failed`, error);
    return { ok: false, error: `BrickBench could not do that: ${messageOf(error)}` };
  }
}
