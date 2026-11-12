import { partLibrary } from '../../../state/library';

/** The attribution CC BY asks for, wherever library parts are listed. */
export function LibraryCredit() {
  return (
    <p className="library-credit">
      Parts from the{' '}
      <a href="https://library.ldraw.org" target="_blank" rel="noopener noreferrer">
        LDraw™ Parts Library
      </a>{' '}
      by its contributors, under CC BY 4.0.{' '}
      <a href={`${partLibrary.baseUrl}CREDITS.txt`} target="_blank" rel="noopener noreferrer">
        Credits
      </a>
    </p>
  );
}
