import { describe, expect, it } from 'bun:test';
import { TOOL_NAMES, type ToolName } from '../../src/agent/protocol';
import { TOOL_DESCRIPTIONS } from '../guide';
import { argumentsOf, runCall, TOOL_SPECS, type ToolRunner } from './tools';

function recorder() {
  const calls: { tool: ToolName; input: unknown }[] = [];
  const run: ToolRunner = (tool, input) => {
    calls.push({ tool, input });
    return Promise.resolve({ ok: true, data: { ran: tool } });
  };
  return { calls, run };
}

describe('BrickBench’s tools as functions', () => {
  it('offers every tool with its description and the schema of its arguments', () => {
    expect(TOOL_SPECS.map((spec) => spec.name)).toEqual(TOOL_NAMES);
    for (const spec of TOOL_SPECS) {
      expect(spec.description).toBe(TOOL_DESCRIPTIONS[spec.name as ToolName]);
      expect(spec.parameters['type']).toBe('object');
      expect(spec.parameters).not.toHaveProperty('$schema');
    }
  });

  it('leaves arguments with defaults for the model to leave out', () => {
    const place = TOOL_SPECS.find((spec) => spec.name === 'place_bricks')?.parameters as { required: string[]; properties: Record<string, unknown> };
    expect(place.required).toEqual(['bricks']);
    expect(place.properties['all_or_nothing']).toMatchObject({ type: 'boolean', default: false });
  });
});

describe('reading a call’s arguments', () => {
  it('takes JSON text, nothing at all, or an object a server has parsed already', () => {
    expect(argumentsOf('{"view":"top"}')).toEqual({ ok: true, value: { view: 'top' } });
    expect(argumentsOf('  ')).toEqual({ ok: true, value: {} });
    expect(argumentsOf(undefined)).toEqual({ ok: true, value: {} });
    expect(argumentsOf({ view: 'top' })).toEqual({ ok: true, value: { view: 'top' } });
  });

  it('says what is wrong with arguments that are not JSON', () => {
    const read = argumentsOf('{"view":');
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.error).toStartWith('The arguments were not valid JSON');
  });
});

describe('running a call', () => {
  it('runs the tool with its arguments checked and defaults filled in', async () => {
    const tools = recorder();
    expect(await runCall({ id: 'c1', name: 'look', arguments: '{"view":"top"}' }, tools.run)).toEqual({ ok: true, data: { ran: 'look' } });
    expect(tools.calls).toEqual([{ tool: 'look', input: { view: 'top', highlight: [] } }]);
  });

  it('sends back, without running anything, a call to no tool, or with arguments that do not fit', async () => {
    const tools = recorder();
    expect(await runCall({ id: 'c1', name: 'rm_rf', arguments: '{}' }, tools.run)).toMatchObject({ ok: false, error: expect.stringContaining('There is no tool called "rm_rf"') });
    expect(await runCall({ id: 'c2', name: 'look', arguments: '{oops' }, tools.run)).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') });
    expect(await runCall({ id: 'c3', name: 'look', arguments: '{"view":"sideways"}' }, tools.run)).toMatchObject({ ok: false, error: expect.stringContaining('Invalid input for look') });
    expect(tools.calls).toEqual([]);
  });
});
