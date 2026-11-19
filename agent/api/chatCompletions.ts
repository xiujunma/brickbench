/**
 * The Chat Completions wire format (POST /chat/completions), which OpenRouter,
 * Ollama, LM Studio and most OpenAI-compatible servers speak. A tool's answer
 * cannot carry a picture here, so pictures follow as the user's message.
 */
import { z } from 'zod';
import { countParts, replaceParts } from './pictures';
import { dataUrl, PICTURE_REMOVED, PICTURES_NOTE, ReplyError, type ToolCall, type WireFormat } from './types';

const contentPart = z.object({ type: z.string(), text: z.string().optional() }).passthrough();
const toolCallSchema = z.object({
  id: z.string().nullish(),
  function: z.object({ name: z.string(), arguments: z.unknown().optional() }),
});
const choiceSchema = z.object({
  message: z.object({
    content: z.union([z.string(), z.array(contentPart)]).nullish(),
    refusal: z.string().nullish(),
    tool_calls: z.array(toolCallSchema).nullish(),
  }),
  finish_reason: z.string().nullish(),
});
const replySchema = z.object({ choices: z.array(choiceSchema).min(1) });
const errorReply = z.object({ error: z.object({ message: z.string() }) });

type Fields = Readonly<Record<string, unknown>>;

const IMAGE_PART = 'image_url';
/**
 * Where providers put a reply's reasoning (DeepSeek, OpenRouter, Ollama). It
 * goes back as it came while the request's tool calls go on, which some
 * models require, and is left out once the user asks something new.
 */
const REASONING_FIELDS: readonly string[] = ['reasoning_content', 'reasoning', 'reasoning_details'];

function textOf(content: z.infer<typeof choiceSchema>['message']['content']): string {
  if (typeof content === 'string') return content;
  return (content ?? []).map((part) => part.text ?? '').join('');
}

/** Arguments as the conversation keeps them: JSON text, or `{}` for text that is not JSON, which servers that re-read the conversation refuse. */
function keptArguments(args: unknown): string {
  if (typeof args !== 'string') return JSON.stringify(args ?? {});
  try {
    JSON.parse(args);
    return args;
  } catch {
    // the model has been told its arguments were not JSON
    return '{}';
  }
}

function cutShort(finish: string | null | undefined): string | null {
  if (finish === 'length') return 'length';
  return finish === 'content_filter' ? 'filter' : null;
}

const fieldsOf = (value: unknown): Fields => (typeof value === 'object' && value !== null ? (value as Fields) : {});

/** The reply as the provider sent it, with every field of its own, the calls' ids and arguments made fit to send back. */
function kept(message: Fields, calls: readonly ToolCall[]): Fields {
  const { tool_calls: sentCalls, ...rest } = message;
  if (calls.length === 0) return { ...rest, role: 'assistant', content: rest['content'] ?? '' };
  const sent = Array.isArray(sentCalls) ? sentCalls : [];
  const toolCalls = calls.map((call, at) => {
    const original = fieldsOf(sent[at]);
    return { ...original, id: call.id, type: 'function', function: { ...fieldsOf(original['function']), name: call.name, arguments: keptArguments(call.arguments) } };
  });
  return { ...rest, role: 'assistant', content: rest['content'] ?? null, tool_calls: toolCalls };
}

export const chatCompletions: WireFormat = {
  path: '/chat/completions',
  body: (model, instructions, conversation, tools) => ({
    model,
    messages: [{ role: 'system', content: instructions }, ...conversation],
    tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
    stream: false,
  }),
  read(json) {
    const choice = replySchema.safeParse(json).data?.choices[0];
    if (!choice) {
      // some providers answer a failure with 200 and an error
      const failure = errorReply.safeParse(json).data;
      throw new ReplyError(failure ? `could not answer: ${failure.error.message}` : 'sent a reply BrickBench could not read: it has no message');
    }
    const { message } = choice;
    const calls: ToolCall[] = (message.tool_calls ?? []).map((call) => ({
      // a server that leaves ids out still needs answers that quote one
      id: call.id || `call_${crypto.randomUUID()}`,
      name: call.function.name,
      arguments: call.function.arguments ?? '{}',
    }));
    const original = fieldsOf((json as { readonly choices: readonly { readonly message: unknown }[] }).choices[0]?.message);
    return { text: textOf(message.content) || (message.refusal ?? ''), calls, items: [kept(original, calls)], cutShort: cutShort(choice.finish_reason) };
  },
  user: (text) => ({ role: 'user', content: text }),
  results(results) {
    const answers = results.map((result) => ({ role: 'tool', tool_call_id: result.id, content: result.text }));
    const pictures = results.flatMap((result) => (result.picture ? [result.picture] : []));
    if (pictures.length === 0) return answers;
    const shown = pictures.map((picture) => ({ type: IMAGE_PART, image_url: { url: dataUrl(picture) } }));
    return [...answers, { role: 'user', content: [{ type: 'text', text: PICTURES_NOTE }, ...shown] }];
  },
  settled: (conversation) =>
    conversation.map((item) => {
      const fields = fieldsOf(item);
      if (fields['role'] !== 'assistant' || !REASONING_FIELDS.some((field) => field in fields)) return item;
      return Object.fromEntries(Object.entries(fields).filter(([field]) => !REASONING_FIELDS.includes(field)));
    }),
  pictures: (conversation) => countParts(conversation, IMAGE_PART),
  withoutPictures: (conversation, keep) => replaceParts(conversation, IMAGE_PART, keep, { type: 'text', text: PICTURE_REMOVED }),
};
