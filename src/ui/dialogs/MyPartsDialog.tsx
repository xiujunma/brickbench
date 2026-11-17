import { useEffect } from 'react';
import { getColor } from '../../core/colors';
import { matchColour, type UnmatchedLot } from '../../core/inventory/match';
import type { Catalogue } from '../../core/inventory/read';
import type { OwnedList } from '../../core/inventory/stock';
import { useEditor } from '../../state/editorStore';
import { inventory, listSize, MAX_COPIES, MAX_NAME, useInventory } from '../../state/inventory';
import { partLibrary } from '../../state/library';
import { addPartsList } from '../../state/partsListCommands';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';

const CATALOGUES: Readonly<Record<Catalogue, string>> = { rebrickable: 'Rebrickable', bricklink: 'BrickLink' };

function colourText(lot: UnmatchedLot, catalogue: Catalogue): string {
  const code = matchColour(lot.colour, catalogue);
  return (code === null ? undefined : getColor(code)?.name) ?? `${CATALOGUES[catalogue]} colour ${lot.colour}`;
}

/** The parts of a list BrickBench cannot build with, folded away until asked for; copies counted, as everywhere. */
function Unmatched({ list }: { readonly list: OwnedList }) {
  const unusable = listSize(list).unusable * list.copies;
  if (unusable === 0) return null;
  return (
    <details className="owned-unmatched">
      <summary>
        {unusable.toLocaleString('en')} {unusable === 1 ? 'part is' : 'parts are'} not in BrickBench yet
      </summary>
      <table className="parts-table">
        <thead>
          <tr>
            <th className="num">Qty</th>
            <th>{CATALOGUES[list.catalogue]} part</th>
            <th>Colour</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {list.unmatched.map((lot) => (
            <tr key={`${lot.part}|${lot.colour}|${lot.reason}`}>
              <td className="num">{lot.quantity * list.copies}</td>
              <td className="code">{lot.part}</td>
              <td>{colourText(lot, list.catalogue)}</td>
              <td>{lot.reason === 'part' ? 'Not in the parts library' : 'Not a BrickBench colour'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function ListRow({ list }: { readonly list: OwnedList }) {
  const { usable } = listSize(list);
  const remove = (): void => {
    if (window.confirm(`Remove “${list.name}” from your parts?`)) inventory.removeList(list.id);
  };
  return (
    <li className="owned-list">
      <div className="owned-list-head">
        <input
          // a new key when the name changes elsewhere, so the box shows it
          key={list.name}
          className="owned-name"
          aria-label="Name"
          defaultValue={list.name}
          maxLength={MAX_NAME}
          onBlur={(event) => {
            if (event.currentTarget.value !== list.name) inventory.renameList(list.id, event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <div className="stepper" role="group" aria-label={`Copies of ${list.name}`}>
          <button type="button" className="icon-btn" aria-label="One copy fewer" disabled={list.copies <= 1} onClick={() => inventory.setCopies(list.id, list.copies - 1)}>
            <Icon name="minus" size={14} />
          </button>
          <output aria-live="polite">×{list.copies}</output>
          <button type="button" className="icon-btn" aria-label="One copy more" disabled={list.copies >= MAX_COPIES} onClick={() => inventory.setCopies(list.id, list.copies + 1)}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label={`Remove ${list.name}`} title="Remove" onClick={remove}>
          <Icon name="trash" size={16} />
        </button>
      </div>
      <p className="owned-list-meta">
        {(usable * list.copies).toLocaleString('en')} parts to build with · from {CATALOGUES[list.catalogue]}
      </p>
      <Unmatched list={list} />
    </li>
  );
}

/** The parts lists of the sets the user owns: add, count copies, rename and remove them. */
export function MyPartsDialog() {
  const isOpen = useEditor((s) => s.dialog === 'my-parts');
  const close = useEditor((s) => s.closeDialog);
  const lists = useInventory((s) => s.lists);
  const hasLists = lists.length > 0;
  // the library matches parts left out while it could not load
  useEffect(() => {
    if (isOpen && hasLists) partLibrary.request();
  }, [isOpen, hasLists]);
  const total = lists.reduce((sum, list) => sum + listSize(list).usable * list.copies, 0);

  const footer = (
    <>
      <span>{lists.length === 0 ? 'No parts lists yet' : `${total.toLocaleString('en')} parts in ${lists.length} ${lists.length === 1 ? 'list' : 'lists'}`}</span>
      <button type="button" className="btn btn-primary" onClick={() => void addPartsList()}>
        <Icon name="plus" size={16} /> Add a parts list…
      </button>
    </>
  );

  return (
    <Dialog id="my-parts" title="Your parts" open={isOpen} onClose={() => close('my-parts')} footer={footer}>
      <p className="lede">
        Add the parts lists of the sets you own, and BrickBench counts how many of each part you have left as you build: under “Mine” in the parts panel, on part
        tiles and in the parts list. Your lists stay in this browser.
      </p>
      <p className="owned-how">
        On Rebrickable, open a set’s inventory and choose Export Parts, as Rebrickable CSV or BrickLink XML. On BrickLink, download a set’s inventory as XML.
        BrickStore files work too.
      </p>
      {lists.length > 0 && (
        <ul className="owned-lists" aria-label="Your parts lists">
          {lists.map((list) => (
            <ListRow key={list.id} list={list} />
          ))}
        </ul>
      )}
    </Dialog>
  );
}
