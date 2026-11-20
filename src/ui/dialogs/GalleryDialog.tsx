import { useEffect, useRef, useState } from 'react';
import { MAX_REPORT_NOTE, MAX_SEARCH, REPORT_REASONS, type ModelInfo, type ReportReason } from '../../core/cloud/protocol';
import { useAccount } from '../../state/account';
import { CloudError, cloudApi } from '../../state/cloudApi';
import { useEditor } from '../../state/editorStore';
import { copyGalleryLink, moderateModel, openOnline, reportModel } from '../../state/online';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { bricksText, dateText, ModelCard } from './ModelCard';
import { ModerationView } from './ModerationView';

const SEARCH_DELAY_MS = 300;

const REASON_LABELS: Readonly<Record<ReportReason, string>> = {
  offensive: 'Offensive or unkind',
  spam: 'Spam or advertising',
  copied: 'Copied from someone else',
  other: 'Something else',
};

type Gallery =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly models: readonly ModelInfo[]; readonly next: string | null };

function messageOf(error: unknown): string {
  return error instanceof CloudError ? error.message : 'The gallery could not be loaded.';
}

/** Tells the moderators about a model: why, and a few words more if wanted. */
function ReportForm({ model, onDone }: { readonly model: ModelInfo; readonly onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="report-form"
      aria-label={`Report ${model.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason) return;
        setBusy(true);
        void reportModel(model, reason, note).then((sent) => {
          setBusy(false);
          if (sent) onDone();
        });
      }}
    >
      <fieldset>
        <legend>What is wrong with it?</legend>
        {REPORT_REASONS.map((value) => (
          <label key={value} className="check">
            <input type="radio" name={`reason-${model.id}`} value={value} checked={reason === value} onChange={() => setReason(value)} />
            {REASON_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <textarea aria-label="More about it (optional)" placeholder="More about it (optional)" maxLength={MAX_REPORT_NOTE} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!reason || busy}>
          Send report
        </button>
      </div>
    </form>
  );
}

function GalleryView({ onOpened }: { readonly onOpened: () => void }) {
  const user = useAccount((s) => s.user);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [gallery, setGallery] = useState<Gallery>({ state: 'loading' });
  const [reporting, setReporting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // only the latest request's answer counts
  const latest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const request = ++latest.current;
    setGallery({ state: 'loading' });
    cloudApi.gallery(query, null).then(
      (page) => request === latest.current && setGallery({ state: 'ready', ...page }),
      (error: unknown) => request === latest.current && setGallery({ state: 'failed', message: messageOf(error) }),
    );
  }, [query]);

  const more = async (after: string, shown: readonly ModelInfo[]): Promise<void> => {
    const request = ++latest.current;
    setBusy(true);
    try {
      const page = await cloudApi.gallery(query, after);
      if (request === latest.current) setGallery({ state: 'ready', models: [...shown, ...page.models], next: page.next });
    } catch (error: unknown) {
      if (request === latest.current) setGallery({ state: 'failed', message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const takeOut = async (model: ModelInfo): Promise<void> => {
    if (!(await moderateModel(model, { hidden: true }))) return;
    setGallery((current) => (current.state === 'ready' ? { ...current, models: current.models.filter((m) => m.id !== model.id) } : current));
  };

  return (
    <>
      <label className="gallery-search">
        <Icon name="search" size={16} />
        <input type="search" aria-label="Search the gallery" placeholder="Search by name" maxLength={MAX_SEARCH} value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {gallery.state === 'loading' ? (
        <p className="cloud-empty" role="status">
          Looking in the gallery…
        </p>
      ) : gallery.state === 'failed' ? (
        <p className="cloud-empty" role="alert">
          {gallery.message}
        </p>
      ) : gallery.models.length === 0 ? (
        <p className="cloud-empty">{query.trim() ? `Nothing in the gallery is called anything like “${query.trim()}”.` : 'Nothing in the gallery yet. Publish one of your models online to put it here.'}</p>
      ) : (
        <>
          <ul className="model-grid" aria-label="Models in the gallery">
            {gallery.models.map((model) => {
              const mine = user?.id === model.owner.id;
              const canReport = user !== null && !mine && !user.banned;
              return (
                <ModelCard
                  key={model.id}
                  model={model}
                  details={
                    <>
                      by {model.owner.name}
                      {mine && ' (you)'}
                      <br />
                      {bricksText(model.bricks)} · {dateText(model.publishedAt ?? model.updatedAt)}
                    </>
                  }
                  actions={
                    <>
                      <button
                        type="button"
                        className="btn btn-outline"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void openOnline(model.id).then((opened) => {
                            setBusy(false);
                            if (opened) onOpened();
                          });
                        }}
                      >
                        Open
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Copy a link to ${model.name}`} title="Copy link" onClick={() => void copyGalleryLink(model)}>
                        <Icon name="link" size={16} />
                      </button>
                      {canReport && (
                        <button type="button" className="icon-btn" aria-label={`Report ${model.name}`} title="Report" aria-expanded={reporting === model.id} onClick={() => setReporting(reporting === model.id ? null : model.id)}>
                          <Icon name="flag" size={16} />
                        </button>
                      )}
                      {user?.admin && (
                        <button type="button" className="icon-btn btn-danger" aria-label={`Take ${model.name} out of the gallery`} title="Take out of the gallery" onClick={() => void takeOut(model)}>
                          <Icon name="eyeOff" size={16} />
                        </button>
                      )}
                    </>
                  }
                >
                  {reporting === model.id && <ReportForm model={model} onDone={() => setReporting(null)} />}
                </ModelCard>
              );
            })}
          </ul>
          {gallery.next !== null && (
            <div className="gallery-more">
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => gallery.next && void more(gallery.next, gallery.models)}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** The gallery: published models, the latest first, to open and build on; for moderators, what has been reported. */
export function GalleryDialog() {
  const isOpen = useEditor((s) => s.dialog === 'gallery');
  const close = useEditor((s) => s.closeDialog);
  const admin = useAccount((s) => s.user?.admin ?? false);
  const [view, setView] = useState<'gallery' | 'reports'>('gallery');
  const showing = admin ? view : 'gallery';

  return (
    <Dialog id="gallery" title="Gallery" open={isOpen} onClose={() => close('gallery')} wide>
      {admin && (
        <div className="segmented gallery-views" role="group" aria-label="Show">
          <button type="button" aria-pressed={showing === 'gallery'} onClick={() => setView('gallery')}>
            Gallery
          </button>
          <button type="button" aria-pressed={showing === 'reports'} onClick={() => setView('reports')}>
            Reported
          </button>
        </div>
      )}
      {showing === 'gallery' ? <GalleryView onOpened={() => close('gallery')} /> : <ModerationView />}
    </Dialog>
  );
}
