import { useCallback, useEffect, useState } from 'react';
import type { ReportedModel, ReportReason, StoppedAccount } from '../../core/cloud/protocol';
import { CloudError, cloudApi } from '../../state/cloudApi';
import { deleteAsModerator, moderateModel, stopAccount } from '../../state/online';
import { Icon } from '../components/Icon';
import { bricksText, dateText, ModelCard } from './ModelCard';

const REASON_WORDS: Readonly<Record<ReportReason, string>> = {
  offensive: 'offensive',
  spam: 'spam',
  copied: 'copied',
  other: 'something else',
};

type Queue =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly message: string }
  | { readonly state: 'ready'; readonly reports: readonly ReportedModel[]; readonly stopped: readonly StoppedAccount[] };

function reasonsText(report: ReportedModel): string {
  return (Object.entries(report.reasons) as [ReportReason, number][]).map(([reason, count]) => `${REASON_WORDS[reason]} ×${count}`).join(', ');
}

/** For moderators: reported models to take out of the gallery or keep, and accounts stopped from saving. */
export function ModerationView() {
  const [queue, setQueue] = useState<Queue>({ state: 'loading' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [reports, stopped] = await Promise.all([cloudApi.reports(), cloudApi.stoppedAccounts()]);
      setQueue({ state: 'ready', reports, stopped });
    } catch (error: unknown) {
      setQueue({ state: 'failed', message: error instanceof CloudError ? error.message : 'The reports could not be loaded.' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      if (await work()) await load();
    } finally {
      setBusy(false);
    }
  };

  if (queue.state === 'loading') {
    return (
      <p className="cloud-empty" role="status">
        Looking for reports…
      </p>
    );
  }
  if (queue.state === 'failed') {
    return (
      <p className="cloud-empty" role="alert">
        {queue.message}
      </p>
    );
  }
  return (
    <>
      {queue.reports.length === 0 ? (
        <p className="cloud-empty">Nothing is reported.</p>
      ) : (
        <ul className="model-grid" aria-label="Reported models">
          {queue.reports.map((report) => {
            const { model } = report;
            const owner = { id: model.owner.id, name: model.owner.name };
            return (
              <ModelCard
                key={model.id}
                model={model}
                details={
                  <>
                    by {model.owner.name} · {bricksText(model.bricks)}
                    <br />
                    <strong>
                      {report.count} {report.count === 1 ? 'report' : 'reports'}
                    </strong>
                    : {reasonsText(report)}, latest {dateText(report.latestAt)}
                    {model.hidden && (
                      <>
                        <br />
                        <span className="model-card-standing is-hidden">Out of the gallery</span>
                      </>
                    )}
                  </>
                }
                actions={
                  <>
                    {model.hidden ? (
                      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void act(() => moderateModel(model, { hidden: false }))}>
                        <Icon name="eye" size={16} />
                        Put back
                      </button>
                    ) : (
                      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void act(() => moderateModel(model, { hidden: true }))}>
                        <Icon name="eyeOff" size={16} />
                        Take out
                      </button>
                    )}
                    <button type="button" className="btn" disabled={busy} onClick={() => void act(() => moderateModel(model, { dismiss: true }))}>
                      Keep
                    </button>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void act(() => deleteAsModerator(model))}>
                      Delete
                    </button>
                    {!report.ownerBanned && (
                      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void act(() => stopAccount(owner, true))}>
                        Stop account
                      </button>
                    )}
                  </>
                }
              >
                {report.notes.length > 0 && (
                  <ul className="report-notes">
                    {report.notes.map((note, index) => (
                      <li key={index}>“{note}”</li>
                    ))}
                  </ul>
                )}
              </ModelCard>
            );
          })}
        </ul>
      )}
      {queue.stopped.length > 0 && (
        <section className="stopped-accounts" aria-label="Stopped accounts">
          <h3>Stopped accounts</h3>
          <ul>
            {queue.stopped.map((account) => (
              <li key={account.id}>
                <span>{account.name}</span>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void act(() => stopAccount(account, false))}>
                  Let back in
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
