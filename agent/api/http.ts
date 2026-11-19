/**
 * One request to a model API: JSON there and back, a couple of retries while
 * the provider is busy, and failures sorted so the chat can say what went wrong.
 */

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'stopped' | 'reply';

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    /** The HTTP status, for kind "http". */
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface PostOptions {
  readonly url: string;
  readonly apiKey?: string | undefined;
  readonly body: unknown;
  /** Aborted when the user stops the request. */
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** How long to wait before each retry of a busy provider: one retry per entry. */
  readonly retryDelaysMs: readonly number[];
}

/** The longest a provider may ask us to wait (Retry-After) before the request gives up instead. */
const MAX_RETRY_AFTER_MS = 30_000;
/** Busy, overloaded or briefly broken: worth another try. */
const RETRY_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504, 529]);
/** Out of credit or over a spending limit: waiting does not help. */
const NO_CREDIT = /quota|credit|spend|billing|usage_limit|insufficient/i;
const MAX_MESSAGE = 400;

const stopped = (): ApiError => new ApiError('Stopped.', 'stopped');

/** The message (and code, if any) in an error reply, whichever way the provider words it. */
export function errorMessageOf(text: string): { readonly message: string; readonly code: string } {
  try {
    const json = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
    const error = typeof json.error === 'object' && json.error !== null ? (json.error as { message?: unknown; code?: unknown }) : null;
    const found = [error?.message, json.error, json.message, json.detail].find((value) => typeof value === 'string' && value.trim() !== '');
    const code = typeof error?.code === 'string' ? error.code : '';
    if (typeof found === 'string') return { message: found.trim().slice(0, MAX_MESSAGE), code };
  } catch {
    // not JSON: the text itself is the message
  }
  // a proxy's error page, say: its title, not its markup
  if (/^\s*</.test(text)) {
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
    return { message: title ? `a web page, “${title.slice(0, MAX_MESSAGE)}”` : 'a web page instead of an API reply', code: '' };
  }
  return { message: text.trim().slice(0, MAX_MESSAGE) || 'no details given', code: '' };
}

/** How long to wait before trying again, or null to give up now. */
function retryWait(response: Response, error: { message: string; code: string }, delayMs: number | undefined): number | null {
  if (delayMs === undefined || !RETRY_STATUSES.has(response.status) || NO_CREDIT.test(`${error.code} ${error.message}`)) return null;
  // seconds, or a date; anything else, and the usual wait
  const header = response.headers.get('retry-after')?.trim();
  if (!header) return delayMs;
  const asked = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(asked)) return delayMs;
  return asked > MAX_RETRY_AFTER_MS ? null : Math.max(asked, 0);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(stopped());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(stopped());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function networkMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : typeof error.cause === 'string' ? error.cause : '';
  return cause && !error.message.includes(cause) ? `${error.message}: ${cause}` : error.message;
}

const duration = (ms: number): string => (ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} minutes`);

/** Why a request or its reply broke off: the user stopped it, it took too long, or the connection failed. */
function brokenOff(error: unknown, options: PostOptions, timeout: AbortSignal): ApiError {
  if (options.signal.aborted) return stopped();
  if (timeout.aborted) return new ApiError(`did not answer within ${duration(options.timeoutMs)}`, 'timeout');
  return new ApiError(networkMessage(error), 'network');
}

async function attempt(options: PostOptions): Promise<{ readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly response: Response; readonly text: string }> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
      body: JSON.stringify(options.body),
      signal: AbortSignal.any([options.signal, timeout]),
    });
  } catch (error: unknown) {
    throw brokenOff(error, options, timeout);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error: unknown) {
    throw brokenOff(error, options, timeout);
  }
  if (!response.ok) return { ok: false, response, text };
  try {
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch {
    throw new ApiError('sent a reply that is not JSON', 'reply', response.status);
  }
}

/** POSTs JSON and gives back the reply's JSON; throws ApiError when that cannot be had. */
export async function postJson(options: PostOptions): Promise<unknown> {
  for (let tries = 0; ; tries += 1) {
    const result = await attempt(options);
    if (result.ok) return result.json;
    const error = errorMessageOf(result.text);
    const wait = retryWait(result.response, error, options.retryDelaysMs[tries]);
    if (wait === null) throw new ApiError(error.message, 'http', result.response.status);
    await pause(wait, options.signal);
  }
}
