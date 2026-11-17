import { useRef, useState } from 'react';
import { DEFAULT_VIEW_DIRECTION } from '../../core/instructions/camera';
import type { StepOrder } from '../../core/instructions/steps';
import { slugify } from '../../core/io/ldraw';
import { getPart } from '../../core/parts/catalog';
import {
  DEFAULT_TIMELAPSE_OPTIONS,
  VIDEO_LENGTHS,
  videoSize,
  type TimelapseOptions,
  type VideoShape,
  type VideoSize,
} from '../../core/timelapse/timeline';
import { getEngine } from '../../editor/engineRegistry';
import { isAbortError, nextTask } from '../../instructions/createInstructions';
import { editorStore, useEditor } from '../../state/editorStore';
import { downloadBlob } from '../../state/files';
import { partLibrary } from '../../state/library';
import { bricksOf } from '../../state/selectors';
import { createTimelapse, type TimelapseProgress } from '../../timelapse/createTimelapse';
import { Choice } from '../components/Choice';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/ProgressBar';

const ORDERS: readonly { readonly id: StepOrder; readonly label: string }[] = [
  { id: 'build-order', label: 'As you built it' },
  { id: 'layers', label: 'Bottom up' },
];
const LENGTHS = VIDEO_LENGTHS.map((seconds) => ({ id: seconds, label: `${seconds} s` }));
const SHAPES: readonly { readonly id: VideoShape; readonly label: string }[] = [
  { id: 'landscape', label: 'Landscape' },
  { id: 'square', label: 'Square' },
  { id: 'portrait', label: 'Portrait' },
];
const SIZES: readonly { readonly id: VideoSize; readonly label: string }[] = [
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
];

/** "20 s · 1920 × 1080 · about 15 bricks a second" */
function summaryOf(options: TimelapseOptions, bricks: number): string {
  const { width, height } = videoSize(options.shape, options.size);
  const rate = bricks / options.seconds;
  const pace = rate >= 1 ? `about ${Math.round(rate).toLocaleString('en')} bricks a second` : `a brick every ${Math.round(1 / rate)} s`;
  return `${options.seconds} s · ${width} × ${height} · ${pace}`;
}

/** A video of the model being built, brick by brick, made in the browser. */
export function TimelapseDialog() {
  const isOpen = useEditor((s) => s.dialog === 'timelapse');
  const close = useEditor((s) => s.closeDialog);
  const brickCount = useEditor((s) => s.history.present.bricks.size);
  const [options, setOptions] = useState<TimelapseOptions>(DEFAULT_TIMELAPSE_OPTIONS);
  const [progress, setProgress] = useState<TimelapseProgress | null>(null);
  const running = useRef<AbortController | null>(null);
  const busy = progress !== null;
  const update = (patch: Partial<TimelapseOptions>) => setOptions((current) => ({ ...current, ...patch }));

  const handleClose = () => {
    running.current?.abort();
    close('timelapse');
  };

  const handleMake = async () => {
    const state = editorStore.getState();
    const controller = new AbortController();
    running.current = controller;
    setProgress({ done: 0, total: 1, message: 'Getting ready…' });
    try {
      // let "Getting ready…" paint before the heavy work starts
      await nextTask();
      const source = {
        name: state.name,
        bricks: bricksOf(state.history.present),
        settings: state.settings,
        direction: getEngine()?.viewDirection() ?? DEFAULT_VIEW_DIRECTION,
      };
      const video = await createTimelapse(source, options, getPart, setProgress, controller.signal, partLibrary.meshes);
      downloadBlob(video.blob, `${slugify(state.name)}-timelapse.${video.extension}`);
      state.toast('Time-lapse video saved to your downloads.', 'success');
      close('timelapse');
    } catch (error: unknown) {
      if (isAbortError(error)) state.toast('Stopped making the video.');
      else state.toast(`Could not make the video: ${error instanceof Error ? error.message : 'unknown error'}`, 'error');
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
          // the second click of a double-click on Make video lands here; don't let it stop the run
          if (event.detail > 1) return;
          running.current?.abort();
        }}
      >
        Stop
      </button>
    </>
  ) : (
    <>
      <span data-testid="timelapse-summary">{brickCount > 0 ? summaryOf(options, brickCount) : ''}</span>
      <button key="make" type="button" className="btn btn-primary" onClick={() => void handleMake()} disabled={brickCount === 0}>
        <Icon name="image" size={16} /> Make video
      </button>
    </>
  );

  return (
    <Dialog id="timelapse" title="Time-lapse video" open={isOpen} onClose={handleClose} footer={footer}>
      {brickCount === 0 ? (
        <p className="lede">Place some bricks first, then come back here to film them going together.</p>
      ) : (
        <div className="instructions-form" aria-busy={busy}>
          <p className="lede">
            A video of your model being built: each brick drops into place while the camera circles, and the finished model shows at the end. It is
            made in your browser and saved to your downloads.
          </p>
          <fieldset className="field-group" disabled={busy}>
            <Choice legend="Order" choices={ORDERS} value={options.order} onChange={(order) => update({ order })} />
            <Choice legend="Length" choices={LENGTHS} value={options.seconds} onChange={(seconds) => update({ seconds })} />
            <Choice legend="Shape" choices={SHAPES} value={options.shape} onChange={(shape) => update({ shape })} />
            <Choice legend="Size" choices={SIZES} value={options.size} onChange={(size) => update({ size })} />
            <label className="check">
              <input type="checkbox" checked={options.turn} onChange={(event) => update({ turn: event.target.checked })} />
              Circle the model while it builds
            </label>
            <label className="check">
              <input type="checkbox" checked={options.counter} onChange={(event) => update({ counter: event.target.checked })} />
              Count the bricks in a corner
            </label>
          </fieldset>
          <p className="note">
            <Icon name="rotate" size={16} />
            Filming starts from your current view, so turn the model to show its best side first.
          </p>
        </div>
      )}
    </Dialog>
  );
}
