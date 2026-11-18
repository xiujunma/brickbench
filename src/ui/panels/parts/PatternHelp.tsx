import { useEffect, useId, useRef } from 'react';
import { Icon } from '../../components/Icon';

/** Patterns worth trying, each with what it finds. */
const EXAMPLES: readonly (readonly [pattern: string, finds: string])[] = [
  ['P2x4', '2 × 4 plates'],
  ['B1x(1|2)', '1 × 1 and 1 × 2 bricks'],
  ['S45[oo/..]', '45° slopes, studs at the back'],
  ['T[..]{2}', '2 × 2 tiles'],
  ['P1x2 +clip', '1 × 2 plates with a clip'],
  ['[o_/oo]', 'anything shaped like a corner'],
];

const WIDTH = 340;
/** Space kept between the panel and the window's edges, and below the button. */
const GAP = 8;

type Props = {
  /** Puts a pattern in the search box, to search with it. */
  readonly onTry: (pattern: string) => void;
};

/**
 * The "?" beside the search box: how to write a part pattern
 * (docs/part-patterns.md in short), with examples that search when chosen.
 */
export function PatternHelp({ onTry }: Props) {
  const id = useId();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const place = (event: Event): void => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const box = trigger.getBoundingClientRect();
      const width = Math.min(WIDTH, window.innerWidth - 2 * GAP);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(GAP, Math.min(box.right - width, window.innerWidth - width - GAP))}px`;
      panel.style.top = `${box.bottom + GAP}px`;
    };
    panel.addEventListener('beforetoggle', place);
    return () => panel.removeEventListener('beforetoggle', place);
  }, []);

  const tryPattern = (pattern: string): void => {
    panelRef.current?.hidePopover();
    onTry(pattern);
  };

  return (
    <>
      <button ref={triggerRef} type="button" className="pattern-help-trigger" popoverTarget={id} aria-label="How to write part patterns" title="Part patterns">
        <Icon name="help" size={16} />
      </button>
      <div ref={panelRef} id={id} popover="auto" className="pattern-help" role="dialog" aria-labelledby={titleId}>
        <h2 id={titleId}>Part patterns</h2>
        <p>Say exactly which parts you mean: kind, size, height, and the top face stud by stud. Choose one to try it.</p>
        <ul className="pattern-help-examples">
          {EXAMPLES.map(([pattern, finds]) => (
            <li key={pattern}>
              <button type="button" onClick={() => tryPattern(pattern)}>
                <code>{pattern}</code>
                <span>{finds}</span>
              </button>
            </li>
          ))}
        </ul>
        <dl className="pattern-help-syntax">
          <dt>Kind</dt>
          <dd>
            <code>B</code> brick, <code>P</code> plate, <code>T</code> tile, <code>S</code> slope (<code>S45</code>, <code>Si</code> inverted),{' '}
            <code>R</code> round, <code>C</code> cone, <code>A</code> arch, <code>*</code> any
          </dd>
          <dt>Size</dt>
          <dd>
            <code>2x4</code> either way round, <code>1x*</code>, <code>{'{1,2}x4'}</code>, <code>(1|2)x4</code>; a third size counts bricks:{' '}
            <code>B1x2x5</code>
          </dd>
          <dt>Top</dt>
          <dd>
            rows in <code>[ ]</code> from the back, split by <code>/</code>: <code>o</code> stud, <code>.</code> none, <code>_</code> no cell,{' '}
            <code>#</code> any; with <code>* + ? {'{2,4}'} ( | )</code>, and <code>{']{2}'}</code> repeats the rows
          </dd>
          <dt>Height</dt>
          <dd>
            <code>^3</code> plates, <code>^*</code> any; <code>B</code> is one brick, <code>P</code> and <code>T</code> one plate
          </dd>
          <dt>More</dt>
          <dd>
            <code>+clip</code> or <code>-clip</code> a feature, <code>:red</code> the colour to build in, <code>=30*</code> a number,{' '}
            <code>@owned</code> your parts, <code>"corner"</code> words in the name
          </dd>
          <dt>Together</dt>
          <dd>
            side by side all hold, <code>|</code> either, <code>!</code> not, <code>( )</code> groups
          </dd>
        </dl>
      </div>
    </>
  );
}
