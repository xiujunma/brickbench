import { useMemo, useRef, useState } from 'react';
import { DEFAULT_VIEW_DIRECTION } from '../../core/instructions/camera';
import { MAX_PAGES, exceedsPageLimit, pageCount, pageGeometry, type PageSize } from '../../core/instructions/layout';
import { planSteps, type StepOrder } from '../../core/instructions/steps';
import { slugify } from '../../core/io/ldraw';
import { getPart } from '../../core/parts/catalog';
import { getEngine } from '../../editor/engineRegistry';
import {
  DEFAULT_INSTRUCTION_OPTIONS,
  createInstructionsPdf,
  isAbortError,
  nextTask,
  type InstructionOptions,
  type InstructionProgress,
} from '../../instructions/createInstructions';
import { editorStore, useEditor } from '../../state/editorStore';
import { downloadBlob } from '../../state/files';
import { partLibrary } from '../../state/library';
import { bricksOf, distinctPieces } from '../../state/selectors';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { cssVars } from '../platform';

const STEP_SIZES = [3, 6, 10, 20, 40] as const;
const LARGEST_STEP = 40;
const ORDERS: readonly { readonly id: StepOrder; readonly label: string }[] = [
  { id: 'layers', label: 'Bottom up' },
  { id: 'build-order', label: 'As you built it' },
];
const PAPERS: readonly { readonly id: PageSize; readonly label: string }[] = [
  { id: 'a4', label: 'A4' },
  { id: 'letter', label: 'US Letter' },
];

type ChoiceProps<T extends string | number> = {
  readonly legend: string;
  readonly choices: readonly { readonly id: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
};

function Choice<T extends string | number>({ legend, choices, value, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      <div className="segmented" role="group" aria-label={legend}>
        {choices.map((choice) => (
          <button key={choice.id} type="button" aria-pressed={choice.id === value} onClick={() => onChange(choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ProgressBar({ progress }: { readonly progress: InstructionProgress }) {
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

export function InstructionsDialog() {
  const isOpen = useEditor((s) => s.dialog === 'instructions');
  const close = useEditor((s) => s.closeDialog);
  const model = useEditor((s) => s.history.present);
  const [options, setOptions] = useState<InstructionOptions>(DEFAULT_INSTRUCTION_OPTIONS);
  const [progress, setProgress] = useState<InstructionProgress | null>(null);
  const running = useRef<AbortController | null>(null);

  const bricks = bricksOf(model);
  const page = pageGeometry(options.pageSize);
  const kinds = distinctPieces(model);
  const { order, partsPerStep } = options;
  // skip planning when even perfectly full steps would run past the page limit
  const overLimit = exceedsPageLimit(page, bricks.length, partsPerStep, kinds);
  const stepCount = useMemo(
    () => (isOpen && !overLimit ? planSteps(bricks, getPart, { order, partsPerStep }).length : 0),
    [isOpen, overLimit, bricks, order, partsPerStep],
  );
  const pages = pageCount(page, stepCount, kinds);
  const busy = progress !== null;
  const tooLong = overLimit || pages > MAX_PAGES;
  const tooBig = tooLong && (partsPerStep >= LARGEST_STEP || exceedsPageLimit(page, bricks.length, LARGEST_STEP, kinds));
  const summary = tooBig
    ? `This model is too big for one booklet (${bricks.length} bricks).`
    : tooLong
      ? `Over ${MAX_PAGES} pages: choose more parts per step.`
      : `${stepCount} step${stepCount === 1 ? '' : 's'} · ${pages} pages`;
  const update = (patch: Partial<InstructionOptions>) => setOptions((current) => ({ ...current, ...patch }));

  const handleClose = () => {
    running.current?.abort();
    close('instructions');
  };

  const handleMake = async () => {
    const state = editorStore.getState();
    const controller = new AbortController();
    running.current = controller;
    setProgress({ done: 0, total: 1, message: 'Getting ready…' });
    try {
      // let "Getting ready…" paint before the first, heaviest stretch of work
      await nextTask();
      const source = {
        name: state.name,
        bricks: bricksOf(state.history.present),
        settings: state.settings,
        direction: getEngine()?.viewDirection() ?? DEFAULT_VIEW_DIRECTION,
      };
      const pdf = await createInstructionsPdf(source, options, getPart, setProgress, controller.signal, partLibrary.meshes);
      downloadBlob(pdf, `${slugify(state.name)}-instructions.pdf`);
      state.toast('Building instructions saved to your downloads.', 'success');
      close('instructions');
    } catch (error: unknown) {
      if (isAbortError(error)) state.toast('Stopped making the instructions.');
      else state.toast(`Could not make the instructions: ${error instanceof Error ? error.message : 'unknown error'}`, 'error');
    } finally {
      running.current = null;
      setProgress(null);
    }
  };

  const footer = progress ? (
    <>
      <ProgressBar progress={progress} />
      <button
        type="button"
        className="btn btn-outline"
        onClick={(event) => {
          // the second click of a double-click on Make PDF lands here; don't let it stop the run
          if (event.detail > 1) return;
          running.current?.abort();
        }}
      >
        Stop
      </button>
    </>
  ) : (
    <>
      <span data-testid="instructions-summary" className={tooLong ? 'is-warning' : undefined}>
        {summary}
      </span>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void handleMake()}
        disabled={bricks.length === 0 || tooLong}
      >
        <Icon name="book" size={16} /> Make PDF
      </button>
    </>
  );

  return (
    <Dialog id="instructions" title="Building instructions" open={isOpen} onClose={handleClose} footer={footer}>
      {bricks.length === 0 ? (
        <p className="lede">Place some bricks first, then come back here to turn them into instructions.</p>
      ) : (
        <div className="instructions-form" aria-busy={busy}>
          <p className="lede">
            A printable booklet: a cover, the parts list, then one page per step showing the parts to add and where
            they go.
          </p>
          <fieldset className="field-group" disabled={busy}>
            <Choice
              legend="Parts per step"
              choices={STEP_SIZES.map((n) => ({ id: n, label: String(n) }))}
              value={options.partsPerStep}
              onChange={(partsPerStep) => update({ partsPerStep })}
            />
            <Choice legend="Step order" choices={ORDERS} value={options.order} onChange={(order) => update({ order })} />
            <Choice legend="Paper" choices={PAPERS} value={options.pageSize} onChange={(pageSize) => update({ pageSize })} />
            <label className="check">
              <input
                type="checkbox"
                checked={options.highlight}
                onChange={(event) => update({ highlight: event.target.checked })}
              />
              Outline the new parts in each step
            </label>
          </fieldset>
          <p className="note">
            <Icon name="rotate" size={16} />
            Pictures are drawn from your current view, so turn the model to show its best side first.
          </p>
        </div>
      )}
    </Dialog>
  );
}
