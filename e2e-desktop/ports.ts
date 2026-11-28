/** The bridge of the app the main desktop tests open, whose chat runs a stand-in for Claude Code (agent/fixtures/fakeClaude.ts). */
export const AGENT_PORT = 7492;
/** Bridges of apps whose chat runs the stand-in model below: over the Responses API, and over Chat Completions. */
export const API_AGENT_PORT = 7494;
export const CHAT_AGENT_PORT = 7495;
/** A stand-in for a model behind an OpenAI-style API (agent/fixtures/fakeModelApi.ts), which playwright.desktop.config.ts starts. */
export const FAKE_MODEL_PORT = 7496;
