import { describe, expect, it } from 'bun:test';
import type { ModelInfo } from '../core/cloud/protocol';
import { accountStore, checkAccount, currentUser, setUser } from './account';
import { CloudError, createCloudApi, thumbnailUrl, type Fetch } from './cloudApi';

const MODEL: ModelInfo = {
  id: 'abcdefghjkmnpqrs',
  name: 'Castle',
  bricks: 12,
  revision: 2,
  size: 300,
  createdAt: 1,
  updatedAt: 2,
  publishedAt: null,
  hidden: false,
  hasThumbnail: true,
  owner: { id: 'ownerownerowner1', name: 'Ada' },
};
const USER = { id: 'ownerownerowner1', name: 'Ada', admin: false, banned: false };

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly headers: Headers;
}

/** A site that answers every request with `answer`, noting what was sent. */
function site(answer: () => Response): { readonly sent: Sent[]; readonly fetch: Fetch } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) });
      return answer();
    },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<CloudError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof CloudError) return error;
    throw error;
  }
  throw new Error('it did not fail');
}

describe('the API client', () => {
  it('sends JSON to the site’s own API and checks what comes back', async () => {
    const { sent, fetch } = site(() => Response.json({ model: MODEL }, { status: 201 }));
    const api = createCloudApi(fetch);
    const save = { name: 'Castle', bricks: 12, data: 'abc', thumbnail: null };
    expect(await api.createModel(save)).toEqual(MODEL);
    expect(sent[0]).toMatchObject({ url: '/api/models', method: 'POST', body: save });
    expect(sent[0]?.headers.get('Content-Type')).toBe('application/json');
  });

  it('asks for each thing at its own address', async () => {
    const answers: Record<string, unknown> = {
      'GET /api/session': { user: USER, providers: ['github'] },
      'PATCH /api/account': { user: USER },
      'GET /api/models': { models: [MODEL] },
      [`PUT /api/models/${MODEL.id}`]: { model: MODEL },
      [`GET /api/models/${MODEL.id}`]: { model: MODEL, data: 'abc' },
      [`PATCH /api/models/${MODEL.id}`]: { model: MODEL },
      'GET /api/gallery?q=red+castle&after=1.abcdefghjkmnpqrs': { models: [MODEL], next: null },
      'GET /api/gallery': { models: [], next: null },
      'GET /api/admin/reports': { reports: [{ model: MODEL, ownerBanned: false, count: 1, reasons: { spam: 1 }, notes: [], latestAt: 3 }] },
      'GET /api/admin/users': { users: [{ id: MODEL.owner.id, name: 'Ada' }] },
      [`POST /api/admin/models/${MODEL.id}`]: { model: MODEL },
    };
    const sent: string[] = [];
    const api = createCloudApi(async (url, init) => {
      const key = `${init?.method} ${url}`;
      sent.push(key);
      return key in answers ? Response.json(answers[key]) : new Response(null, { status: 204 });
    });
    expect((await api.session()).user).toEqual(USER);
    expect(await api.renameAccount('Ada')).toEqual(USER);
    expect(await api.myModels()).toEqual([MODEL]);
    expect(await api.updateModel(MODEL.id, { name: 'Castle', bricks: 1, data: 'a', thumbnail: null, revision: 1 })).toEqual(MODEL);
    expect((await api.readModel(MODEL.id)).data).toBe('abc');
    expect(await api.setPublished(MODEL.id, true)).toEqual(MODEL);
    expect((await api.gallery(' red castle ', `1.${MODEL.id}`)).models).toEqual([MODEL]);
    expect((await api.gallery('', null)).models).toEqual([]);
    expect(await api.reports()).toHaveLength(1);
    expect(await api.moderateModel(MODEL.id, { hidden: true })).toEqual(MODEL);
    expect(await api.stoppedAccounts()).toEqual([{ id: MODEL.owner.id, name: 'Ada' }]);
    await api.signOut();
    await api.deleteAccount();
    await api.deleteModel(MODEL.id);
    await api.report(MODEL.id, 'spam', '');
    await api.moderateUser(MODEL.owner.id, true);
    await api.deleteAsModerator(MODEL.id);
    expect(sent.slice(-6)).toEqual([
      'POST /api/auth/sign-out',
      'DELETE /api/account',
      `DELETE /api/models/${MODEL.id}`,
      `POST /api/models/${MODEL.id}/report`,
      `POST /api/admin/users/${MODEL.owner.id}`,
      `DELETE /api/admin/models/${MODEL.id}`,
    ]);
  });

  it('passes on what the site says when it says no', async () => {
    const api = createCloudApi(site(() => Response.json({ error: 'Sign in first.' }, { status: 401 })).fetch);
    const error = await failureOf(api.myModels());
    expect([error.status, error.message, error.current]).toEqual([401, 'Sign in first.', null]);
  });

  it('gives the model as it is now when a save comes too late', async () => {
    const api = createCloudApi(site(() => Response.json({ error: 'Saved elsewhere.', model: MODEL }, { status: 409 })).fetch);
    const error = await failureOf(api.updateModel(MODEL.id, { name: 'Castle', bricks: 1, data: 'a', thumbnail: null, revision: 1 }));
    expect(error.status).toBe(409);
    expect(error.current).toEqual(MODEL);
  });

  it('says so when the site cannot be reached, or answers in a way it does not understand', async () => {
    const offline = createCloudApi(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await failureOf(offline.session())).message).toBe('The site could not be reached. Check your connection and try again.');
    const odd = createCloudApi(site(() => Response.json({ users: [] })).fetch);
    expect((await failureOf(odd.session())).message).toBe('The site sent an answer BrickBench does not understand.');
    const blank = createCloudApi(site(() => new Response('Bad gateway', { status: 502 })).fetch);
    expect((await failureOf(blank.session())).message).toBe('The site said no (502). Try again in a moment.');
  });

  it('asks for a model’s picture by its revision', () => {
    expect(thumbnailUrl(MODEL)).toBe(`/api/models/${MODEL.id}/thumbnail?v=2`);
  });
});

describe('the account', () => {
  it('is whoever the site says is signed in', async () => {
    await checkAccount(createCloudApi(site(() => Response.json({ user: USER, providers: ['github', 'google'] })).fetch), true);
    expect(accountStore.getState()).toEqual({ status: 'ready', user: USER, providers: ['github', 'google'] });
    expect(currentUser()).toEqual(USER);
    setUser(null);
    expect(currentUser()).toBeNull();
  });

  it('is unavailable without an API, and in the desktop app', async () => {
    await checkAccount(createCloudApi(site(() => new Response('Not found', { status: 404 })).fetch), true);
    expect(accountStore.getState().status).toBe('unavailable');
    const { sent, fetch } = site(() => Response.json({ user: USER, providers: [] }));
    await checkAccount(createCloudApi(fetch), false);
    expect(accountStore.getState().status).toBe('unavailable');
    expect(sent).toEqual([]);
  });
});
