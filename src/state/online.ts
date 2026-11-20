/**
 * Accounts, models kept online and the gallery, as the menus and dialogs use
 * them: signing in and out, saving the open model online and opening one,
 * publishing, reporting, and moderating. Each says how it went in a toast.
 */
import { MAX_MODEL_DATA, MAX_THUMBNAIL, type ModelInfo, type Provider, type ReportReason, type StoppedAccount } from '../core/cloud/protocol';
import { packModel, thumbnailFromDataUrl, unpackModel } from '../core/cloud/packing';
import type { SceneSettings } from '../core/io/modelFile';
import { serializeDocument } from '../core/io/modelFile';
import type { Brick } from '../core/model/types';
import { getPart } from '../core/parts/catalog';
import { desktopApi } from '../desktop/protocol';
import { checkAccount, currentUser, setUser } from './account';
import { CloudError, cloudApi, type ModerationAction } from './cloudApi';
import { parseModelText, showDocument } from './commands';
import { confirmReplace } from './confirmReplace';
import { editorStore } from './editorStore';
import { partLibrary } from './library';
import { onlineCopy, setOnlineCopy } from './onlineCopy';
import { bricksOf } from './selectors';
import type { ToastTone } from './types';

/** A gallery model's link: the page, with the model's id in the fragment. */
export const GALLERY_FRAGMENT = '#gallery=';
const SIGN_IN_FRAGMENT = /^#(signed-in|sign-in=(failed|cancelled))$/;

function toast(message: string, tone: ToastTone = 'info'): void {
  editorStore.getState().toast(message, tone);
}

function messageOf(error: unknown): string {
  return error instanceof CloudError ? error.message : 'Something went wrong. Try again in a moment.';
}

/** Runs a request, saying what went wrong if it fails; null then. */
async function attempt<T>(request: () => Promise<T>): Promise<T | null> {
  try {
    return await request();
  } catch (error: unknown) {
    toast(messageOf(error), 'error');
    return null;
  }
}

// signing in and out

/** Off to the provider; the page comes back signed in. Test sign-in asks for a name instead. */
export function signIn(provider: Provider): void {
  if (provider !== 'test') {
    window.location.assign(`/api/auth/${provider}`);
    return;
  }
  const name = window.prompt('Sign in for testing, as:', 'Tester')?.trim();
  if (!name) return;
  const id = name.replace(/[^\w.-]+/g, '-').slice(0, 64);
  window.location.assign(`/api/auth/test?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`);
}

export async function signOut(): Promise<void> {
  if ((await attempt(() => cloudApi.signOut())) === null) return;
  setUser(null);
  toast('Signed out.');
}

export async function renameAccount(name: string): Promise<boolean> {
  const user = await attempt(() => cloudApi.renameAccount(name));
  if (!user) return false;
  setUser(user);
  toast(`The gallery now shows you as “${user.name}”.`, 'success');
  return true;
}

export async function deleteAccount(): Promise<void> {
  const prompt =
    'Delete your account, with every model you keep online? They leave the gallery too. This cannot be undone; models in files and in this browser stay.';
  if (!window.confirm(prompt)) return;
  if ((await attempt(() => cloudApi.deleteAccount())) === null) return;
  setUser(null);
  setOnlineCopy(null);
  toast('Your account and its models are deleted.', 'success');
}

// saving and opening

/** The model's picture; null when WebGL cannot draw one, or it comes out too big. */
async function picture(bricks: readonly Brick[], settings: SceneSettings): Promise<string | null> {
  try {
    const { renderModelThumbnail } = await import('../engine/modelThumbnail');
    const thumbnail = thumbnailFromDataUrl(await renderModelThumbnail(bricks, settings, getPart, partLibrary.meshes));
    return thumbnail !== null && thumbnail.length <= MAX_THUMBNAIL ? thumbnail : null;
  } catch {
    return null;
  }
}

let saving = false;

/** Saves over the model's copy online when it has one of this account's, and as a new one otherwise. */
async function store(save: Parameters<typeof cloudApi.createModel>[0], userId: string): Promise<ModelInfo | null> {
  const copy = onlineCopy();
  if (copy === null || copy.owner !== userId) return cloudApi.createModel(save);
  try {
    return await cloudApi.updateModel(copy.id, { ...save, revision: copy.revision });
  } catch (error: unknown) {
    // saved from somewhere else since: the site says how it stands now
    const savedSince = error instanceof CloudError && error.status === 409 && error.current !== null;
    const deleted = error instanceof CloudError && error.status === 404;
    if (!savedSince && !deleted) throw error;
    if (savedSince) {
      const keepBoth = window.confirm(`“${error.current?.name ?? save.name}” was saved online from somewhere else since you opened it here. Save this as a new model online, keeping both?`);
      if (!keepBoth) return null;
    }
    // this one goes in as a new model
    return cloudApi.createModel(save);
  }
}

/** File › Save online. */
export async function saveOnline(): Promise<ModelInfo | null> {
  const user = currentUser();
  if (!user) {
    editorStore.getState().openDialog('account');
    toast('Sign in to keep your models online.');
    return null;
  }
  const { name, history, settings } = editorStore.getState();
  if (history.present.bricks.size === 0) {
    toast('The model is empty: build something to save first.');
    return null;
  }
  if (saving) return null;
  saving = true;
  try {
    const data = await packModel(serializeDocument({ name, model: history.present, settings }));
    if (data.length > MAX_MODEL_DATA) {
      toast('This model is too big to keep online. Save it to a file instead.', 'error');
      return null;
    }
    const thumbnail = await picture(bricksOf(history.present), settings);
    const model = await store({ name, bricks: history.present.bricks.size, data, thumbnail }, user.id);
    if (!model) return null;
    setOnlineCopy({ id: model.id, revision: model.revision, owner: user.id });
    toast(model.publishedAt === null ? `Saved “${model.name}” online.` : `Saved “${model.name}” online, and in the gallery.`, 'success');
    return model;
  } catch (error: unknown) {
    toast(messageOf(error), 'error');
    return null;
  } finally {
    saving = false;
  }
}

/** Opens a model kept online: one of the account's, or from the gallery as a copy to build on. */
export async function openOnline(id: string): Promise<boolean> {
  const found = await attempt(() => cloudApi.readModel(id));
  if (!found) return false;
  const { model } = found;
  const text = await unpackModel(found.data);
  if (!text.ok) {
    toast(text.error, 'error');
    return false;
  }
  const parsed = await parseModelText(text.value);
  if (!parsed.ok) {
    toast(`“${model.name}” could not be opened: ${parsed.error}`, 'error');
    return false;
  }
  if (!confirmReplace(`Open “${model.name}”?`)) return false;
  const user = currentUser();
  const mine = user !== null && model.owner.id === user.id;
  showDocument(parsed.value, mine ? `Opened “${model.name}”.` : `Opened “${model.name}” by ${model.owner.name}. Saving it online keeps a copy of your own.`);
  // only a model back whole may save over its copy online
  setOnlineCopy(mine && parsed.value.skippedBricks === 0 ? { id: model.id, revision: model.revision, owner: model.owner.id } : null);
  return true;
}

// the account's models

export async function setPublished(model: ModelInfo, published: boolean): Promise<ModelInfo | null> {
  if (published) {
    const ok = window.confirm(`Put “${model.name}” in the gallery? Anyone can then see it and open a copy. Saving it online again updates it there.`);
    if (!ok) return null;
  }
  const next = await attempt(() => cloudApi.setPublished(model.id, published));
  if (next) toast(published ? `“${next.name}” is in the gallery.` : `“${next.name}” is out of the gallery.`, 'success');
  return next;
}

export async function deleteOnline(model: ModelInfo): Promise<boolean> {
  const where = model.publishedAt === null ? '' : ' It leaves the gallery too.';
  if (!window.confirm(`Delete “${model.name}” from your models online?${where} This cannot be undone.`)) return false;
  if ((await attempt(() => cloudApi.deleteModel(model.id))) === null) return false;
  if (onlineCopy()?.id === model.id) setOnlineCopy(null);
  toast(`Deleted “${model.name}” online.`, 'success');
  return true;
}

// the gallery

export function galleryLink(model: Pick<ModelInfo, 'id'>): string {
  return `${location.origin}${location.pathname}${GALLERY_FRAGMENT}${model.id}`;
}

export async function copyGalleryLink(model: ModelInfo): Promise<void> {
  try {
    await navigator.clipboard.writeText(galleryLink(model));
    toast(`Link to “${model.name}” copied.`, 'success');
  } catch {
    toast('The link could not be copied: the browser did not allow it.', 'error');
  }
}

export async function reportModel(model: ModelInfo, reason: ReportReason, note: string): Promise<boolean> {
  if ((await attempt(() => cloudApi.report(model.id, reason, note))) === null) return false;
  toast('Thank you: the moderators will look at it.', 'success');
  return true;
}

// moderating

export async function moderateModel(model: ModelInfo, action: ModerationAction): Promise<ModelInfo | null> {
  const next = await attempt(() => cloudApi.moderateModel(model.id, action));
  if (next) {
    const said = action.hidden === true ? 'is out of the gallery' : action.hidden === false ? 'is back in the gallery' : 'stays, its reports settled';
    toast(`“${next.name}” ${said}.`, 'success');
  }
  return next;
}

export async function deleteAsModerator(model: ModelInfo): Promise<boolean> {
  if (!window.confirm(`Delete “${model.name}” by ${model.owner.name} for good? It goes from their models too.`)) return false;
  if ((await attempt(() => cloudApi.deleteAsModerator(model.id))) === null) return false;
  toast(`Deleted “${model.name}”.`, 'success');
  return true;
}

export async function stopAccount(account: StoppedAccount, stopped: boolean): Promise<boolean> {
  if (stopped && !window.confirm(`Stop ${account.name} saving, publishing and reporting? Their models leave the gallery.`)) return false;
  if ((await attempt(() => cloudApi.moderateUser(account.id, stopped))) === null) return false;
  toast(stopped ? `${account.name} is stopped, and their models are out of the gallery.` : `${account.name} can save and publish again.`, 'success');
  return true;
}

// starting up

/** Says how a sign-in went, as the site's redirect back put it in the fragment, and takes the fragment out. */
function readSignInResult(): void {
  const result = SIGN_IN_FRAGMENT.exec(location.hash);
  if (!result) return;
  window.history.replaceState(null, '', `${location.pathname}${location.search}`);
  const user = currentUser();
  if (result[1] === 'signed-in' && user) toast(`Signed in as ${user.name}.`, 'success');
  else if (result[2] === 'cancelled') toast('Signing in was cancelled.');
  else if (result[2] === 'failed') toast('Signing in did not work. Try again in a moment.', 'error');
}

/** Opens the gallery model a link names, then takes the link out of the address. */
async function openGalleryLink(): Promise<void> {
  if (!location.hash.startsWith(GALLERY_FRAGMENT)) return;
  const id = location.hash.slice(GALLERY_FRAGMENT.length);
  window.history.replaceState(null, '', `${location.pathname}${location.search}`);
  if (!/^[0-9a-z]{16}$/.test(id)) {
    toast('That gallery link is broken.', 'error');
    return;
  }
  await openOnline(id);
}

/** Finds out who is signed in, then follows a sign-in coming back and gallery links, now and when pasted later. */
export async function startOnline(target: Pick<Window, 'addEventListener'>): Promise<void> {
  await checkAccount(cloudApi, desktopApi() === null);
  readSignInResult();
  await openGalleryLink();
  target.addEventListener('hashchange', () => void openGalleryLink());
}
