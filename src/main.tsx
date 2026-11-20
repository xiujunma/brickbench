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
import './app/styles/agent.css';
import './app/styles/online.css';
import { agentStorage, startAgent } from './agent/connection';
import { agentLink } from './app/agent';
import { App } from './app/App';
import { startDesktop } from './app/desktop';
import { editorStore, restoreLastSession } from './state/editorStore';
import { startInventoryMatching } from './state/inventory';
import { partLibrary } from './state/library';
import { retryWhenOnline, watchLibraryFailures } from './state/libraryNotices';
import { startPartPicks } from './state/partPicks';
import { startOnline } from './state/online';
import { followOpenModel, restoreOnlineCopy } from './state/onlineCopy';
import { startAutosave } from './state/persistence';
import { startShareLinks } from './state/shareLinks';

const root = document.getElementById('root');
if (!root) throw new Error('BrickBench needs a #root element to mount into.');
const container = root;

async function boot(): Promise<void> {
  // opening another model lets go of the open one's copy online
  followOpenModel(editorStore);
  // the last model may need the parts library, so restore it before anything can autosave over it
  let restored = false;
  try {
    restored = (await restoreLastSession()) === 'whole';
  } catch {
    editorStore.getState().toast('Your last session could not be restored, so a fresh model was started.', 'error');
  }
  // which model online it is, if it came back whole, so saving it online again saves over that one
  restoreOnlineCopy(restored);
  startAutosave(editorStore);
  watchLibraryFailures(editorStore);
  retryWhenOnline();
  startPartPicks(editorStore);
  startInventoryMatching(partLibrary.store);
  startAgent({ link: agentLink, storage: agentStorage(), target: window });
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // in the desktop app: its menu, and files opened from the desktop (those waiting come now)
  startDesktop();
  // a model in a share link opens once the editor is up, over the session just restored if the user agrees
  startShareLinks(window);
  // who is signed in, how a sign-in went, and a gallery link the page was opened with
  void startOnline(window);
}

void boot();
