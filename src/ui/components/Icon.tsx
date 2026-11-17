const PATHS = {
  sparkle: 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9Z M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z',
  send: 'M4.5 12h14 M13 6.5l5.5 5.5-5.5 5.5',
  stop: 'M7 7h10v10H7Z',
  cursor: 'M5.5 3.5 18.5 10l-6.2 1.9-2.7 6.4Z',
  brick: 'M3 10.5h18V19H3Z M6 10.5V8a1.75 1.75 0 0 1 3.5 0v2.5 M14.5 10.5V8a1.75 1.75 0 0 1 3.5 0v2.5',
  drop: 'M12 3.5c3.2 4.1 6 7.2 6 10.6a6 6 0 0 1-12 0c0-3.4 2.8-6.5 6-10.6Z',
  eraser: 'M4 15.5 13 6.5l6.5 6.5-7 7H8Z M9.5 20h10.5 M8.5 11 15 17.5',
  rotate: 'M19.5 12.5a7.5 7.5 0 1 1-2.2-5.8 M19.5 4.5v4.5H15',
  frame: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M12 12h.01',
  home: 'M4 11.5 12 4.5l8 7 M6.5 9.5V20h11V9.5',
  undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6 M12 17h.01',
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z M20 20l-4.3-4.3',
  close: 'M6 6l12 12 M18 6 6 18',
  chevron: 'M6.5 9.5 12 15l5.5-5.5',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  folder: 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z',
  save: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  image: 'M4 5h16v14H4Z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5h.01',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9Z M12 12l8-4.5 M12 12v9 M12 12 4 7.5',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  trash: 'M4 7h16 M9.5 7V4.5h5V7 M6 7l1 13h10l1-13',
  copy: 'M9 9h11v11H9Z M5 15H4V4h11v1',
  layers: 'M12 3.5 21 8.5l-9 5-9-5Z M3 13.5l9 5 9-5',
  book: 'M6 4.5h10.5a1.5 1.5 0 0 1 1.5 1.5v14H8a2 2 0 0 1-2-2Z M6 18a2 2 0 0 1 2-2h10 M9.5 8.5h5',
  grid: 'M4 4h16v16H4Z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16',
  panelLeft: 'M4 5h16v14H4Z M9.5 5v14',
  panelRight: 'M4 5h16v14H4Z M14.5 5v14',
  star: 'M12 3.8l2.5 5.1 5.6.8-4.05 3.95.96 5.6L12 16.6l-5.01 2.65.96-5.6L3.9 9.7l5.6-.8Z',
} as const;

export type IconName = keyof typeof PATHS;

type Props = {
  readonly name: IconName;
  readonly size?: number;
};

export function Icon({ name, size = 20 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The BrickBench mark: a small isometric brick. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 7 28 13 16 19 4 13Z" fill="currentColor" opacity="0.42" />
      <path d="M4 13 16 19v8.5L4 21.5Z" fill="currentColor" opacity="0.78" />
      <path d="M28 13 16 19v8.5l12-6Z" fill="currentColor" />
      <path d="M10 10.6v-2a3 1.5 0 0 0 6 0v2a3 1.5 0 0 1-6 0Z" fill="currentColor" />
      <ellipse cx="13" cy="8.6" rx="3" ry="1.5" fill="currentColor" opacity="0.42" />
      <path d="M16 13.6v-2a3 1.5 0 0 0 6 0v2a3 1.5 0 0 1-6 0Z" fill="currentColor" />
      <ellipse cx="19" cy="11.6" rx="3" ry="1.5" fill="currentColor" opacity="0.42" />
    </svg>
  );
}
