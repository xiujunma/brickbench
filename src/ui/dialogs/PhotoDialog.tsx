import { useRef, useState } from 'react';
import { slugify } from '../../core/io/ldraw';
import { getPart } from '../../core/parts/catalog';
import { desktopApi } from '../../desktop/protocol';
import { getEngine } from '../../editor/engineRegistry';
import { isAbortError, nextTask } from '../../instructions/createInstructions';
import { editorStore, useEditor } from '../../state/editorStore';
import { saveBlob } from '../../state/files';
import { partLibrary } from '../../state/library';
import { bricksOf, worldBounds } from '../../state/selectors';
import { Choice } from '../components/Choice';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';

type Quality = 'draft' | 'good' | 'best';
type Size = 'hd' | '4k';

/** Samples per pixel: each doubling halves the grain and doubles the wait. */
const SAMPLES: Readonly<Record<Quality, number>> = { draft: 32, good: 128, best: 512 };
const QUALITIES: readonly { readonly id: Quality; readonly label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'good', label: 'Good' },
  { id: 'best', label: 'Best' },
];
/** The photo's longer side, in pixels; the shorter follows the view's shape. */
const LONG_SIDE: Readonly<Record<Size, number>> = { hd: 1920, '4k': 3840 };
const SIZES: readonly { readonly id: Size; readonly label: string }[] = [
  { id: 'hd', label: 'HD' },
  { id: '4k', label: '4K' },
];

const SAVED_WHERE = desktopApi() ? 'and saved where you choose' : 'and saved to your downloads';

interface Progress {
  readonly done: number;
  readonly total: number;
  readonly message: string;
}

function sizeFor(size: Size, aspect: number): { readonly width: number; readonly height: number } {
  const long = LONG_SIDE[size];
  return aspect >= 1 ? { width: long, height: Math.round(long / aspect) } : { width: Math.round(long * aspect), height: long };
}

/** A still of the view as it is, path traced: light bounces between the bricks, and glass is glass. */
export function PhotoDialog() {
  const isOpen = useEditor((s) => s.dialog === 'photo');
  const close = useEditor((s) => s.closeDialog);
  const brickCount = useEditor((s) => s.history.present.bricks.size);
  const [quality, setQuality] = useState<Quality>('good');
  const [size, setSize] = useState<Size>('hd');
  const [progress, setProgress] = useState<Progress | null>(null);
  const running = useRef<AbortController | null>(null);
  const busy = progress !== null;

  const handleClose = () => {
    running.current?.abort();
    close('photo');
  };

  const handleRender = async () => {
    const state = editorStore.getState();
    const engine = getEngine();
    const bricks = bricksOf(state.history.present);
    const bounds = worldBounds(bricks, getPart);
    if (!engine || !bounds) return;
    const controller = new AbortController();
    running.current = controller;
    setProgress({ done: 0, total: 1, message: 'Getting ready…' });
    try {
      await nextTask();
      const view = engine.viewCamera();
      const { renderPhoto } = await import('../../engine/photoRenderer');
      const { width, height } = sizeFor(size, view.aspect);
      const samples = SAMPLES[quality];
      const blob = await renderPhoto(
        { bricks, settings: state.settings, bounds, camera: view, width, height, samples },
        getPart,
        partLibrary.meshes,
        (done, total) => setProgress({ done, total, message: `${done} of ${total} samples` }),
        controller.signal,
      );
      saveBlob(blob, `${slugify(state.name)}-photo.png`, 'Photo saved to your downloads.', state.toast);
      close('photo');
    } catch (error: unknown) {
      if (isAbortError(error)) state.toast('Stopped making the photo.');
      else state.toast(`Could not make the photo: ${error instanceof Error ? error.message : 'unknown error'}`, 'error');
    } finally {
      running.current = null;
      setProgress(null);
    }
  };

  const footer = progress ? (
    <>
      <ProgressBar progress={progress} />
      <button key="stop" type="button" className="btn btn-outline" onClick={() => running.current?.abort()}>
        Stop
      </button>
    </>
  ) : (
    <>
      <span />
      <button key="render" type="button" className="btn btn-primary" onClick={() => void handleRender()} disabled={brickCount === 0}>
        <Icon name="image" size={16} /> Make photo
      </button>
    </>
  );

  return (
    <Dialog id="photo" title="Photo" open={isOpen} onClose={handleClose} footer={footer}>
      {brickCount === 0 ? (
        <p className="lede">Place some bricks first, then come back here for a photo of them.</p>
      ) : (
        <div className="instructions-form" aria-busy={busy}>
          <p className="lede">
            A still of the view as it is, with the light worked out properly: it bounces between bricks, shadows soften, and transparent bricks are
            glass. It takes from seconds to minutes, on your computer, {SAVED_WHERE}.
          </p>
          <fieldset className="field-group" disabled={busy}>
            <Choice legend="Quality" choices={QUALITIES} value={quality} onChange={setQuality} />
            <Choice legend="Size" choices={SIZES} value={size} onChange={setSize} />
          </fieldset>
          <p className="note">
            <Icon name="rotate" size={16} />
            Turn and zoom the view first: the photo is taken from where you are looking.
          </p>
        </div>
      )}
    </Dialog>
  );
}
