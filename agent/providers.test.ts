import { describe, expect, it } from 'bun:test';
import { chooseAgent, type AgentChoice, type ApiSettings } from './providers';

const settingsOf = (choice: AgentChoice): ApiSettings => {
  if (choice.kind !== 'api') throw new Error(`expected an API, got ${JSON.stringify(choice)}`);
  return choice.settings;
};

describe('choosing the chat’s agent', () => {
  it('runs Claude Code unless told otherwise', () => {
    expect(chooseAgent({})).toEqual({ kind: 'claude' });
    expect(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: ' Claude ' })).toEqual({ kind: 'claude' });
  });

  it('runs GPT on OpenAI’s Responses API with OPENAI_API_KEY, and a default model', () => {
    expect(settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-1' }))).toEqual({
      provider: 'openai',
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      api: 'responses',
      model: 'gpt-6.2-sol',
      apiKey: 'sk-1',
      keyVariable: 'OPENAI_API_KEY',
      local: false,
    });
  });

  it('runs Grok on xAI with XAI_API_KEY, and the model asked for', () => {
    expect(settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'xai', XAI_API_KEY: 'xai-1', BRICKBENCH_AGENT_MODEL: 'grok-4.6' }))).toMatchObject({
      label: 'xAI',
      baseUrl: 'https://api.x.ai/v1',
      api: 'responses',
      model: 'grok-4.6',
      apiKey: 'xai-1',
    });
  });

  it('runs a model on this computer through Ollama or LM Studio with no key, over Chat Completions', () => {
    expect(settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_MODEL: 'qwen3.5:9b' }))).toEqual({
      provider: 'ollama',
      label: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      api: 'chat',
      model: 'qwen3.5:9b',
      apiKey: undefined,
      keyVariable: undefined,
      local: true,
    });
    expect(settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'lmstudio', BRICKBENCH_AGENT_MODEL: 'm' }))).toMatchObject({ baseUrl: 'http://127.0.0.1:1234/v1', local: true });
  });

  it('takes the key from another variable, the API from another address, and the other wire format, when asked', () => {
    const settings = settingsOf(
      chooseAgent({
        BRICKBENCH_AGENT_PROVIDER: 'ollama',
        BRICKBENCH_AGENT_MODEL: 'm',
        BRICKBENCH_AGENT_BASE_URL: 'https://gpu.example.com/v1/',
        BRICKBENCH_AGENT_API: 'Responses',
        BRICKBENCH_AGENT_API_KEY_VAR: 'GPU_KEY',
        GPU_KEY: 'k',
      }),
    );
    expect(settings).toMatchObject({ baseUrl: 'https://gpu.example.com/v1', api: 'responses', apiKey: 'k', keyVariable: 'GPU_KEY', local: false });
  });

  it('names a custom API by its address, and needs a key only when told where one is', () => {
    expect(settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'custom', BRICKBENCH_AGENT_BASE_URL: 'http://localhost:8080/v1', BRICKBENCH_AGENT_MODEL: 'm' }))).toMatchObject({
      label: 'localhost:8080',
      api: 'chat',
      apiKey: undefined,
      local: true,
    });
    expect(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'custom', BRICKBENCH_AGENT_BASE_URL: 'https://api.example.com/v1', BRICKBENCH_AGENT_API_KEY_VAR: 'EX_KEY', BRICKBENCH_AGENT_MODEL: 'm' })).toEqual({
      kind: 'unavailable',
      reason: 'Set EX_KEY to your API key, then restart the bridge.',
    });
  });

  it('says where an API is when it is not at the provider’s own address', () => {
    expect(settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_MODEL: 'm', BRICKBENCH_AGENT_BASE_URL: 'http://192.168.1.5:11434/v1' }))).toMatchObject({
      label: 'Ollama at 192.168.1.5:11434',
      local: false,
    });
    expect(settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_MODEL: 'm', BRICKBENCH_AGENT_BASE_URL: 'http://127.0.0.1:11434/v1' })).label).toBe('Ollama');
  });

  it('notes a spending cap it cannot keep, and a key that would go unencrypted', () => {
    const noted = chooseAgent({
      BRICKBENCH_AGENT_PROVIDER: 'custom',
      BRICKBENCH_AGENT_BASE_URL: 'http://gpu.example.com/v1',
      BRICKBENCH_AGENT_API_KEY_VAR: 'GPU_KEY',
      GPU_KEY: 'k',
      BRICKBENCH_AGENT_MODEL: 'm',
      BRICKBENCH_AGENT_BUDGET_USD: '2',
    });
    expect(noted.kind === 'api' ? noted.notes : []).toEqual([
      expect.stringContaining('BRICKBENCH_AGENT_BUDGET_USD caps what Claude Code spends'),
      'Your API key goes to gpu.example.com unencrypted, over http: use an https address unless you trust every network on the way.',
    ]);
    const quiet = chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_MODEL: 'm', BRICKBENCH_AGENT_API_KEY_VAR: 'K', K: 'k' });
    expect(quiet.kind === 'api' ? quiet.notes : null).toEqual([]);
  });

  it('never repeats what may be a key: one set as the variable’s name, or one with characters no key has', () => {
    const named = chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openai', BRICKBENCH_AGENT_API_KEY_VAR: 'gsk_AbC123dEf456' });
    expect(named).toEqual({ kind: 'unavailable', reason: 'Put your OpenAI API key in the variable that BRICKBENCH_AGENT_API_KEY_VAR names, then restart the bridge.' });
    const pasted = chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-abc def…' });
    expect(pasted).toEqual({ kind: 'unavailable', reason: 'The API key in OPENAI_API_KEY has characters no key has, such as spaces: set it again, then restart the bridge.' });
    const both = chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openai', BRICKBENCH_AGENT_API_KEY_VAR: 'lower_case', lower_case: 'x y' });
    expect(both).toMatchObject({ reason: expect.stringContaining('The API key in the variable that BRICKBENCH_AGENT_API_KEY_VAR names') });
    // a variable named as variables usually are is shown; any other is not
    const unusual = settingsOf(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openai', BRICKBENCH_AGENT_API_KEY_VAR: 'my_key', my_key: 'sk-1' }));
    expect(unusual).toMatchObject({ apiKey: 'sk-1', keyVariable: undefined });
  });

  it('leaves the chat unavailable, saying why, without a key or a model', () => {
    expect(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openai', OPENAI_API_KEY: '  ' })).toEqual({ kind: 'unavailable', reason: 'Set OPENAI_API_KEY to your OpenAI API key, then restart the bridge.' });
    expect(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' })).toEqual({
      kind: 'unavailable',
      reason: 'Choose the model: set BRICKBENCH_AGENT_MODEL to its name (as openrouter.ai/models names it), then restart the bridge.',
    });
    expect(chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama' })).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('`ollama list` shows yours') });
  });

  it('stops the bridge on a setting that is malformed', () => {
    expect(() => chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'gemini' })).toThrow('BRICKBENCH_AGENT_PROVIDER must be one of claude, openai, xai, openrouter, ollama, lmstudio, custom, not "gemini".');
    expect(() => chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'custom', BRICKBENCH_AGENT_MODEL: 'm' })).toThrow('needs BRICKBENCH_AGENT_BASE_URL');
    expect(() => chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_BASE_URL: 'not a url' })).toThrow('must be an http or https address');
    expect(() => chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_BASE_URL: 'ftp://x/v1' })).toThrow('must be an http or https address');
    expect(() => chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'ollama', BRICKBENCH_AGENT_API: 'grpc' })).toThrow('BRICKBENCH_AGENT_API must be chat or responses');
    // without repeating the value, which may be the key itself
    const mistake = (() => {
      try {
        chooseAgent({ BRICKBENCH_AGENT_PROVIDER: 'openai', BRICKBENCH_AGENT_API_KEY_VAR: 'sk-actual-key' });
        return '';
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    })();
    expect(mistake).toContain('must be the name of the environment variable that holds the API key');
    expect(mistake).not.toContain('sk-actual-key');
  });
});
