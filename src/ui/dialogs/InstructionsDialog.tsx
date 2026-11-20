import { useMemo, useRef, useState } from 'react';
import { DEFAULT_VIEW_DIRECTION } from '../../core/instructions/camera';
import { MAX_PAGES, exceedsPageLimit, pageCount, pageGeometry, partsBoxCapacity, type PageSize } from '../../core/instructions/layout';
import { leftOutCount, type InstructionPlan } from '../../core/instructions/plan';
import { bookletPlan, bookletStepCount, type BookletOrder } from '../../core/instructions/planView';
import { DEFAULT_STEP_OPTIONS, type StepOrder } from '../../core/instructions/steps';
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
import { saveBlob } from '../../state/files';
import { partLibrary } from '../../state/library';
import { bricksOf, distinctPieces } from '../../state/selectors';
import { Choice } from '../components/Choice';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';

const STEP_SIZES = [3, 6, 10, 20, 40] as const;
const LARGEST_STEP = 40;
const AUTO_ORDERS: readonly { readonly id: StepOrder; readonly label: string }[] = [
  { id: 'layers', label: 'Bottom up' },
  { id: 'build-order', label: 'As you built it' },
];
const ORDERS: readonly { readonly id: BookletOrder; readonly label: string }[] = [{ id: 'custom', label: 'Your steps' }, ...AUTO_ORDERS];
const PAPERS: readonly { readonly id: PageSize; readonly label: string }[] = [
  { id: 'a4', label: 'A4' },
  { id: 'letter', label: 'US Letter' },
];

/** The dialog's choices, and the automatic order last chosen: the one "Your steps" stands for while there are none. */
interface Choices extends InstructionOptions {
  readonly autoOrder: StepOrder;
}

const INITIAL_CHOICES: Choices = { ...DEFAULT_INSTRUCTION_OPTIONS, order: 'custom', autoOrder: DEFAULT_STEP_OPTIONS.order };

/** Whether any step of a plan is drawn from a view of its own. */
function hasOwnViews(plan: InstructionPlan | undefined): boolean {
  const steps = [...(plan?.steps ?? []), ...(plan?.assemblies.flatMap((a) => a.steps) ?? [])];
  return steps.some((step) => step.view !== undefined);
}

export function InstructionsDialog() {
  const isOpen = useEditor((s) => s.dialog === 'instructions');
  const close = useEditor((s) => s.closeDialog);
  const editSteps = useEditor((s) => s.editSteps);
  const model = useEditor((s) => s.history.present);
  const [choices, setChoices] = useState<Choices>(INITIAL_CHOICES);
  const [progress, setProgress] = useState<InstructionProgress | null>(null);
  const running = useRef<AbortController | null>(null);

  const bricks = bricksOf(model);
  const page = pageGeometry(choices.pageSize);
  const kinds = distinctPieces(model);
  const { partsPerStep, autoOrder } = choices;
  const hasPlan = model.plan !== undefined;
  const order: BookletOrder = choices.order === 'custom' && !hasPlan ? autoOrder : choices.order;
  const custom = order === 'custom';
  const options: InstructionOptions = { pageSize: choices.pageSize, partsPerStep, order, highlight: choices.highlight };
  // planned automatically, skip planning when even perfectly full steps would run past the page limit
  const overLimit = !custom && exceedsPageLimit(page, bricks.length, partsPerStep, kinds);
  const capacity = partsBoxCapacity(page);
  const stepCount = useMemo(
    () => (isOpen && !overLimit ? bookletStepCount(bookletPlan(model.bricks, model.plan, { order, partsPerStep }, getPart), model.bricks, capacity) : 0),
    [isOpen, overLimit, model.bricks, model.plan, order, partsPerStep, capacity],
  );
  // with the user's steps, parts per step is for the bricks they leave out
  const leftOut = useMemo(() => (custom ? leftOutCount(model.plan, model.bricks) : model.bricks.size), [custom, model.plan, model.bricks]);
  const pages = pageCount(page, stepCount, kinds);
  const busy = progress !== null;
  const tooLong = overLimit || pages > MAX_PAGES;
  const tooBig = tooLong && !custom && (partsPerStep >= LARGEST_STEP || exceedsPageLimit(page, bricks.length, LARGEST_STEP, kinds));
  const advice = !custom ? 'choose more parts per step' : leftOut > 0 ? 'join some steps, or choose more parts per step' : 'join some steps';
  const summary = tooBig
    ? `This model is too big for one booklet (${bricks.length} bricks).`
    : tooLong
      ? `Over ${MAX_PAGES} pages: ${advice}.`
      : `${stepCount} step${stepCount === 1 ? '' : 's'} · ${pages} pages`;
  const update = (patch: Partial<Choices>) => setChoices((current) => ({ ...current, ...patch }));
  const chooseOrder = (next: BookletOrder) => update(next === 'custom' ? { order: next } : { order: next, autoOrder: next });

  const handleEditSteps = () => {
    // back here, the booklet follows the steps as arranged
    update({ order: 'custom' });
    editSteps({ order: autoOrder, partsPerStep });
    close('instructions');
  };

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
        plan: state.history.present.plan,
      };
      const pdf = await createInstructionsPdf(source, options, getPart, setProgress, controller.signal, partLibrary.meshes);
      saveBlob(pdf, `${slugify(state.name)}-instructions.pdf`, 'Building instructions saved to your downloads.', state.toast);
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
        // its own key: the Make button that had focus goes, rather than turning into Stop under the keyboard
        key="stop"
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
        key="make"
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
            <div className="order-row">
              <Choice legend="Step order" choices={hasPlan ? ORDERS : AUTO_ORDERS} value={order} onChange={chooseOrder} />
              <button type="button" className="btn btn-outline" onClick={handleEditSteps} title="Arrange the steps yourself, in the 3D view">
                <Icon name="layers" size={16} /> Edit steps…
              </button>
            </div>
            {leftOut > 0 && (
              <Choice
                legend={custom ? 'Parts per step for new bricks' : 'Parts per step'}
                choices={STEP_SIZES.map((n) => ({ id: n, label: String(n) }))}
                value={partsPerStep}
                onChange={(next) => update({ partsPerStep: next })}
              />
            )}
            <Choice legend="Paper" choices={PAPERS} value={choices.pageSize} onChange={(pageSize) => update({ pageSize })} />
            <label className="check">
              <input
                type="checkbox"
                checked={choices.highlight}
                onChange={(event) => update({ highlight: event.target.checked })}
              />
              Outline the new parts in each step
            </label>
          </fieldset>
          <p className="note">
            <Icon name="rotate" size={16} />
            Pictures are drawn from your current view, so turn the model to show its best side first.
            {custom && hasOwnViews(model.plan) && ' Steps you gave a view of their own keep it.'}
          </p>
        </div>
      )}
    </Dialog>
  );
}
