import { useState } from 'react';
import { Toasts } from '../ui/components/Toasts';
import { HelpDialog } from '../ui/dialogs/HelpDialog';
import { InstructionsDialog } from '../ui/dialogs/InstructionsDialog';
import { PartsListDialog } from '../ui/dialogs/PartsListDialog';
import { InspectorPanel } from '../ui/panels/InspectorPanel';
import { PartsPanel } from '../ui/panels/PartsPanel';
import { Stage } from '../ui/panels/Stage';
import { StatusBar } from '../ui/panels/StatusBar';
import { TopBar, type Drawer } from '../ui/panels/TopBar';
import { useAppShortcuts } from '../ui/useAppShortcuts';

export function App() {
  const [drawer, setDrawer] = useState<Drawer>(null);
  useAppShortcuts();

  return (
    <div className="app" data-drawer={drawer ?? undefined}>
      <TopBar drawer={drawer} onToggleDrawer={(next) => setDrawer((current) => (current === next ? null : next))} />
      <div className="workspace">
        <PartsPanel onPicked={() => setDrawer((current) => (current === 'parts' ? null : current))} />
        <Stage />
        <InspectorPanel />
      </div>
      <StatusBar />
      <Toasts />
      <HelpDialog />
      <PartsListDialog />
      <InstructionsDialog />
    </div>
  );
}
