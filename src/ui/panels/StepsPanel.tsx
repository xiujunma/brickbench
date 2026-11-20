import { useEffect, useMemo, useRef, useState } from 'react';
import { stepsOf, type InstructionPlan, type StepRef } from '../../core/instructions/plan';
import { MAX_ASSEMBLY_NAME, assemblyNameOf, dissolveAssembly, makeAssembly, mergeWithNext, moveToStep, newStepAfter, renameAssembly, setStepView } from '../../core/instructions/planEdits';
import { getBricks } from '../../core/model/model';
import { getPart } from '../../core/parts/catalog';
import { getEngine } from '../../editor/engineRegistry';
import { nextId, useEditor } from '../../state/editorStore';
import { shownStep, type ShownStep } from '../../state/stepEditor';
import { Icon } from '../components/Icon';
import { cssVars } from '../platform';
import { summarize } from './partSummary';

const PART_ROWS = 6;
/** Steps listed either side of the one on show: a big model has thousands. */
const LISTED_AROUND = 100;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function useShownStep(): ShownStep | null {
  const model = useEditor((s) => s.history.present);
  const editor = useEditor((s) => s.stepEditor);
  return useMemo(() => (editor ? shownStep(model, editor, getPart) : null), [model, editor]);
}

/** A step's line in the list: what it adds, and the sub-assembly it adds whole. */
function stepLabel(plan: InstructionPlan, assembly: string | null, index: number): string {
  const step = stepsOf(plan, assembly)[index];
  if (!step) return '';
  const added = step.assembly === undefined ? undefined : plan.assemblies.find((a) => a.id === step.assembly);
  const parts = step.bricks.length > 0 ? plural(step.bricks.length, 'part') : '';
  return [added ? `adds ${added.name}` : '', parts].filter(Boolean).join(', ');
}

function Navigator({ shown }: { readonly shown: ShownStep }) {
  const goTo = useEditor((s) => s.goToStep);
  const { at, count } = shown;
  const go = (index: number): void => goTo({ ...at, index });
  return (
    <div className="step-nav" role="group" aria-label="Go to a step">
      <button type="button" className="icon-btn" aria-label="Previous step" title="Previous step ([)" disabled={at.index === 0} onClick={() => go(at.index - 1)}>
        <Icon name="chevronLeft" size={18} />
      </button>
      <strong aria-live="polite">
        Step {at.index + 1} of {count}
      </strong>
      <button type="button" className="icon-btn" aria-label="Next step" title="Next step (])" disabled={at.index >= count - 1} onClick={() => go(at.index + 1)}>
        <Icon name="chevronRight" size={18} />
      </button>
    </div>
  );
}

/** The sub-assembly on show (the panel keys it by sub-assembly): its name, to change, and the way back to the model. */
function AssemblyHeader({ shown }: { readonly shown: ShownStep }) {
  const editPlan = useEditor((s) => s.editPlan);
  const goTo = useEditor((s) => s.goToStep);
  const assembly = shown.plan.assemblies.find((a) => a.id === shown.at.assembly);
  const [name, setName] = useState(assembly?.name ?? '');
  // renamed elsewhere, as by undo
  useEffect(() => setName(assembly?.name ?? ''), [assembly?.name]);
  if (!assembly) return null;
  const adding = shown.plan.steps.findIndex((s) => s.assembly === assembly.id);
  const rename = (): void => {
    const kept = assemblyNameOf(name);
    // an empty name is no name: the field shows the one it keeps
    setName(kept || assembly.name);
    if (kept) editPlan((plan) => ({ plan: renameAssembly(plan, assembly.id, kept), at: shown.at }));
  };
  return (
    <div className="step-assembly">
      <label>
        <span>Sub-assembly</span>
        <input
          value={name}
          maxLength={MAX_ASSEMBLY_NAME}
          onChange={(e) => setName(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === 'Enter' && rename()}
        />
      </label>
      <button type="button" className="btn btn-outline" onClick={() => goTo({ assembly: null, index: Math.max(0, adding) })}>
        <Icon name="chevronLeft" size={16} /> Back to the model
      </button>
    </div>
  );
}

function StepContents({ shown }: { readonly shown: ShownStep }) {
  const model = useEditor((s) => s.history.present);
  const goTo = useEditor((s) => s.goToStep);
  const step = shown.step;
  const added = step?.assembly === undefined ? undefined : shown.plan.assemblies.find((a) => a.id === step.assembly);
  const rows = summarize(getBricks(model, step?.bricks ?? []), PART_ROWS);
  const hidden = (step?.bricks.length ?? 0) - rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <>
      {added && (
        <p className="step-adds">
          Adds the sub-assembly <strong>{added.name}</strong>, built in {plural(added.steps.length, 'step')} of its own.{' '}
          <button type="button" className="link-button" onClick={() => goTo({ assembly: added.id, index: 0 })}>
            Open it
          </button>
        </p>
      )}
      <ul className="selection-summary" aria-label="Parts this step adds">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="dot" style={cssVars({ '--c': row.hex })} />
            {row.name}
            <span className="qty">×{row.count}</span>
          </li>
        ))}
        {hidden > 0 && <li className="lede">and {hidden} more</li>}
      </ul>
    </>
  );
}

function SelectionActions({ shown }: { readonly shown: ShownStep }) {
  const selection = useEditor((s) => s.selection);
  const editPlan = useEditor((s) => s.editPlan);
  const clearSelection = useEditor((s) => s.clearSelection);
  const ids = [...selection];
  const none = ids.length === 0;
  const inModel = shown.at.assembly === null;
  // let go of the bricks once placed, so the view shows them as the step does
  const act = (edit: Parameters<typeof editPlan>[0]): void => {
    editPlan(edit);
    clearSelection();
  };
  return (
    <section className="inspector-section" aria-labelledby="step-selection-heading">
      <header className="section-head">
        <h2 id="step-selection-heading">Selected bricks</h2>
        <span className="count mono">{ids.length}</span>
      </header>
      {none && <p className="lede">Click bricks to select them; those of later steps show faintly.</p>}
      <div className="action-column">
        <button type="button" className="btn btn-outline" disabled={none} onClick={() => act((plan) => moveToStep(plan, ids, shown.at))}>
          Move to this step
        </button>
        <button type="button" className="btn btn-outline" disabled={none} onClick={() => act((plan) => newStepAfter(plan, ids, shown.at))}>
          Make a new step after this one
        </button>
        {inModel && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={none}
            title="Build them on pages of their own, then add them whole at this step"
            onClick={() => act((plan, context) => makeAssembly(plan, ids, shown.at, nextId(), context))}
          >
            Make a sub-assembly
          </button>
        )}
      </div>
    </section>
  );
}

function StepActions({ shown }: { readonly shown: ShownStep }) {
  const editPlan = useEditor((s) => s.editPlan);
  const { at, step, count } = shown;
  const view = step?.view;
  const ownView = (): void => {
    const direction = getEngine()?.viewDirection();
    if (direction) editPlan((plan) => setStepView(plan, at, direction));
  };
  return (
    <section className="inspector-section" aria-labelledby="step-heading">
      <header className="section-head">
        <h2 id="step-heading">This step</h2>
        {view && <span className="hint">Has its own view</span>}
      </header>
      <div className="action-column">
        <button type="button" className="btn btn-outline" disabled={at.index >= count - 1} onClick={() => editPlan((plan) => mergeWithNext(plan, at))}>
          Join with the next step
        </button>
        <button type="button" className="btn btn-outline" onClick={ownView} title="Draw this step from where the 3D view looks now">
          <Icon name="rotate" size={16} /> Draw it from this view
        </button>
        {view && (
          <div className="action-row">
            <button type="button" className="btn btn-outline" onClick={() => getEngine()?.lookAlong(view)}>
              Look from its view
            </button>
            <button type="button" className="btn btn-outline" onClick={() => editPlan((plan) => setStepView(plan, at, null))}>
              Use the booklet’s view
            </button>
          </div>
        )}
        {step?.assembly !== undefined && (
          <button
            type="button"
            className="btn btn-outline"
            title="Add the sub-assembly’s parts loose in this step, and build it on pages of its own no more"
            onClick={() => editPlan((plan) => dissolveAssembly(plan, step.assembly as string))}
          >
            Build its parts in this step instead
          </button>
        )}
      </div>
    </section>
  );
}

/** The steps around the one on show, which stays in sight as it changes. */
function StepList({ shown }: { readonly shown: ShownStep }) {
  const goTo = useEditor((s) => s.goToStep);
  const list = useRef<HTMLOListElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  const { plan, at, count } = shown;
  const first = Math.max(0, at.index - LISTED_AROUND);
  const last = Math.min(count, at.index + LISTED_AROUND + 1);
  useEffect(() => {
    const box = list.current;
    const item = current.current;
    if (!box || !item) return;
    // the list scrolls, not the panel around it, which would take the step on show out of sight
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [at.assembly, at.index, first]);
  return (
    <>
      {(first > 0 || last < count) && (
        <p className="lede">
          Steps {first + 1}–{last} of {count}
        </p>
      )}
      <ol ref={list} className="step-list" aria-label="Steps" start={first + 1}>
        {Array.from({ length: last - first }, (_, i) => {
          const index = first + i;
          const ref: StepRef = { assembly: at.assembly, index };
          const isCurrent = index === at.index;
          return (
            <li key={index}>
              <button type="button" ref={isCurrent ? current : undefined} aria-current={isCurrent ? 'step' : undefined} onClick={() => goTo(ref)}>
                <span className="mono">{index + 1}</span>
                {stepLabel(plan, at.assembly, index)}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Arranging the building instructions by hand: the step on show in the 3D view, and what can be done with it. */
export function StepsPanel() {
  const shown = useShownStep();
  const close = useEditor((s) => s.closeSteps);
  const openDialog = useEditor((s) => s.openDialog);
  if (!shown) return null;
  return (
    <aside className="panel panel-inspector panel-steps" aria-label="Instruction steps">
      <div className="panel-head">
        <h2>Instruction steps</h2>
        <button type="button" className="btn btn-primary" onClick={close}>
          Done
        </button>
      </div>
      <section className="inspector-section" aria-label="The step on show">
        <AssemblyHeader key={shown.at.assembly ?? ''} shown={shown} />
        <Navigator shown={shown} />
        <StepContents shown={shown} />
      </section>
      <SelectionActions shown={shown} />
      <StepActions shown={shown} />
      <section className="inspector-section" aria-label="All steps">
        <StepList shown={shown} />
        <div className="action-row">
          <button type="button" className="btn btn-outline" onClick={() => openDialog('instructions')}>
            <Icon name="book" size={16} /> Make the booklet…
          </button>
        </div>
      </section>
    </aside>
  );
}
