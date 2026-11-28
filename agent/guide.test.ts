import { describe, expect, it } from 'bun:test';
import { MAX_INSTRUCTIONS_LENGTH } from '../src/agent/protocol';
import { CHAT_PROMPT, MAX_OWN_INSTRUCTIONS, TOOL_DESCRIPTIONS, withOwnInstructions } from './guide';

describe('the user’s own instructions', () => {
  it('come after BrickBench’s, said to be the user’s', () => {
    expect(withOwnInstructions('Build with BrickBench.', '  Use pastel colours\n')).toBe("Build with BrickBench.\n\nThe user's own instructions for this chat:\nUse pastel colours");
  });

  it('leave BrickBench’s as they are when there are none', () => {
    for (const own of [undefined, '', '   \n ']) expect(withOwnInstructions(CHAT_PROMPT, own)).toBe(CHAT_PROMPT);
  });

  it('are cut to the length the app lets the user write', () => {
    expect(MAX_OWN_INSTRUCTIONS).toBe(MAX_INSTRUCTIONS_LENGTH);
    const given = withOwnInstructions('Base.', 'y'.repeat(MAX_OWN_INSTRUCTIONS + 50));
    expect(given.length).toBe('Base.'.length + "\n\nThe user's own instructions for this chat:\n".length + MAX_OWN_INSTRUCTIONS);
  });

  it('sit beside a look tool that can look from where the user does', () => {
    expect(TOOL_DESCRIPTIONS.look).toContain('user (from where the user is looking)');
  });
});
