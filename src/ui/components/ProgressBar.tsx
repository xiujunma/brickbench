import { cssVars } from '../platform';

export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly message: string;
}

/** How far a long job has got, with what it is doing now. */
export function ProgressBar({ progress }: { readonly progress: Progress }) {
  const fraction = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div className="progress-track">
        <span className="progress-fill" style={cssVars({ '--progress': String(fraction) })} />
      </div>
      <span className="progress-label">{progress.message}</span>
    </div>
  );
}
