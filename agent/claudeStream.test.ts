import { describe, expect, it } from 'bun:test';
import { createStreamReader, toolSummary } from './claudeStream';

const line = (value: unknown): string => JSON.stringify(value);
const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: `t-${name}`, name, input });

describe('reading Claude Code’s stream', () => {
  it('turns a run into chat events and remembers its session', () => {
    const reader = createStreamReader();
    const events = [
      line({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5-5', tools: [] }),
      line({ type: 'assistant', session_id: 'sess-1', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Walls first.' }] } }),
      line({
        type: 'assistant',
        message: { content: [toolUse('mcp__brickbench__place_bricks', { bricks: [{}, {}, {}] }), toolUse('mcp__brickbench__look', { view: 'front' })] },
      }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{"placed":3}' }] }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'BrickBench is not open.\nAsk the user.' }] } }),
      line({ type: 'result', subtype: 'success', is_error: false, result: 'Built a hut.', session_id: 'sess-1', num_turns: 4, total_cost_usd: 0.0831 }),
    ].flatMap((text) => reader.read(text));
    expect(events).toEqual([
      { type: 'started', model: 'claude-opus-5-5' },
      { type: 'text', text: 'Walls first.' },
      { type: 'tool', tool: 'place_bricks', summary: 'Placing 3 bricks' },
      { type: 'tool', tool: 'look', summary: 'Looking at the model from the front' },
      { type: 'tool', tool: 'error', summary: 'Refused: BrickBench is not open.' },
      { type: 'done', ok: true, turns: 4, costUsd: 0.0831 },
    ]);
    expect(reader.sessionId).toBe('sess-1');
    expect(reader.finished).toBe(true);
  });

  it('reports a failed run with its reason', () => {
    const reader = createStreamReader();
    expect(reader.read(line({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: 's', num_turns: 30 }))).toEqual([
      { type: 'done', ok: false, error: 'The agent stopped: error_max_turns.', turns: 30 },
    ]);
    expect(createStreamReader().read(line({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' }))).toEqual([
      { type: 'done', ok: false, error: 'Credit balance is too low' },
    ]);
  });

  it('skips what it does not understand', () => {
    const reader = createStreamReader();
    expect(reader.read('')).toEqual([]);
    expect(reader.read('not json')).toEqual([]);
    expect(reader.read(line({ type: 'stream_event', event: {} }))).toEqual([]);
    expect(reader.read(line({ type: 'assistant', message: { content: 'odd' } }))).toEqual([]);
    expect(reader.read(line({ type: 'assistant', message: { content: [{ type: 'text', text: '   ' }] } }))).toEqual([]);
    expect(reader.finished).toBe(false);
    expect(reader.sessionId).toBeNull();
  });
});

describe('describing tool calls', () => {
  it('says what the agent is doing in a few words', () => {
    expect(toolSummary('mcp__brickbench__place_bricks', { bricks: [{}] })).toBe('Placing 1 brick');
    expect(toolSummary('mcp__brickbench__find_parts', { query: 'window' })).toBe('Searching parts for “window”');
    expect(toolSummary('mcp__brickbench__paint_bricks', { color: 'Red' })).toBe('Painting bricks Red');
    expect(toolSummary('mcp__brickbench__set_model_name', { name: 'Hut' })).toBe('Naming the model “Hut”');
    expect(toolSummary('mcp__brickbench__look', {})).toBe('Looking at the model');
    expect(toolSummary('mcp__brickbench__look', { view: 'user' })).toBe('Looking at the model from your view');
    expect(toolSummary('mcp__brickbench__get_model', {})).toBe('Reading the model');
    expect(toolSummary('mcp__brickbench__move_bricks', {})).toBe('Moving bricks');
    expect(toolSummary('mcp__brickbench__remove_bricks', {})).toBe('Removing bricks');
    expect(toolSummary('mcp__brickbench__clear_model', {})).toBe('Clearing the model');
    expect(toolSummary('mcp__brickbench__undo', { steps: 2 })).toBe('Undoing 2 steps');
    expect(toolSummary('mcp__brickbench__list_colors', {})).toBe('Reading the colours');
    expect(toolSummary('TodoWrite', {})).toBe('Using TodoWrite');
    expect(toolSummary('mcp__brickbench__list_owned_parts', {})).toBe('Reading your parts');
    expect(toolSummary('mcp__brickbench__place_bricks', null)).toBe('Placing 0 bricks');
    expect(toolSummary('mcp__brickbench__something_new', {})).toBe('Using something_new');
    // fields a model sends are only words when they are text or numbers
    expect(toolSummary('mcp__brickbench__paint_bricks', { color: { toString: 1 } })).toBe('Painting bricks');
    expect(toolSummary('mcp__brickbench__paint_bricks', { color: 4 })).toBe('Painting bricks 4');
  });
});
