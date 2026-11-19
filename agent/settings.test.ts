import { describe, expect, it } from 'bun:test';
import { budgetOf, DEFAULT_BUDGET_USD, DEFAULT_PORT, portOf, readSetting } from './settings';

describe('the bridge’s settings', () => {
  it('reads a setting, leaving blanks unset', () => {
    expect(readSetting({ A: ' x ' }, 'A')).toBe('x');
    expect(readSetting({ A: '  ' }, 'A')).toBeUndefined();
    expect(readSetting({}, 'A')).toBeUndefined();
  });

  it('takes the port, or the usual one', () => {
    expect(portOf({})).toBe(DEFAULT_PORT);
    expect(portOf({ BRICKBENCH_AGENT_PORT: '7500' })).toBe(7500);
    expect(() => portOf({ BRICKBENCH_AGENT_PORT: '99999' })).toThrow('BRICKBENCH_AGENT_PORT must be a port number, not "99999".');
  });

  it('takes Claude Code’s spending cap, the usual one, or none', () => {
    expect(budgetOf({})).toBe(DEFAULT_BUDGET_USD);
    expect(budgetOf({ BRICKBENCH_AGENT_BUDGET_USD: '2.5' })).toBe(2.5);
    expect(budgetOf({ BRICKBENCH_AGENT_BUDGET_USD: 'None' })).toBeUndefined();
    expect(() => budgetOf({ BRICKBENCH_AGENT_BUDGET_USD: '-1' })).toThrow('must be a positive amount or "none"');
  });
});
