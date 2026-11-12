import { partLibrary, useLibrary } from '../../../state/library';

/** Says why library parts are missing from a list, with a retry where one can help. */
export function LibraryNotice() {
  const status = useLibrary((s) => s.status);
  if (status === 'failed') {
    return (
      <p className="library-notice" role="status">
        The LDraw library could not load, so only the basic parts are here.{' '}
        <button type="button" className="link-button" onClick={() => partLibrary.retry()}>
          Try again
        </button>
      </p>
    );
  }
  if (status === 'missing') {
    return (
      <p className="library-notice" role="status">
        Only the basic parts: this copy of BrickBench was built without the LDraw library.
      </p>
    );
  }
  return null;
}
