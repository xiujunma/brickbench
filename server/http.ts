/** Requests in, responses out: JSON bodies, cookies, errors and the headers every API response carries. */
import type { z } from 'zod';

/** API responses are data, never pages: nothing in them may run, frame or be sniffed into something else. */
const API_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  // browsers come back over HTTPS only (they ignore this when it comes over plain HTTP, as on this computer)
  'Strict-Transport-Security': 'max-age=31536000',
};

/** A request the API turns down, with the status and the message the site shows. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

function respond(body: BodyInit | null, status: number, headers: Readonly<Record<string, string>>): Response {
  return new Response(body, { status, headers: { ...API_HEADERS, ...headers } });
}

export function json(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return respond(JSON.stringify(body), status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

export function failure(status: number, message: string, headers: Readonly<Record<string, string>> = {}): Response {
  return json({ error: message }, status, headers);
}

export function noContent(headers: Readonly<Record<string, string>> = {}): Response {
  return respond(null, 204, headers);
}

export function bytes(body: Uint8Array, type: string, headers: Readonly<Record<string, string>> = {}): Response {
  return respond(body as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': type, ...headers });
}

/** Sends the browser on: to a sign-in page, or back to the site. */
export function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ ...API_HEADERS, Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/** The request's body, read no further than `limit` bytes. */
async function readText(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > limit) throw new HttpError(413, 'That is more than the site takes in one go.');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'That is more than the site takes in one go.');
    }
    chunks.push(read.value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The request's JSON body, checked against `schema`. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S, limit: number): Promise<z.output<S>> {
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new HttpError(415, 'The site sends JSON here.');
  }
  let body: unknown;
  try {
    body = JSON.parse(await readText(request, limit));
  } catch (error: unknown) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'That request could not be read.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, `That request is not one the site understands: ${parsed.error.issues[0]?.message ?? 'bad request'}.`);
  return parsed.data;
}

/** The cookies a request carries, by name. */
export function cookiesOf(request: Request): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  for (const raw of (request.headers.get('Cookie') ?? '').split(';')) {
    const part = raw.trim();
    const at = part.indexOf('=');
    if (at > 0) cookies.set(part.slice(0, at), part.slice(at + 1));
  }
  return cookies;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Whether a request comes to a server on this computer, which serves plain HTTP. */
export function isLoopback(request: Request): boolean {
  return LOOPBACK.has(new URL(request.url).hostname);
}

/**
 * Cookies get the Secure flag and their prefix everywhere but on this
 * computer: a hosted site's cookies never travel over plain HTTP, even on
 * a first visit to http://, where browsers then refuse them.
 */
export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:' || !isLoopback(request);
}

export interface CookieOptions {
  readonly maxAge: number;
  /** Where the browser sends it; the __Host- prefix needs "/". */
  readonly path?: string;
}

/** A Set-Cookie value: kept from scripts, sent only from this site's own pages and on links into it. */
export function cookie(request: Request, name: string, value: string, { maxAge, path = '/' }: CookieOptions): string {
  const secure = isSecure(request) ? '; Secure' : '';
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * Whether a request that changes something comes from the site's own
 * pages. Browsers name the page a request comes from in its Origin header;
 * another site's page cannot make them name this one. Together with
 * SameSite cookies, this keeps other sites from acting for a signed-in user.
 */
export function fromOwnPage(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin;
}
