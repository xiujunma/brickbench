/**
 * The API behind accounts, models kept online and the gallery: every
 * request under /api, as a function from a request to a response. Cloudflare
 * Pages runs it (functions/api/[[path]].ts), and so does `bun run api` on
 * this computer (./local.ts).
 */
import { deleteAccount, renameAccount, session, signOut } from './account';
import { createContext, type Context, type Deps, type Env } from './context';
import { ensureSchema } from './db';
import { listGallery, reportModel } from './gallery';
import { failure, fromOwnPage, HttpError } from './http';
import { changeModel, createModel, deleteModel, listModels, readModel, readThumbnail, updateModel } from './models';
import { deleteAsModerator, listReports, listStopped, moderateModel, moderateUser } from './moderation';
import { finishSignIn, startSignIn, testSignIn } from './signIn';

export type { Deps, Env } from './context';

type Handler = (context: Context, param: string) => Promise<Response>;

interface Route {
  readonly path: RegExp;
  readonly methods: Readonly<Partial<Record<string, Handler>>>;
}

const ID = '([0-9a-z]{16})';
const route = (path: string, methods: Route['methods']): Route => ({ path: new RegExp(`^/api${path}$`), methods });

const ROUTES: readonly Route[] = [
  route('/session', { GET: session }),
  route('/auth/(github|google)', { GET: startSignIn }),
  route('/auth/(github|google)/callback', { GET: finishSignIn }),
  route('/auth/test', { GET: testSignIn }),
  route('/auth/sign-out', { POST: signOut }),
  route('/account', { PATCH: renameAccount, DELETE: deleteAccount }),
  route('/models', { GET: listModels, POST: createModel }),
  route(`/models/${ID}`, { GET: readModel, PUT: updateModel, PATCH: changeModel, DELETE: deleteModel }),
  route(`/models/${ID}/thumbnail`, { GET: readThumbnail }),
  route(`/models/${ID}/report`, { POST: reportModel }),
  route('/gallery', { GET: listGallery }),
  route('/admin/reports', { GET: listReports }),
  route(`/admin/models/${ID}`, { POST: moderateModel, DELETE: deleteAsModerator }),
  route('/admin/users', { GET: listStopped }),
  route(`/admin/users/${ID}`, { POST: moderateUser }),
];

export const DEFAULT_DEPS: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
};

/** Answers one request under /api. */
export async function handleApi(request: Request, env: Env, deps: Deps = DEFAULT_DEPS): Promise<Response> {
  const path = new URL(request.url).pathname;
  let matched: { readonly route: Route; readonly param: string } | null = null;
  for (const candidate of ROUTES) {
    const found = candidate.path.exec(path);
    if (found) {
      matched = { route: candidate, param: found[1] ?? '' };
      break;
    }
  }
  if (!matched) return failure(404, 'There is nothing here.');
  const handler = matched.route.methods[request.method];
  if (!handler) return failure(405, 'That cannot be done here.', { Allow: Object.keys(matched.route.methods).join(', ') });
  // anything that changes something must come from the site's own pages
  if (request.method !== 'GET' && !fromOwnPage(request)) return failure(403, 'That request did not come from this site.');
  // a site deployed without a database has no accounts, and the page leaves them out
  if (!env.DB) return failure(503, 'Accounts and the gallery are not set up on this site.');
  try {
    await ensureSchema(env.DB);
    const context = createContext(request, env, deps);
    const response = await handler(context, matched.param);
    for (const cookie of context.cookies) response.headers.append('Set-Cookie', cookie);
    return response;
  } catch (error: unknown) {
    if (error instanceof HttpError) return failure(error.status, error.message, error.headers);
    console.error(`${request.method} ${path} failed:`, error);
    return failure(500, 'Something went wrong on the site. Try again in a moment.');
  }
}
