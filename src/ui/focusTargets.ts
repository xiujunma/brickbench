/** Places other parts of the app move the keyboard to, by id. */
export const PART_SEARCH_ID = 'part-search';
export const BUILD_AREA_ID = 'build-area';
export const AGENT_TOGGLE_ID = 'agent-toggle';

/** Hands the keyboard to the build area: editor keys work at once and Tab carries on from there. */
export function focusBuildArea(): boolean {
  const area = document.getElementById(BUILD_AREA_ID);
  area?.focus({ preventScroll: true });
  return area !== null;
}
