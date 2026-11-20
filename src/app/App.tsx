import { useState } from 'react';
import { Toasts } from '../ui/components/Toasts';
import { AboutDialog } from '../ui/dialogs/AboutDialog';
import { AccountDialog } from '../ui/dialogs/AccountDialog';
import { GalleryDialog } from '../ui/dialogs/GalleryDialog';
import { OnlineModelsDialog } from '../ui/dialogs/OnlineModelsDialog';
import { HelpDialog } from '../ui/dialogs/HelpDialog';
import { PhotoDialog } from '../ui/dialogs/PhotoDialog';
import { ImportReportDialog } from '../ui/dialogs/ImportReportDialog';
import { InstructionsDialog } from '../ui/dialogs/InstructionsDialog';
import { MyPartsDialog } from '../ui/dialogs/MyPartsDialog';
import { PartsListDialog } from '../ui/dialogs/PartsListDialog';
import { TimelapseDialog } from '../ui/dialogs/TimelapseDialog';
import { AgentPanel } from '../ui/panels/agent/AgentPanel';
import { InspectorPanel } from '../ui/panels/InspectorPanel';
import { StepsPanel } from '../ui/panels/StepsPanel';
import { useEditor } from '../state/editorStore';
import { PartsPanel } from '../ui/panels/PartsPanel';
import { Stage } from '../ui/panels/Stage';
import { StatusBar } from '../ui/panels/StatusBar';
import { TopBar, type Drawer } from '../ui/panels/TopBar';
import { AGENT_TOGGLE_ID } from '../ui/focusTargets';
import { useAppShortcuts } from '../ui/useAppShortcuts';
import { useFileDrop } from '../ui/useFileDrop';

export function App() {
  const [drawer, setDrawer] = useState<Drawer>(null);
  // the agent chat takes the inspector's place while it is open
  const [agentOpen, setAgentOpen] = useState(false);
  const stepsOpen = useEditor((s) => s.stepEditor !== null);
  useAppShortcuts();
  useFileDrop();

  return (
    <div className="app" data-drawer={drawer ?? undefined} data-agent={agentOpen ? 'open' : undefined}>
      <TopBar
        drawer={drawer}
        onToggleDrawer={(next) => setDrawer((current) => (current === next ? null : next))}
        agentOpen={agentOpen}
        onToggleAgent={() => setAgentOpen((open) => !open)}
      />
      <div className="workspace">
        <PartsPanel onPicked={() => setDrawer((current) => (current === 'parts' ? null : current))} />
        <Stage />
        {stepsOpen ? (
          <StepsPanel />
        ) : agentOpen ? (
          <AgentPanel
            onClose={() => {
              setAgentOpen(false);
              // the panel and its focused button are gone: back to the button that opened it
              requestAnimationFrame(() => document.getElementById(AGENT_TOGGLE_ID)?.focus());
            }}
          />
        ) : (
          <InspectorPanel />
        )}
      </div>
      <StatusBar />
      <Toasts />
      <HelpDialog />
      <AboutDialog />
      <PhotoDialog />
      <PartsListDialog />
      <InstructionsDialog />
      <MyPartsDialog />
      <TimelapseDialog />
      <ImportReportDialog />
      <AccountDialog />
      <OnlineModelsDialog />
      <GalleryDialog />
    </div>
  );
}
