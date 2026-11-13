/**
 * Runs an agent's tool call against the editor: checks the input, makes the
 * change as one step the user can undo, and answers in words the agent can
 * act on. Library parts are loaded on demand.
 */
import type { StoreApi } from 'zustand/vanilla';
import { canUndo } from '../core/history';
import type { SceneSettings } from '../core/io/modelFile';
import { isLDrawPartId } from '../core/ldraw/catalogIndex';
import type { IdFactory } from '../core/model/ids';
import { allBricks } from '../core/model/model';
import type { Brick, Model } from '../core/model/types';
import type { Finder } from '../core/parts/finder/finder';
import type { PartLookup } from '../core/parts/types';
import type { EditorState } from '../state/types';
import { BuildError, clearModel, describeModel, moveBricks, paintBricks, placeBricks, removeBricks, type Change } from './build';
import { paletteList, searchParts } from './catalog';
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
  find_parts: async (host, input) => {
    const library = await withLibrary(host);
    const found = searchParts(host.finder(), input.query, input.limit);
    return { ok: true, data: library ? found : { ...found, note: LIBRARY_NOTE } };
  },
  list_colors: () => ({ ok: true, data: { colors: paletteList() } }),
  place_bricks: async (host, input) => {
    if (input.bricks.some((b) => isLDrawPartId(b.part))) await withLibrary(host);
    return apply(host, placeBricks(modelOf(host), input, { lookup: host.lookup, nextId: host.nextId }));
  },
  remove_bricks: (host, input) => apply(host, removeBricks(modelOf(host), input, host.lookup)),
  paint_bricks: (host, input) => apply(host, paintBricks(modelOf(host), input, host.lookup)),
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
