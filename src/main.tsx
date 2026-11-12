import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './app/styles/tokens.css';
import './app/styles/base.css';
import './app/styles/layout.css';
import './app/styles/chrome.css';
import './app/styles/panels.css';
import './app/styles/stage.css';
import './app/styles/dialogs.css';
import { App } from './app/App';
import { editorStore, restoreLastSession } from './state/editorStore';
import { retryWhenOnline, watchLibraryFailures } from './state/libraryNotices';
import { startPartPicks } from './state/partPicks';
import { startAutosave } from './state/persistence';

const root = document.getElementById('root');
if (!root) throw new Error('BrickBench needs a #root element to mount into.');
const container = root;

async function boot(): Promise<void> {
  // the last model may need the parts library, so restore it before anything can autosave over it
  try {
    await restoreLastSession();
  } catch {
    editorStore.getState().toast('Your last session could not be restored, so a fresh model was started.', 'error');
  }
  startAutosave(editorStore);
  watchLibraryFailures(editorStore);
  retryWhenOnline();
  startPartPicks(editorStore);
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
