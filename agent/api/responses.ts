/**
 * The Responses wire format (POST /responses): how OpenAI's newer models call
 * tools, and xAI's preferred API. Nothing is stored on the provider's side
 * (store: false), so every request carries the whole conversation, reasoning
 * items included, exactly as they came back.
 */
import { z } from 'zod';
import { countParts, replaceParts } from './pictures';
import { dataUrl, PICTURE_REMOVED, PICTURES_NOTE, ReplyError, type ToolCall, type WireFormat } from './types';

const contentPart = z.object({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() }).passthrough();
const messageItem = z.object({ type: z.literal('message'), content: z.array(contentPart) });
const callItem = z.object({ type: z.literal('function_call'), call_id: z.string(), name: z.string(), arguments: z.unknown().optional() });
const reasoningItem = z.object({ type: z.literal('reasoning') });
const replySchema = z.object({
  status: z.string().nullish(),
  output: z.array(z.object({ type: z.string() }).passthrough()),
  incomplete_details: z.object({ reason: z.string().nullish() }).nullish(),
  error: z.object({ message: z.string().nullish() }).nullish(),
});

const IMAGE_PART = 'input_image';

function textOf(output: readonly unknown[]): string {
  return output
    .flatMap((item) => messageItem.safeParse(item).data?.content ?? [])
    .map((part) => (part.type === 'refusal' ? (part.refusal ?? '') : (part.text ?? '')))
    .join('');
}

function cutShort(reply: z.infer<typeof replySchema>): string | null {
  if (reply.status !== 'incomplete') return null;
  const reason = reply.incomplete_details?.reason ?? 'incomplete';
  if (reason === 'max_output_tokens') return 'length';
  return reason === 'content_filter' ? 'filter' : reason;
}

export const responsesApi: WireFormat = {
  path: '/responses',
  body: (model, instructions, conversation, tools, options) => ({
    model,
    instructions,
    input: conversation,
    // strict: false keeps optional arguments optional, as the schemas say
    tools: tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
    store: false,
    // reasoning models need it to carry their reasoning from one round to the next; others refuse it
    ...(options.encryptedReasoning ? { include: ['reasoning.encrypted_content'] } : {}),
  }),
  read(json) {
    const parsed = replySchema.safeParse(json);
    if (!parsed.success) throw new ReplyError('sent a reply BrickBench could not read: it has no output');
    const reply = parsed.data;
    if (reply.error) throw new ReplyError(`could not answer: ${reply.error.message ?? 'no reason given'}`);
    // the items go back exactly as they came, not as read here
    const output = (json as { readonly output: readonly unknown[] }).output;
    const calls: ToolCall[] = output.flatMap((item) => {
      const call = callItem.safeParse(item).data;
      return call ? [{ id: call.call_id, name: call.name, arguments: call.arguments ?? '{}' }] : [];
    });
    // reasoning cut off before what it led to cannot go back: the API refuses it without the item that follows
    const answered = output.findLastIndex((item) => reasoningItem.safeParse(item).success === false);
    return { text: textOf(output), calls, items: output.slice(0, answered + 1), cutShort: cutShort(reply) };
  },
  user: (text) => ({ role: 'user', content: text }),
  results(results) {
    const answers = results.map((result) => ({ type: 'function_call_output', call_id: result.id, output: result.text }));
    const pictures = results.flatMap((result) => (result.picture ? [result.picture] : []));
    if (pictures.length === 0) return answers;
    const shown = pictures.map((picture) => ({ type: IMAGE_PART, image_url: dataUrl(picture), detail: 'high' }));
    return [...answers, { role: 'user', content: [{ type: 'input_text', text: PICTURES_NOTE }, ...shown] }];
  },
  // every item goes back as it came, earlier reasoning too
  settled: (conversation) => [...conversation],
  pictures: (conversation) => countParts(conversation, IMAGE_PART),
  withoutPictures: (conversation, keep) => replaceParts(conversation, IMAGE_PART, keep, { type: 'input_text', text: PICTURE_REMOVED }),
};
