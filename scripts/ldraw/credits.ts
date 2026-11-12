export interface Credit {
  /** Library file, e.g. "3001.dat" or "p/stud.dat". */
  readonly file: string;
  readonly description: string;
  readonly author: string;
}

function rows(credits: readonly Credit[]): string[] {
  return [...credits]
    .sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }))
    .map((c) => `${c.file}\t${c.description}\t${c.author || 'unknown'}`);
}

/**
 * Attribution for the shipped meshes, as CC BY asks: who made each file,
 * where it comes from, under which licence, and that it was modified.
 */
export function creditsText(parts: readonly Credit[], sources: readonly Credit[], generated: string): string {
  return [
    'BrickBench part library: credits',
    '',
    'The meshes in this folder were converted from the LDraw.org Parts Library',
    '(https://library.ldraw.org) and are shared under the same licence: CC BY 4.0',
    '(https://creativecommons.org/licenses/by/4.0/), with older contributions also under',
    'CC BY 2.0 (https://creativecommons.org/licenses/by/2.0/). See CAreadme.txt.',
    '',
    'Modifications: parts and the subparts and primitives they use were flattened into',
    'triangle meshes, moved so they stand centred on the stud grid, and stripped of',
    'edge lines and fixed colours.',
    '',
    'LDraw is a trademark of the Estate of James Jessiman. LEGO is a trademark of the',
    'LEGO Group, which does not sponsor, authorise or endorse this software.',
    '',
    `Generated ${generated}.`,
    '',
    `Parts (${parts.length}): file, description, author`,
    ...rows(parts),
    '',
    `Subparts and primitives used by those parts (${sources.length}): file, description, author`,
    ...rows(sources),
    '',
  ].join('\n');
}
