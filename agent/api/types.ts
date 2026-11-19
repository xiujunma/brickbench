/**
 * What the chat's API runner needs from a model API, whichever wire format it
 * speaks: Chat Completions (OpenRouter, Ollama, LM Studio and most others) or
 * the Responses API (OpenAI's tool calling, xAI).
 */

/** A function the model may call: one of BrickBench's tools. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the call's arguments. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** A call the model asked for. */
export interface ToolCall {
  /** The id its answer has to quote. */
  readonly id: string;
  readonly name: string;
  /** As the model wrote them: JSON text, or already parsed by the server. */
  readonly arguments: unknown;
}

/** What one request to the model gave back. */
export interface Reply {
  /** What the model said to the user, if anything. */
  readonly text: string;
  readonly calls: readonly ToolCall[];
  /** The reply as the conversation keeps it: sent back, unchanged, with every later request. */
  readonly items: readonly unknown[];
  /** Why the reply stopped short, such as running out of room; null when it finished. */
  readonly cutShort: string | null;
}

export interface Picture {
  /** Base64, without the data: prefix. */
  readonly data: string;
  readonly mimeType: string;
}

/** A tool call's answer, for the model. */
export interface CallResult {
  readonly id: string;
  readonly text: string;
  /** For models that can see: the picture the look tool drew. */
  readonly picture?: Picture | undefined;
}

export interface BodyOptions {
  /** Ask for the model's reasoning, encrypted, so it can go back with the rest; off for a model that refuses to give it. */
  readonly encryptedReasoning: boolean;
}

/** One API's way of writing the conversation down and reading the model's replies. */
export interface WireFormat {
  /** Where requests go, after the API's base address. */
  readonly path: string;
  body(model: string, instructions: string, conversation: readonly unknown[], tools: readonly ToolSpec[], options: BodyOptions): unknown;
  /** Reads a reply; throws ReplyError if it is not one. */
  read(json: unknown): Reply;
  user(text: string): unknown;
  /** Each call's answer, then any pictures, shown to the model as the user's message. */
  results(results: readonly CallResult[]): unknown[];
  /** Earlier requests' share of the conversation, as a new request carries it. */
  settled(conversation: readonly unknown[]): unknown[];
  /** How many pictures the conversation holds. */
  pictures(conversation: readonly unknown[]): number;
  /** The conversation with all but its last `keep` pictures taken out, each leaving a note in its place. */
  withoutPictures(conversation: readonly unknown[], keep: number): unknown[];
}

/** A reply that is not a usable answer. Its message follows the provider's name: "xAI could not answer: …". */
export class ReplyError extends Error {
  override readonly name = 'ReplyError';
}

/** Said to the model before the pictures it asked for. */
export const PICTURES_NOTE = 'The pictures the look tool drew, in the order asked for:';
/** Left where an earlier picture was, so later requests stay light. */
export const PICTURE_REMOVED = '(An earlier picture of the model, no longer shown.)';

export const dataUrl = (picture: Picture): string => `data:${picture.mimeType};base64,${picture.data}`;
