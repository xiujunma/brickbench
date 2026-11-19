import { desktopApi } from '../../desktop/protocol';
import { useEditor } from '../../state/editorStore';
import { partLibrary } from '../../state/library';
import { Dialog } from '../components/Dialog';

const LDRAW_LIBRARY = 'https://library.ldraw.org';
const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';
const IN_DESKTOP_APP = desktopApi() !== null;
const KEPT_WHERE = IN_DESKTOP_APP ? 'on this computer' : 'in this browser’s storage';
const KEEPING = IN_DESKTOP_APP
  ? 'Save the models you want to keep as files (File › Save).'
  : 'Clearing this site’s data in your browser deletes what is kept here, so save the models you want to keep as files (File › Save).';

/** About BrickBench: what it keeps and where, who made the parts, and whose trademarks are whose. */
export function AboutDialog() {
  const isOpen = useEditor((s) => s.dialog === 'about');
  const close = useEditor((s) => s.closeDialog);
  return (
    <Dialog id="about" title="About BrickBench" open={isOpen} onClose={() => close('about')}>
      <div className="about">
        <p className="about-lead">A workshop for building with bricks, in your browser or as a desktop app. Free software under the MIT licence.</p>
        <section aria-labelledby="about-privacy">
          <h3 id="about-privacy">Your models stay with you</h3>
          <ul>
            <li>There are no accounts. Your models, your favourite and recent parts, and the parts lists you add are kept {KEPT_WHERE}, not on a server.</li>
            <li>BrickBench downloads only its own files, such as the LDraw parts you use, from wherever it is hosted. There is no tracking and there are no adverts.</li>
            <li>If you connect an AI agent, what you ask it and the model it works on go to that agent: with Claude Code, to Anthropic, under your own account.</li>
            <li>{KEEPING}</li>
          </ul>
        </section>
        <section aria-labelledby="about-credits">
          <h3 id="about-credits">Credits</h3>
          <p>
            Parts from the{' '}
            <a href={LDRAW_LIBRARY} target="_blank" rel="noopener noreferrer">
              LDraw™ Parts Library
            </a>{' '}
            by its contributors, under{' '}
            <a href={CC_BY_4} target="_blank" rel="noopener noreferrer">
              CC BY 4.0
            </a>{' '}
            (older parts CC BY 2.0).{' '}
            <a href={`${partLibrary.baseUrl}CREDITS.txt`} target="_blank" rel="noopener noreferrer">
              Everyone who made them
            </a>
            .
          </p>
        </section>
        <section aria-labelledby="about-trademarks">
          <h3 id="about-trademarks">Trademarks</h3>
          <p>LEGO® is a trademark of the LEGO Group, which does not sponsor, authorise or endorse BrickBench.</p>
          <p>LDraw™ is a trademark of the Estate of James Jessiman.</p>
        </section>
      </div>
    </Dialog>
  );
}
