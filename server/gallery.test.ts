import { describe, expect, it } from 'bun:test';
import { GALLERY_PAGE_SIZE, type ModelInfo } from '../src/core/cloud/protocol';
import { createHarness, save, type Harness } from './testing/harness';

/** Saves and publishes a model, a second after the last. */
async function publish(api: Harness, cookie: string, name: string): Promise<ModelInfo> {
  api.now += 1000;
  const { model } = await (await api.send('POST', '/api/models', { cookie, body: save({ name }) })).json();
  const response = await api.send('PATCH', `/api/models/${model.id}`, { cookie, body: { published: true } });
  return (await response.json()).model;
}

async function gallery(api: Harness, query = ''): Promise<{ models: ModelInfo[]; next: string | null }> {
  return (await api.send('GET', `/api/gallery${query}`)).json();
}

async function accountId(api: Harness, cookie: string): Promise<string> {
  return (await (await api.send('GET', '/api/session', { cookie })).json()).user.id;
}

describe('the gallery', () => {
  it('shows published models, the latest first, with who made them', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada', 'Ada');
    const grace = await api.signIn('grace', 'Grace');
    await (await api.send('POST', '/api/models', { cookie: ada, body: save({ name: 'Private' }) })).json();
    await publish(api, ada, 'Lighthouse');
    await publish(api, grace, 'Windmill');
    const page = await gallery(api);
    expect(page.models.map((m) => [m.name, m.owner.name])).toEqual([
      ['Windmill', 'Grace'],
      ['Lighthouse', 'Ada'],
    ]);
    expect(page.next).toBeNull();
  });

  it('comes a page at a time', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    for (let i = 0; i < GALLERY_PAGE_SIZE + 6; i++) await publish(api, ada, `Model ${i}`);
    const first = await gallery(api);
    expect(first.models).toHaveLength(GALLERY_PAGE_SIZE);
    expect(first.models[0]?.name).toBe(`Model ${GALLERY_PAGE_SIZE + 5}`);
    const second = await gallery(api, `?after=${first.next}`);
    expect(second.models.map((m) => m.name)).toEqual(['Model 5', 'Model 4', 'Model 3', 'Model 2', 'Model 1', 'Model 0']);
    expect(second.next).toBeNull();
    expect((await api.send('GET', '/api/gallery?after=nonsense')).status).toBe(400);
  });

  it('finds models by name, taking % and _ as they are', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    await publish(api, ada, 'Red castle');
    await publish(api, ada, 'Castle_2');
    await publish(api, ada, '100% bricks');
    expect((await gallery(api, '?q=CASTLE')).models.map((m) => m.name)).toEqual(['Castle_2', 'Red castle']);
    expect((await gallery(api, '?q=e_2')).models.map((m) => m.name)).toEqual(['Castle_2']);
    expect((await gallery(api, '?q=%25')).models.map((m) => m.name)).toEqual(['100% bricks']);
    expect((await gallery(api, '?q=%20%20')).models).toHaveLength(3);
  });
});

describe('reporting a model', () => {
  it('needs someone signed in, a model in the gallery, and not one of their own', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    const model = await publish(api, ada, 'Lighthouse');
    const report = { reason: 'spam' };
    expect((await api.send('POST', `/api/models/${model.id}/report`, { body: report })).status).toBe(401);
    expect((await api.send('POST', `/api/models/${model.id}/report`, { cookie: ada, body: report })).status).toBe(400);
    const grace = await api.signIn('grace');
    expect((await api.send('POST', `/api/models/${model.id}/report`, { cookie: grace, body: { reason: 'boring' } })).status).toBe(400);
    expect((await api.send('POST', `/api/models/${model.id}/report`, { cookie: grace, body: report })).status).toBe(204);
    await api.send('PATCH', `/api/models/${model.id}`, { cookie: ada, body: { published: false } });
    expect((await api.send('POST', `/api/models/${model.id}/report`, { cookie: grace, body: report })).status).toBe(404);
  });

  it('limits how many reports an account makes', async () => {
    const api = createHarness();
    const ada = await api.signIn('ada');
    const model = await publish(api, ada, 'Lighthouse');
    const grace = await api.signIn('grace');
    for (let i = 0; i < 20; i++) await api.send('POST', `/api/models/${model.id}/report`, { cookie: grace, body: { reason: 'spam' } });
    expect((await api.send('POST', `/api/models/${model.id}/report`, { cookie: grace, body: { reason: 'spam' } })).status).toBe(429);
  });
});

describe('moderating', () => {
  async function reported(): Promise<{ api: Harness; ada: string; mod: string; model: ModelInfo }> {
    const api = createHarness({ ADMINS: 'test:mod' });
    const ada = await api.signIn('ada', 'Ada');
    const model = await publish(api, ada, 'Lighthouse');
    const grace = await api.signIn('grace');
    const linus = await api.signIn('linus');
    await api.send('POST', `/api/models/${model.id}/report`, { cookie: grace, body: { reason: 'offensive', note: 'Not nice\u0000' } });
    api.now += 1000;
    await api.send('POST', `/api/models/${model.id}/report`, { cookie: linus, body: { reason: 'offensive' } });
    // a second report from the same person replaces the first
    await api.send('POST', `/api/models/${model.id}/report`, { cookie: linus, body: { reason: 'copied', note: 'From a set' } });
    return { api, ada, mod: await api.signIn('mod'), model };
  }

  it('is for moderators only', async () => {
    const { api, ada, model } = await reported();
    expect((await api.send('GET', '/api/admin/reports')).status).toBe(401);
    expect((await api.send('GET', '/api/admin/reports', { cookie: ada })).status).toBe(403);
    expect((await api.send('POST', `/api/admin/models/${model.id}`, { cookie: ada, body: { hidden: true } })).status).toBe(403);
    expect((await api.send('POST', `/api/admin/users/${model.owner.id}`, { cookie: ada, body: { banned: true } })).status).toBe(403);
  });

  it('lists reported models with what was said', async () => {
    const { api, mod, model } = await reported();
    const { reports } = await (await api.send('GET', '/api/admin/reports', { cookie: mod })).json();
    expect(reports).toEqual([
      { model, ownerBanned: false, count: 2, reasons: { offensive: 1, copied: 1 }, notes: ['From a set', 'Not nice'], latestAt: api.now },
    ]);
  });

  it('takes a model out of the gallery, settling its reports, and puts it back', async () => {
    const { api, ada, mod, model } = await reported();
    const hidden = await api.send('POST', `/api/admin/models/${model.id}`, { cookie: mod, body: { hidden: true } });
    expect((await hidden.json()).model.hidden).toBe(true);
    expect((await gallery(api)).models).toEqual([]);
    expect((await (await api.send('GET', '/api/admin/reports', { cookie: mod })).json()).reports).toEqual([]);
    // its owner still has it, but cannot put it back in the gallery
    expect((await api.send('GET', `/api/models/${model.id}`, { cookie: ada })).status).toBe(200);
    expect((await api.send('GET', `/api/models/${model.id}`, { cookie: mod })).status).toBe(200);
    expect((await api.send('PATCH', `/api/models/${model.id}`, { cookie: ada, body: { published: true } })).status).toBe(403);
    await api.send('POST', `/api/admin/models/${model.id}`, { cookie: mod, body: { hidden: false } });
    expect((await gallery(api)).models.map((m) => m.id)).toEqual([model.id]);
  });

  it('lists the most reported models first, however many others a few accounts report', async () => {
    const { api, ada, mod, model } = await reported();
    const other = await publish(api, ada, 'Windmill');
    api.now += 1000;
    await api.send('POST', `/api/models/${other.id}/report`, { cookie: await api.signIn('pat'), body: { reason: 'spam' } });
    const { reports } = await (await api.send('GET', '/api/admin/reports', { cookie: mod })).json();
    expect(reports.map((report: { model: ModelInfo; count: number }) => [report.model.name, report.count])).toEqual([
      [model.name, 2],
      ['Windmill', 1],
    ]);
  });

  it('deletes a model outright', async () => {
    const { api, ada, mod, model } = await reported();
    expect((await api.send('DELETE', `/api/admin/models/${model.id}`, { cookie: ada })).status).toBe(403);
    expect((await api.send('DELETE', `/api/admin/models/${model.id}`, { cookie: mod })).status).toBe(204);
    expect((await api.send('GET', `/api/models/${model.id}`, { cookie: ada })).status).toBe(404);
    expect((await (await api.send('GET', '/api/admin/reports', { cookie: mod })).json()).reports).toEqual([]);
    expect((await api.send('DELETE', `/api/admin/models/${model.id}`, { cookie: mod })).status).toBe(404);
  });

  it('settles reports and leaves the model in the gallery', async () => {
    const { api, mod, model } = await reported();
    const kept = await api.send('POST', `/api/admin/models/${model.id}`, { cookie: mod, body: { dismiss: true } });
    expect((await kept.json()).model.hidden).toBe(false);
    expect((await (await api.send('GET', '/api/admin/reports', { cookie: mod })).json()).reports).toEqual([]);
    expect((await gallery(api)).models).toHaveLength(1);
    expect((await api.send('POST', `/api/admin/models/${model.id}`, { cookie: mod, body: {} })).status).toBe(400);
    expect((await api.send('POST', '/api/admin/models/0000000000000000', { cookie: mod, body: { dismiss: true } })).status).toBe(404);
  });

  it('stops an account, taking its models out of the gallery, and lets it go again', async () => {
    const { api, ada, mod, model } = await reported();
    const id = await accountId(api, ada);
    expect((await api.send('POST', `/api/admin/users/${id}`, { cookie: mod, body: { banned: true } })).status).toBe(204);
    expect((await gallery(api)).models).toEqual([]);
    expect(await (await api.send('GET', '/api/admin/users', { cookie: mod })).json()).toEqual({ users: [{ id, name: 'Ada' }] });
    expect((await (await api.send('GET', '/api/admin/reports', { cookie: mod })).json()).reports[0].ownerBanned).toBe(true);
    expect((await api.send('GET', '/api/admin/users', { cookie: ada })).status).toBe(403);
    expect((await api.send('GET', `/api/models/${model.id}`)).status).toBe(404);
    expect((await (await api.send('GET', '/api/session', { cookie: ada })).json()).user.banned).toBe(true);
    expect((await api.send('PATCH', `/api/models/${model.id}`, { cookie: ada, body: { published: false } })).status).toBe(403);
    // it can still delete what it has
    expect((await api.send('GET', '/api/models', { cookie: ada })).status).toBe(200);
    await api.send('POST', `/api/admin/users/${id}`, { cookie: mod, body: { banned: false } });
    expect((await gallery(api)).models).toHaveLength(1);
    expect((await (await api.send('GET', '/api/admin/users', { cookie: mod })).json()).users).toEqual([]);
    expect((await api.send('POST', '/api/admin/users/0000000000000000', { cookie: mod, body: { banned: true } })).status).toBe(404);
  });
});
