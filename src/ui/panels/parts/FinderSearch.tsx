import type { KeyboardEvent, Ref } from 'react';
import { partLibrary } from '../../../state/library';
import { Icon } from '../../components/Icon';
import { focusBuildArea, PART_SEARCH_ID } from '../../focusTargets';
import { PatternHelp } from './PatternHelp';

/** What Safari reports for keys an input method is still working with. */
const IME_PROCESS_KEY_CODE = 229;

type Props = {
  readonly query: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly onQuery: (query: string) => void;
  /** Moves the highlight through the results. */
  readonly onMove: (step: 1 | -1) => void;
  /** Builds with the highlighted part; says whether there was one. */
  readonly onEnter: () => boolean;
  /** Clears the search and filters; says whether there was anything to clear. */
  readonly onEscape: () => boolean;
};

/** Moves the keyboard to the build area, or just out of the box if there is none. */
function handBack(input: HTMLInputElement): void {
  if (!focusBuildArea()) input.blur();
}

/**
 * The one search box: type, then ↑ ↓ to choose and Enter to build with it.
 * Focusing it starts loading the library so its parts are there to find.
 */
export function FinderSearch({ query, inputRef, onQuery, onMove, onEnter, onEscape }: Props) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    // while an input method is composing a word, Enter and the arrows are its own
    if (event.nativeEvent.isComposing || event.keyCode === IME_PROCESS_KEY_CODE) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // hand the keyboard back to the editor so R, arrows and Esc work at once
      if (onEnter()) handBack(event.currentTarget);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (!onEscape()) handBack(event.currentTarget);
    }
  };

  // a pattern chosen from the help searches at once, with the keyboard back in the box
  const tryPattern = (pattern: string): void => {
    onQuery(pattern);
    document.getElementById(PART_SEARCH_ID)?.focus();
  };

  return (
    <div className="search">
      <label className="search-field">
        <Icon name="search" size={16} />
        <span className="visually-hidden">Find a part</span>
        <input
          ref={inputRef}
          id={PART_SEARCH_ID}
          type="search"
          placeholder="2x4 plate, cheese, P2x4…"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => partLibrary.request()}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </label>
      <PatternHelp onTry={tryPattern} />
      <kbd>/</kbd>
    </div>
  );
}
