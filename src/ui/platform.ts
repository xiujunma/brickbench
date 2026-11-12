import type { CSSProperties } from 'react';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** Formats a shortcut with the platform's command key, e.g. ⌘S or Ctrl+S. */
export function shortcut(key: string, shift = false): string {
  if (IS_MAC) return `${shift ? '⇧' : ''}⌘${key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** Inline style object carrying CSS custom properties. */
export function cssVars(vars: Readonly<Record<`--${string}`, string>>): CSSProperties {
  return vars as CSSProperties;
}

/** #RRGGBB → rgba() with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
