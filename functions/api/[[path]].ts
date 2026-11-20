/**
 * Cloudflare Pages runs every request under /api through here: the API in
 * server/, with the site's D1 database bound as DB and its sign-in secrets
 * (README › Accounts and the gallery). Everything else on the site is a
 * file Pages serves without running this.
 */
import { handleApi, type Env } from '../../server/app';

interface PagesContext {
  readonly request: Request;
  readonly env: Env;
}

export const onRequest = (context: PagesContext): Promise<Response> => handleApi(context.request, context.env);
