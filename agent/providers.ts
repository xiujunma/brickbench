/**
 * Which agent answers the app's chat, from the bridge's environment: Claude
 * Code (the default), or a model behind an API, with its provider, the
 * variable that holds the API key, the model and the wire format.
 */
import { MAX_ROUNDS } from './api/apiRunner';
import { isLocalHost } from './origins';

export const PROVIDER_NAMES = ['claude', 'openai', 'xai', 'openrouter', 'ollama', 'lmstudio', 'custom'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
export type ApiProviderName = Exclude<ProviderName, 'claude'>;
/** Chat Completions or the Responses API. */
export type WireApi = 'chat' | 'responses';

interface Preset {
  /** Who runs the models, for the chat; for a custom API, its address names it. */
  readonly label: string | null;
  readonly baseUrl: string | null;
  readonly api: WireApi;
  /** Where the API key is unless BRICKBENCH_AGENT_API_KEY_VAR says otherwise; null if none is needed. */
  readonly keyVariable: string | null;
  /** The model unless BRICKBENCH_AGENT_MODEL says otherwise: only where one model fits most people. */
  readonly model: string | null;
  /** Where to find the names of its models, for when none is set. */
  readonly modelHint: string;
}

/**
 * OpenAI's models call tools through the Responses API only, and it is xAI's
 * preferred API; the rest speak Chat Completions. Default models as of
 * November 2026: OpenAI's everyday model and xAI's flagship.
 */
const PRESETS: Readonly<Record<ApiProviderName, Preset>> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    api: 'responses',
    keyVariable: 'OPENAI_API_KEY',
    model: 'gpt-6.2-sol',
    modelHint: 'such as gpt-6.2-sol',
  },
  xai: { label: 'xAI', baseUrl: 'https://api.x.ai/v1', api: 'responses', keyVariable: 'XAI_API_KEY', model: 'grok-4.7', modelHint: 'such as grok-4.7' },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'chat',
    keyVariable: 'OPENROUTER_API_KEY',
    model: null,
    modelHint: 'as openrouter.ai/models names it',
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    api: 'chat',
    keyVariable: null,
    model: null,
    modelHint: '`ollama list` shows yours',
  },
  lmstudio: {
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    api: 'chat',
    keyVariable: null,
    model: null,
    modelHint: 'as LM Studio lists it',
  },
  custom: { label: null, baseUrl: null, api: 'chat', keyVariable: null, model: null, modelHint: 'as the API names it' },
};

export interface ApiSettings {
  readonly provider: ApiProviderName;
  /** Who runs the model, for the chat: the provider, and where if not at its usual address. */
  readonly label: string;
  readonly baseUrl: string;
  readonly api: WireApi;
  readonly model: string;
  readonly apiKey: string | undefined;
  /** The variable the key is in, for messages; left out when its name could be a key, set there by mistake. */
  readonly keyVariable: string | undefined;
  /** The API is on this computer, as Ollama and LM Studio are. */
  readonly local: boolean;
}

export type AgentChoice =
  | { readonly kind: 'claude' }
  /** `notes` are for the user when the bridge starts. */
  | { readonly kind: 'api'; readonly settings: ApiSettings; readonly notes: readonly string[] }
  /** Set up, but missing something it needs; the chat says what. */
  | { readonly kind: 'unavailable'; readonly reason: string };

export type Environment = Readonly<Record<string, string | undefined>>;

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A variable's name worth repeating: the usual shape, which keys made of letters and digits alone do not have. */
const SHOWN_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** What an API key holds: printable ASCII, no spaces; anything else would not even go in a request header. */
const KEY_CHARACTERS = /^[\x21-\x7e]+$/;
const KEY_SETTING = 'the variable that BRICKBENCH_AGENT_API_KEY_VAR names';

function read(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function isProvider(name: string): name is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(name);
}

function providerOf(env: Environment): ProviderName {
  const value = read(env, 'BRICKBENCH_AGENT_PROVIDER')?.toLowerCase() ?? 'claude';
  if (isProvider(value)) return value;
  throw new Error(`BRICKBENCH_AGENT_PROVIDER must be one of ${PROVIDER_NAMES.join(', ')}, not "${value}".`);
}

function baseUrlOf(env: Environment, provider: ApiProviderName, preset: Preset): string {
  const value = read(env, 'BRICKBENCH_AGENT_BASE_URL');
  if (value === undefined) {
    if (preset.baseUrl) return preset.baseUrl;
    throw new Error(`BRICKBENCH_AGENT_PROVIDER=${provider} needs BRICKBENCH_AGENT_BASE_URL: the address of an OpenAI-compatible API, such as http://127.0.0.1:8080/v1.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`BRICKBENCH_AGENT_BASE_URL must be an http or https address, not "${value}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`BRICKBENCH_AGENT_BASE_URL must be an http or https address, not "${value}".`);
  return value.replace(/\/+$/, '');
}

function apiOf(env: Environment, preset: Preset): WireApi {
  const value = read(env, 'BRICKBENCH_AGENT_API')?.toLowerCase();
  if (value === undefined) return preset.api;
  if (value === 'chat' || value === 'responses') return value;
  throw new Error(`BRICKBENCH_AGENT_API must be chat or responses, not "${value}".`);
}

function keyVariableOf(env: Environment, preset: Preset): string | undefined {
  const value = read(env, 'BRICKBENCH_AGENT_API_KEY_VAR');
  if (value === undefined) return preset.keyVariable ?? undefined;
  if (VARIABLE_NAME.test(value)) return value;
  // the value is not repeated: it may be the key itself, set here by mistake
  throw new Error('BRICKBENCH_AGENT_API_KEY_VAR must be the name of the environment variable that holds the API key, such as MY_API_KEY, not the key itself.');
}

function notesFor(env: Environment, settings: ApiSettings): string[] {
  const notes: string[] = [];
  if (read(env, 'BRICKBENCH_AGENT_BUDGET_USD') !== undefined) {
    notes.push(`BRICKBENCH_AGENT_BUDGET_USD caps what Claude Code spends; it does not apply to ${settings.label}, where a request stops after ${MAX_ROUNDS} rounds of tool calls instead.`);
  }
  const url = new URL(settings.baseUrl);
  if (settings.apiKey && url.protocol === 'http:' && !settings.local) {
    notes.push(`Your API key goes to ${url.host} unencrypted, over http: use an https address unless you trust every network on the way.`);
  }
  return notes;
}

/**
 * Reads the chat's settings. Throws on a setting that is malformed, so the
 * bridge stops and says so; a missing key or model leaves the chat
 * unavailable with the reason, while other agents can still connect.
 */
export function chooseAgent(env: Environment): AgentChoice {
  const provider = providerOf(env);
  if (provider === 'claude') return { kind: 'claude' };
  const preset = PRESETS[provider];
  const baseUrl = baseUrlOf(env, provider, preset);
  const api = apiOf(env, preset);
  const { host } = new URL(baseUrl);
  // a preset sent elsewhere says where, so no one takes it for the provider's own
  const label = preset.label === null ? host : baseUrl === preset.baseUrl ? preset.label : `${preset.label} at ${host}`;
  const keyVariable = keyVariableOf(env, preset);
  const shownVariable = keyVariable !== undefined && SHOWN_NAME.test(keyVariable) ? keyVariable : undefined;
  const apiKey = keyVariable ? read(env, keyVariable) : undefined;
  if (keyVariable && apiKey === undefined) {
    const key = `your ${preset.label ? `${preset.label} ` : ''}API key`;
    const reason = shownVariable ? `Set ${shownVariable} to ${key}, then restart the bridge.` : `Put ${key} in ${KEY_SETTING}, then restart the bridge.`;
    return { kind: 'unavailable', reason };
  }
  if (apiKey !== undefined && !KEY_CHARACTERS.test(apiKey)) {
    return { kind: 'unavailable', reason: `The API key in ${shownVariable ?? KEY_SETTING} has characters no key has, such as spaces: set it again, then restart the bridge.` };
  }
  const model = read(env, 'BRICKBENCH_AGENT_MODEL') ?? preset.model;
  if (model === null) {
    return { kind: 'unavailable', reason: `Choose the model: set BRICKBENCH_AGENT_MODEL to its name (${preset.modelHint}), then restart the bridge.` };
  }
  const settings: ApiSettings = { provider, label, baseUrl, api, model, apiKey, keyVariable: shownVariable, local: isLocalHost(host) };
  return { kind: 'api', settings, notes: notesFor(env, settings) };
}
