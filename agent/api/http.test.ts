import { afterEach, describe, expect, it } from 'bun:test';
import { ApiError, errorMessageOf, postJson, type PostOptions } from './http';

type Handler = (request: Request) => Response | Promise<Response>;

const servers: { stop(force: boolean): unknown }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A server that answers each request with the next handler, and remembers what it was sent. */
function serve(...handlers: Handler[]) {
  const requests: { headers: Headers; body: unknown }[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push({ headers: request.headers, body: await request.json() });
      const handler = handlers.shift();
      return handler ? handler(request) : new Response('no more answers', { status: 500 });
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}/v1/x`, requests };
}

const options = (url: string, extra: Partial<PostOptions> = {}): PostOptions => ({
  url,
  body: { hello: 'world' },
  signal: new AbortController().signal,
  timeoutMs: 5000,
  retryDelaysMs: [],
  ...extra,
});

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the request to fail');
}

describe('reading an error reply', () => {
  it('finds the message however the provider words it', () => {
    expect(errorMessageOf('{"error":{"message":"Bad key","code":"invalid_api_key"}}')).toEqual({ message: 'Bad key', code: 'invalid_api_key' });
    expect(errorMessageOf('{"error":"model \\"x\\" not found"}')).toEqual({ message: 'model "x" not found', code: '' });
    expect(errorMessageOf('{"message":"Too many"}').message).toBe('Too many');
    expect(errorMessageOf('{"detail":"Nope"}').message).toBe('Nope');
    expect(errorMessageOf('Bad gateway').message).toBe('Bad gateway');
    expect(errorMessageOf('   ').message).toBe('no details given');
    expect(errorMessageOf('{"error":{}}').message).toBe('{"error":{}}');
    // a proxy's error page goes by its title
    expect(errorMessageOf('<html><head><title> 502 Bad Gateway </title></head><body>…</body></html>').message).toBe('a web page, “502 Bad Gateway”');
    expect(errorMessageOf('<!doctype html><p>Oops</p>').message).toBe('a web page instead of an API reply');
  });
});

describe('posting to a model API', () => {
  it('sends JSON with the key, and gives back the reply', async () => {
    const api = serve(() => Response.json({ ok: 1 }));
    expect(await postJson(options(api.url, { apiKey: 'sk-test' }))).toEqual({ ok: 1 });
    expect(api.requests[0]?.body).toEqual({ hello: 'world' });
    expect(api.requests[0]?.headers.get('authorization')).toBe('Bearer sk-test');
    expect(api.requests[0]?.headers.get('content-type')).toBe('application/json');
  });

  it('sends no key when it has none', async () => {
    const api = serve(() => Response.json({}));
    await postJson(options(api.url));
    expect(api.requests[0]?.headers.get('authorization')).toBeNull();
  });

  it('tries again while the provider is busy, as long as it asks for no long wait', async () => {
    const api = serve(
      () => new Response('{"error":{"message":"Overloaded"}}', { status: 503 }),
      () => new Response('{"error":{"message":"Slow down"}}', { status: 429, headers: { 'retry-after': '0' } }),
      () => Response.json({ fine: true }),
    );
    expect(await postJson(options(api.url, { retryDelaysMs: [5, 5] }))).toEqual({ fine: true });
    expect(api.requests).toHaveLength(3);
  });

  it('gives up once its retries are spent, or when waiting would not help', async () => {
    const busy = serve(...Array.from({ length: 3 }, () => () => new Response('{"error":{"message":"Overloaded"}}', { status: 503 })));
    expect(await failure(postJson(options(busy.url, { retryDelaysMs: [5] })))).toMatchObject({ kind: 'http', status: 503, message: 'Overloaded' });
    expect(busy.requests).toHaveLength(2);

    const broke = serve(() => new Response('{"error":{"message":"You exceeded your quota","code":"insufficient_quota"}}', { status: 429 }));
    expect(await failure(postJson(options(broke.url, { retryDelaysMs: [5] })))).toMatchObject({ status: 429 });
    expect(broke.requests).toHaveLength(1);

    const patient = serve(() => new Response('{}', { status: 429, headers: { 'retry-after': '3600' } }));
    expect(await failure(postJson(options(patient.url, { retryDelaysMs: [5] })))).toMatchObject({ status: 429 });

    const refused = serve(() => new Response('{"error":{"message":"Bad request"}}', { status: 400 }));
    expect(await failure(postJson(options(refused.url, { retryDelaysMs: [5] })))).toMatchObject({ status: 400, message: 'Bad request' });
  });

  it('waits as long as Retry-After asks, as a date as well as in seconds', async () => {
    const soon = serve(() => new Response('{}', { status: 503, headers: { 'retry-after': new Date(Date.now() + 1500).toUTCString() } }), () => Response.json({ fine: true }));
    const started = Date.now();
    expect(await postJson(options(soon.url, { retryDelaysMs: [5] }))).toEqual({ fine: true });
    // HTTP dates count whole seconds
    expect(Date.now() - started).toBeGreaterThan(400);

    const later = serve(() => new Response('{}', { status: 503, headers: { 'retry-after': new Date(Date.now() + 3_600_000).toUTCString() } }));
    expect(await failure(postJson(options(later.url, { retryDelaysMs: [5] })))).toMatchObject({ status: 503 });
  });

  it('waits its own while instead, when Retry-After is blank or not a time', async () => {
    const api = serve(
      () => new Response('{}', { status: 503, headers: { 'retry-after': '' } }),
      () => new Response('{}', { status: 503, headers: { 'retry-after': 'soon' } }),
      () => Response.json({ fine: true }),
    );
    const started = Date.now();
    expect(await postJson(options(api.url, { retryDelaysMs: [150, 150] }))).toEqual({ fine: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
  });

  it('says so when the reply is not JSON', async () => {
    const api = serve(() => new Response('<html>', { status: 200 }));
    expect(await failure(postJson(options(api.url)))).toMatchObject({ kind: 'reply', message: 'sent a reply that is not JSON' });
  });

  it('tells a server that is not there from one that is too slow', async () => {
    const gone = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const url = `http://127.0.0.1:${gone.port}/v1/x`;
    await gone.stop(true);
    expect((await failure(postJson(options(url)))).kind).toBe('network');

    const slow = serve(() => new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({})), 2000)));
    expect(await failure(postJson(options(slow.url, { timeoutMs: 50 })))).toMatchObject({ kind: 'timeout', message: 'did not answer within 1 s' });
  });

  it('stops at once when asked, while waiting for the reply or for a retry', async () => {
    const slow = serve(() => new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({})), 2000)));
    const asking = new AbortController();
    const request = postJson(options(slow.url, { signal: asking.signal }));
    setTimeout(() => asking.abort(), 20);
    expect((await failure(request)).kind).toBe('stopped');

    const busy = serve(() => new Response('{}', { status: 503 }));
    const waiting = new AbortController();
    const retrying = postJson(options(busy.url, { signal: waiting.signal, retryDelaysMs: [5000] }));
    setTimeout(() => waiting.abort(), 50);
    expect((await failure(retrying)).kind).toBe('stopped');

    const stoppedFirst = new AbortController();
    stoppedFirst.abort();
    expect((await failure(postJson(options(busy.url, { signal: stoppedFirst.signal })))).kind).toBe('stopped');
  });
});
