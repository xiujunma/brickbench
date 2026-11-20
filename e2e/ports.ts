/** The app's test server. */
export const APP_PORT = 5199;
/** The agent bridge for tests, off the default port so a bridge you run yourself is left alone. */
export const AGENT_PORT = 7499;
/** Test bridges whose chat runs a model behind an API, the stand-in below: over the Responses API, and over Chat Completions. */
export const API_AGENT_PORT = 7497;
export const CHAT_AGENT_PORT = 7495;
/** A stand-in for a model behind an OpenAI-style Responses API (agent/fixtures/fakeModelApi.ts). */
export const FAKE_MODEL_PORT = 7496;
/** The accounts and gallery API, on a database that lasts as long as the tests (server/local.ts). */
export const API_PORT = 7490;
