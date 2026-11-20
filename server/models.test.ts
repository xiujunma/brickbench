import { describe, expect, it } from 'bun:test';
import { MAX_ACCOUNT_BYTES, MAX_MODEL_DATA, MAX_MODELS_PER_ACCOUNT, type ModelInfo } from '../src/core/cloud/protocol';
import { createHarness, save, THUMBNAIL, type Harness } from './testing/harness';

async function created(api: Harness, cookie: string, body = save()): Promise<ModelInfo> {
  const response = await api.send('POST', '/api/models', { cookie, body });
  expect(response.status).toBe(201);
  return (await response.json()).model;
}

describe('saving a model online', () => {
  it('keeps it, private to its owner, with its file and thumbnail', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada', 'Ada');
    const model = await created(api, ada);
    expect(model).toEqual({
      id: expect.stringMatching(/^[0-9a-z]{16}$/),
      name: 'Castle',
      bricks: 12,
      revision: 1,
      size: String(save().data).length + THUMBNAIL.length,
      createdAt: api.now,
      updatedAt: api.now,
      publishedAt: null,
      hidden: false,
      hasThumbnail: true,
      owner: { id: expect.any(String), name: 'Ada' },
    });
    expect((await (await api.send('GET', '/api/models', { cookie: ada })).json()).models).toEqual([model]);
    expect(await (await api.send('GET', `/api/models/${model.id}`, { cookie: ada })).json()).toEqual({ model, data: save().data });

    const picture = await api.send('GET', `/api/models/${model.id}/thumbnail`, { cookie: ada });
    expect(picture.headers.get('Content-Type')).toBe('image/jpeg');
    expect(picture.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect([...new Uint8Array(await picture.arrayBuffer())].slice(0, 3)).toEqual([0xff, 0xd8, 0xff]);

    // no one else sees it
    const grace = await api.signIn('grace');
    for (const path of [`/api/models/${model.id}`, `/api/models/${model.id}/thumbnail`]) {
      expect((await api.send('GET', path, { cookie: grace })).status).toBe(404);
      expect((await api.send('GET', path)).status).toBe(404);
    }
    expect((await (await api.send('GET', '/api/models', { cookie: grace })).json()).models).toEqual([]);
  });

  it('needs someone signed in, and not stopped by a moderator', async () => {
    const api = createHarness({ ADMINS: 'test:mod' });
    expect((await api.send('POST', '/api/models', { body: save() })).status).toBe(401);
    expect((await api.send('GET', '/api/models')).status).toBe(401);
    const ada = await api.signIn('ada');
    const { user } = await (await api.send('GET', '/api/session', { cookie: ada })).json();
    await api.send('POST', `/api/admin/users/${user.id}`, { cookie: await api.signIn('mod'), body: { banned: true } });
    const refused = await api.send('POST', '/api/models', { cookie: ada, body: save() });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe('A moderator has stopped this account saving, publishing and reporting models.');
  });

  it('turns down bodies that are not a model and a JPEG', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const send = (body: unknown, headers?: Record<string, string>) => api.send('POST', '/api/models', { cookie, body, headers });
    expect((await send(save(), { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await send('{"name":')).status).toBe(400);
    expect((await send(save({ data: 'not base64url!' }))).status).toBe(400);
    expect((await send(save({ data: '' }))).status).toBe(400);
    expect((await send(save({ name: '   ' }))).status).toBe(400);
    expect((await send(save({ bricks: -1 }))).status).toBe(400);
    const png = btoa('\x89PNG\r\n\x1a\nabc').replace(/=+$/, '');
    const notJpeg = await send(save({ thumbnail: png }));
    expect(notJpeg.status).toBe(400);
    expect((await notJpeg.json()).error).toBe('That thumbnail is not a JPEG picture.');
    expect((await send(save({ thumbnail: null }))).status).toBe(201);
  });

  it('turns down a body bigger than a model can be, before reading it all', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const big = save({ data: 'A'.repeat(MAX_MODEL_DATA + 1) });
    expect((await api.send('POST', '/api/models', { cookie, body: big })).status).toBe(400);
    const declared = await api.send('POST', '/api/models', { cookie, body: save(), headers: { 'Content-Length': String(10_000_000) } });
    expect(declared.status).toBe(413);
    const huge = await api.send('POST', '/api/models', { cookie, body: JSON.stringify(save({ data: 'A'.repeat(MAX_MODEL_DATA * 2) })) });
    expect(huge.status).toBe(413);
  });

  it(`keeps at most ${MAX_MODELS_PER_ACCOUNT} models an account`, async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    for (let i = 0; i < MAX_MODELS_PER_ACCOUNT; i++) await created(api, cookie, save({ name: `Model ${i}`, thumbnail: null }));
    const full = await api.send('POST', '/api/models', { cookie, body: save() });
    expect(full.status).toBe(409);
    expect((await full.json()).error).toContain('Delete some to make room');
  });

  it(`keeps at most ${MAX_ACCOUNT_BYTES / 1_000_000} MB an account, new models and saves over them alike`, async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const big = save({ data: 'A'.repeat(MAX_MODEL_DATA), thumbnail: null });
    const fits = Math.floor(MAX_ACCOUNT_BYTES / MAX_MODEL_DATA);
    const models: ModelInfo[] = [];
    for (let i = 0; i < fits; i++) models.push(await created(api, cookie, big));
    const full = await api.send('POST', '/api/models', { cookie, body: big });
    expect(full.status).toBe(409);
    expect((await full.json()).error).toContain('take up all the room an account has (25 MB)');
    // a small one still fits; then saving a small model over with a big one does not
    const small = await created(api, cookie, save({ thumbnail: null }));
    const grown = await api.send('PUT', `/api/models/${small.id}`, { cookie, body: { ...big, revision: 1 } });
    expect(grown.status).toBe(409);
    expect(await grown.json()).toEqual({ error: expect.stringContaining('Delete some to make room') });
    // saving a model over with one of the same size is fine, and deleting makes room
    expect((await api.send('PUT', `/api/models/${models[0]?.id}`, { cookie, body: { ...big, revision: 1 } })).status).toBe(200);
    await api.send('DELETE', `/api/models/${models[1]?.id}`, { cookie });
    expect((await api.send('PUT', `/api/models/${small.id}`, { cookie, body: { ...big, revision: 1 } })).status).toBe(200);
  });

  it('limits how often an account saves', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const model = await created(api, cookie);
    let revision = model.revision;
    for (let i = 1; i < 120; i++) {
      const response = await api.send('PUT', `/api/models/${model.id}`, { cookie, body: save({ revision }) });
      revision = (await response.json()).model.revision;
    }
    expect((await api.send('PUT', `/api/models/${model.id}`, { cookie, body: save({ revision }) })).status).toBe(429);
  });
});

describe('saving over a model online', () => {
  it('takes a save that follows on from the latest revision', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const model = await created(api, cookie);
    api.now += 1000;
    const response = await api.send('PUT', `/api/models/${model.id}`, { cookie, body: save({ name: 'Keep', bricks: 30, revision: 1, thumbnail: null }) });
    expect(response.status).toBe(200);
    const { model: saved } = await response.json();
    expect(saved).toMatchObject({ name: 'Keep', bricks: 30, revision: 2, updatedAt: api.now, createdAt: model.createdAt, hasThumbnail: false });
  });

  it('turns down a save over a newer revision, saying what is there now', async () => {
    const api = createHarness();
    const cookie = await api.signIn('ada');
    const model = await created(api, cookie);
    await api.send('PUT', `/api/models/${model.id}`, { cookie, body: save({ name: 'From the laptop', revision: 1 }) });
    const stale = await api.send('PUT', `/api/models/${model.id}`, { cookie, body: save({ name: 'From the phone', revision: 1 }) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).model).toMatchObject({ name: 'From the laptop', revision: 2 });
    expect((await api.send('PUT', `/api/models/${model.id}`, { cookie, body: save() })).status).toBe(400);
  });

  it('never saves over someone else’s model', async () => {
    const api = createHarness();
    const model = await created(api, await api.signIn('ada'));
    const grace = await api.signIn('grace');
    expect((await api.send('PUT', `/api/models/${model.id}`, { cookie: grace, body: save({ revision: 1 }) })).status).toBe(404);
    expect((await api.send('PUT', '/api/models/0000000000000000', { cookie: grace, body: save({ revision: 1 }) })).status).toBe(404);
    expect((await api.send('DELETE', `/api/models/${model.id}`, { cookie: grace })).status).toBe(404);
    expect((await api.send('PATCH', `/api/models/${model.id}`, { cookie: grace, body: { published: true } })).status).toBe(404);
  });
});

describe('publishing', () => {
  it('puts a model in the gallery for everyone, keeping its place there until taken out', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    const model = await created(api, ada);
    const published = await (await api.send('PATCH', `/api/models/${model.id}`, { cookie: ada, body: { published: true } })).json();
    expect(published.model.publishedAt).toBe(api.now);
    const publishedAt = api.now;
    api.now += 1000;
    const again = await (await api.send('PATCH', `/api/models/${model.id}`, { cookie: ada, body: { published: true } })).json();
    expect(again.model.publishedAt).toBe(publishedAt);

    expect((await api.send('GET', `/api/models/${model.id}`)).status).toBe(200);
    const picture = await api.send('GET', `/api/models/${model.id}/thumbnail?v=1`);
    expect(picture.headers.get('Cache-Control')).toBe('public, max-age=300');

    const out = await (await api.send('PATCH', `/api/models/${model.id}`, { cookie: ada, body: { published: false } })).json();
    expect(out.model.publishedAt).toBeNull();
    expect((await api.send('GET', `/api/models/${model.id}`)).status).toBe(404);
  });

  it('keeps empty models out of the gallery', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    const model = await created(api, ada, save({ bricks: 0 }));
    expect((await api.send('PATCH', `/api/models/${model.id}`, { cookie: ada, body: { published: true } })).status).toBe(400);
  });

  it('says when a model has no picture', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    const model = await created(api, ada, save({ thumbnail: null }));
    expect((await api.send('GET', `/api/models/${model.id}/thumbnail`, { cookie: ada })).status).toBe(404);
  });
});

describe('deleting a model', () => {
  it('takes it away for good', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    const model = await created(api, ada, save({ thumbnail: THUMBNAIL }));
    expect((await api.send('DELETE', `/api/models/${model.id}`, { cookie: ada })).status).toBe(204);
    expect((await api.send('GET', `/api/models/${model.id}`, { cookie: ada })).status).toBe(404);
    expect((await api.send('DELETE', `/api/models/${model.id}`, { cookie: ada })).status).toBe(404);
  });
});
