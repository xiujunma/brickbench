/**
 * Talks to the site's API (server/): accounts, models kept online and the
 * gallery. Every answer is checked against the protocol both sides share
 * before anything uses it.
 */
import { z } from 'zod';
import {
  errorSchema,
  galleryPageSchema,
  modelInfoSchema,
  modelListSchema,
  modelWithDataSchema,
  reportListSchema,
  sessionSchema,
  stoppedAccountsSchema,
  userSchema,
  type GalleryPage,
  type ModelInfo,
  type ModelWithData,
  type ReportedModel,
  type ReportReason,
  type SaveRequest,
  type Session,
  type StoppedAccount,
  type User,
} from '../core/cloud/protocol';

/** A request the site turned down, or could not be sent: `message` is fit to show. */
export class CloudError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The model as the site has it now, when a save was turned down for one saved since. */
    readonly current: ModelInfo | null = null,
  ) {
    super(message);
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const UNREACHABLE = 'The site could not be reached. Check your connection and try again.';
const UNEXPECTED = 'The site sent an answer BrickBench does not understand.';

const modelEnvelope = z.object({ model: modelInfoSchema });
const userEnvelope = z.object({ user: userSchema });
const conflictSchema = z.object({ error: z.string(), model: modelInfoSchema });

export interface ModerationAction {
  readonly hidden?: boolean;
  readonly dismiss?: true;
}

export interface CloudApi {
  session(): Promise<Session>;
  signOut(): Promise<void>;
  renameAccount(name: string): Promise<User>;
  deleteAccount(): Promise<void>;
  myModels(): Promise<ModelInfo[]>;
  createModel(save: SaveRequest): Promise<ModelInfo>;
  /** Saves over a model; a CloudError with status 409, and `current`, when another save came in first. */
  updateModel(id: string, save: SaveRequest): Promise<ModelInfo>;
  readModel(id: string): Promise<ModelWithData>;
  setPublished(id: string, published: boolean): Promise<ModelInfo>;
  deleteModel(id: string): Promise<void>;
  report(id: string, reason: ReportReason, note: string): Promise<void>;
  gallery(search: string, after: string | null): Promise<GalleryPage>;
  reports(): Promise<ReportedModel[]>;
  moderateModel(id: string, action: ModerationAction): Promise<ModelInfo>;
  moderateUser(id: string, banned: boolean): Promise<void>;
  /** Deletes a model outright, as a moderator. */
  deleteAsModerator(id: string): Promise<void>;
  stoppedAccounts(): Promise<StoppedAccount[]>;
}

async function errorOf(response: Response): Promise<CloudError> {
  const body: unknown = await response.json().catch(() => null);
  const conflict = conflictSchema.safeParse(body);
  if (conflict.success) return new CloudError(response.status, conflict.data.error, conflict.data.model);
  const error = errorSchema.safeParse(body);
  return new CloudError(response.status, error.success ? error.data.error : `The site said no (${response.status}). Try again in a moment.`);
}

export function createCloudApi(send: Fetch = (input, init) => fetch(input, init)): CloudApi {
  async function call<S extends z.ZodType>(method: string, path: string, schema: S, body?: unknown): Promise<z.output<S>>;
  async function call(method: string, path: string, schema: null, body?: unknown): Promise<void>;
  async function call(method: string, path: string, schema: z.ZodType | null, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await send(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CloudError(0, UNREACHABLE);
    }
    if (!response.ok) throw await errorOf(response);
    if (schema === null) return undefined;
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new CloudError(response.status, UNEXPECTED);
    return parsed.data;
  }

  return {
    session: () => call('GET', '/session', sessionSchema),
    signOut: () => call('POST', '/auth/sign-out', null),
    renameAccount: async (name) => (await call('PATCH', '/account', userEnvelope, { name })).user,
    deleteAccount: () => call('DELETE', '/account', null),
    myModels: async () => (await call('GET', '/models', modelListSchema)).models,
    createModel: async (save) => (await call('POST', '/models', modelEnvelope, save)).model,
    updateModel: async (id, save) => (await call('PUT', `/models/${id}`, modelEnvelope, save)).model,
    readModel: (id) => call('GET', `/models/${id}`, modelWithDataSchema),
    setPublished: async (id, published) => (await call('PATCH', `/models/${id}`, modelEnvelope, { published })).model,
    deleteModel: (id) => call('DELETE', `/models/${id}`, null),
    report: (id, reason, note) => call('POST', `/models/${id}/report`, null, { reason, note }),
    gallery: (search, after) => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (after) params.set('after', after);
      const query = params.size > 0 ? `?${params}` : '';
      return call('GET', `/gallery${query}`, galleryPageSchema);
    },
    reports: async () => (await call('GET', '/admin/reports', reportListSchema)).reports,
    moderateModel: async (id, action) => (await call('POST', `/admin/models/${id}`, modelEnvelope, action)).model,
    moderateUser: (id, banned) => call('POST', `/admin/users/${id}`, null, { banned }),
    deleteAsModerator: (id) => call('DELETE', `/admin/models/${id}`, null),
    stoppedAccounts: async () => (await call('GET', '/admin/users', stoppedAccountsSchema)).users,
  };
}

/** A model's picture; the revision in the address lets browsers keep it until the next save. */
export function thumbnailUrl(model: Pick<ModelInfo, 'id' | 'revision'>): string {
  return `/api/models/${model.id}/thumbnail?v=${model.revision}`;
}

export const cloudApi: CloudApi = createCloudApi();
