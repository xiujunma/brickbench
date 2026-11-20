import { useCallback, useEffect, useState } from 'react';
import { MAX_ACCOUNT_BYTES, MAX_MODELS_PER_ACCOUNT, type ModelInfo } from '../../core/cloud/protocol';
import { useAccount } from '../../state/account';
import { CloudError, cloudApi } from '../../state/cloudApi';
import { useEditor } from '../../state/editorStore';
import { copyGalleryLink, deleteOnline, openOnline, saveOnline, setPublished } from '../../state/online';
import { onlineCopyStore } from '../../state/onlineCopy';
import { useStore } from 'zustand';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { bricksText, dateText, ModelCard } from './ModelCard';

type Listing = { readonly state: 'loading' } | { readonly state: 'failed'; readonly message: string } | { readonly state: 'ready'; readonly models: readonly ModelInfo[] };

/** How much of an account's room its models take: "3 of 100 models, 1.2 of 25 MB". */
function usageText(models: readonly ModelInfo[]): string {
  const megabytes = models.reduce((sum, model) => sum + model.size, 0) / 1_000_000;
  const shown = megabytes > 0 && megabytes < 0.1 ? '0.1' : megabytes.toFixed(1);
  return `${models.length} of ${MAX_MODELS_PER_ACCOUNT} models, ${shown} of ${MAX_ACCOUNT_BYTES / 1_000_000} MB`;
}

function standing(model: ModelInfo): string {
  if (model.hidden) return 'Taken out of the gallery by a moderator';
  return model.publishedAt === null ? 'Only you can see it' : 'In the gallery';
}

/** The account's models online: open one, put it in the gallery or take it out, copy its link, delete it. */
export function OnlineModelsDialog() {
  const isOpen = useEditor((s) => s.dialog === 'online-models');
  const close = useEditor((s) => s.closeDialog);
  const openDialog = useEditor((s) => s.openDialog);
  const user = useAccount((s) => s.user);
  const openCopy = useStore(onlineCopyStore, (s) => s.copy?.id ?? null);
  const [listing, setListing] = useState<Listing>({ state: 'loading' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setListing({ state: 'ready', models: await cloudApi.myModels() });
    } catch (error: unknown) {
      setListing({ state: 'failed', message: error instanceof CloudError ? error.message : 'Your models could not be listed.' });
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    setListing({ state: 'loading' });
    void load();
  }, [isOpen, user, load]);

  const replace = (next: ModelInfo): void => {
    setListing((current) => (current.state === 'ready' ? { state: 'ready', models: current.models.map((m) => (m.id === next.id ? next : m)) } : current));
  };

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const footer = user ? (
    <>
      <span>{listing.state === 'ready' ? usageText(listing.models) : ''}</span>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            if (await saveOnline()) await load();
          })
        }
      >
        <Icon name="cloud" size={16} />
        Save the open model online
      </button>
    </>
  ) : undefined;

  return (
    <Dialog id="online-models" title="Your models online" open={isOpen} onClose={() => close('online-models')} footer={footer} wide>
      {!user ? (
        <div className="cloud-empty">
          <p>Sign in to keep models online and open them on any computer.</p>
          <button type="button" className="btn btn-primary" onClick={() => openDialog('account')}>
            Sign in…
          </button>
        </div>
      ) : listing.state === 'loading' ? (
        <p className="cloud-empty" role="status">
          Looking for your models…
        </p>
      ) : listing.state === 'failed' ? (
        <p className="cloud-empty" role="alert">
          {listing.message}
        </p>
      ) : listing.models.length === 0 ? (
        <p className="cloud-empty">Nothing online yet. Save the open model online, and it will be here on any computer you sign in on.</p>
      ) : (
        <ul className="model-grid" aria-label="Your models online">
          {listing.models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              details={
                <>
                  {bricksText(model.bricks)} · saved {dateText(model.updatedAt)}
                  <br />
                  <span className={model.hidden ? 'model-card-standing is-hidden' : 'model-card-standing'}>{standing(model)}</span>
                  {model.id === openCopy && <span className="model-card-badge">Open now</span>}
                </>
              }
              actions={
                <>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (await openOnline(model.id)) close('online-models');
                      })
                    }
                  >
                    Open
                  </button>
                  {model.publishedAt === null ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || model.hidden}
                      onClick={() =>
                        void run(async () => {
                          const next = await setPublished(model, true);
                          if (next) replace(next);
                        })
                      }
                    >
                      <Icon name="globe" size={16} />
                      Publish
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const next = await setPublished(model, false);
                            if (next) replace(next);
                          })
                        }
                      >
                        <Icon name="eyeOff" size={16} />
                        Unpublish
                      </button>
                      {!model.hidden && (
                        <button type="button" className="icon-btn" aria-label={`Copy a link to ${model.name}`} title="Copy link" onClick={() => void copyGalleryLink(model)}>
                          <Icon name="link" size={16} />
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className="icon-btn btn-danger"
                    aria-label={`Delete ${model.name}`}
                    title="Delete"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (await deleteOnline(model)) await load();
                      })
                    }
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </>
              }
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
