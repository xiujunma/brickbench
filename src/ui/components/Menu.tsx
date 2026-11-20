import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type MenuProps = {
  readonly label: string;
  /** Shown before the label on the button. */
  readonly icon?: IconName;
  /** What the button and menu are called when the label alone would not say. */
  readonly name?: string;
  readonly children: (close: () => void) => ReactNode;
};

/** A dropdown menu built on the popover API: light-dismiss and top-layer stacking for free. */
export function Menu({ label, icon, name, children }: MenuProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger) return;
    const place = (event: Event): void => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const box = trigger.getBoundingClientRect();
      popover.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 248))}px`;
      popover.style.top = `${box.bottom + 6}px`;
    };
    // once open it has a size: one that would run off the bottom, as from a dialog's footer, opens upwards
    const fit = (event: Event): void => {
      if ((event as ToggleEvent).newState !== 'open') return;
      const box = trigger.getBoundingClientRect();
      const height = popover.getBoundingClientRect().height;
      if (box.bottom + 6 + height > window.innerHeight - 8) popover.style.top = `${Math.max(8, box.top - 6 - height)}px`;
    };
    popover.addEventListener('beforetoggle', place);
    popover.addEventListener('toggle', fit);
    return () => {
      popover.removeEventListener('beforetoggle', place);
      popover.removeEventListener('toggle', fit);
    };
  }, []);

  const close = (): void => popoverRef.current?.hidePopover();

  return (
    <>
      <button ref={triggerRef} type="button" className="menu-trigger" popoverTarget={id} aria-haspopup="menu" aria-label={name}>
        {icon && <Icon name={icon} size={16} />}
        <span className="menu-trigger-label">{label}</span>
        <Icon name="chevron" size={14} />
      </button>
      <div ref={popoverRef} id={id} popover="auto" className="menu" role="menu" aria-label={name ?? label}>
        {children(close)}
      </div>
    </>
  );
}

type MenuItemProps = {
  readonly icon: IconName;
  readonly label: string;
  readonly shortcut?: string;
  readonly onSelect: () => void;
};

export function MenuItem({ icon, label, shortcut, onSelect }: MenuItemProps) {
  return (
    <button type="button" role="menuitem" className="menu-item" onClick={onSelect}>
      <Icon name={icon} size={18} />
      {label}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}
