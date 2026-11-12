/**
 * Brick colour palette. Ids are LDraw colour codes so models export to LDraw
 * without a lookup table; display values follow the LDraw LDConfig palette.
 */
export type ColorFinish = 'solid' | 'transparent' | 'pearl' | 'chrome';

export interface BrickColor {
  readonly id: number;
  readonly name: string;
  readonly hex: string;
  readonly finish: ColorFinish;
}

export interface ColorGroup {
  readonly id: 'solid' | 'transparent' | 'metallic';
  readonly title: string;
  readonly colors: readonly BrickColor[];
}

const solid = (id: number, name: string, hex: string): BrickColor => ({ id, name, hex, finish: 'solid' });
const trans = (id: number, name: string, hex: string): BrickColor => ({ id, name, hex, finish: 'transparent' });
const pearl = (id: number, name: string, hex: string): BrickColor => ({ id, name, hex, finish: 'pearl' });
const chrome = (id: number, name: string, hex: string): BrickColor => ({ id, name, hex, finish: 'chrome' });

const SOLIDS: readonly BrickColor[] = [
  solid(15, 'White', '#F4F4F4'),
  solid(151, 'Very Light Bluish Grey', '#C8C8C8'),
  solid(71, 'Light Bluish Grey', '#A0A5A9'),
  solid(72, 'Dark Bluish Grey', '#6C6E68'),
  solid(0, 'Black', '#1B2A34'),
  solid(320, 'Dark Red', '#720012'),
  solid(4, 'Red', '#B40000'),
  solid(353, 'Coral', '#FF6D77'),
  solid(484, 'Dark Orange', '#91501C'),
  solid(25, 'Orange', '#D67923'),
  solid(191, 'Bright Light Orange', '#FCAC00'),
  solid(14, 'Yellow', '#FAC80A'),
  solid(226, 'Bright Light Yellow', '#FFEC6C'),
  solid(27, 'Lime', '#A5CA18'),
  solid(10, 'Bright Green', '#58AB41'),
  solid(2, 'Green', '#00852B'),
  solid(288, 'Dark Green', '#00451A'),
  solid(330, 'Olive Green', '#77774E'),
  solid(378, 'Sand Green', '#708E7C'),
  solid(3, 'Dark Turquoise', '#069D9F'),
  solid(322, 'Medium Azure', '#68C3E2'),
  solid(321, 'Dark Azure', '#469BC3'),
  solid(73, 'Medium Blue', '#7396C8'),
  solid(1, 'Blue', '#1E5AA8'),
  solid(272, 'Dark Blue', '#19325A'),
  solid(379, 'Sand Blue', '#70819A'),
  solid(31, 'Lavender', '#CDA4DE'),
  solid(30, 'Medium Lavender', '#A06EB9'),
  solid(26, 'Magenta', '#901F76'),
  solid(5, 'Dark Pink', '#D3359D'),
  solid(29, 'Bright Pink', '#FF9ECD'),
  solid(78, 'Light Nougat', '#FFC995'),
  solid(92, 'Nougat', '#BB805A'),
  solid(84, 'Medium Nougat', '#AA7D55'),
  solid(19, 'Tan', '#D7BA8C'),
  solid(28, 'Dark Tan', '#897D62'),
  solid(70, 'Reddish Brown', '#5F3109'),
  solid(308, 'Dark Brown', '#352100'),
];

const TRANSPARENTS: readonly BrickColor[] = [
  trans(47, 'Trans Clear', '#FCFCFC'),
  trans(36, 'Trans Red', '#C91A09'),
  trans(57, 'Trans Orange', '#F08F1C'),
  trans(46, 'Trans Yellow', '#F5CD2F'),
  trans(35, 'Trans Bright Green', '#56E646'),
  trans(34, 'Trans Green', '#237841'),
  trans(43, 'Trans Light Blue', '#AEE9EF'),
  trans(33, 'Trans Dark Blue', '#0020A0'),
  trans(37, 'Trans Dark Pink', '#DF6695'),
  trans(52, 'Trans Purple', '#A5A5CB'),
  trans(40, 'Trans Brown', '#635F52'),
];

const METALLICS: readonly BrickColor[] = [
  pearl(297, 'Pearl Gold', '#AA7F2E'),
  pearl(315, 'Flat Silver', '#8C8C8C'),
  pearl(148, 'Pearl Dark Grey', '#484D48'),
  chrome(383, 'Chrome Silver', '#CECECE'),
  chrome(334, 'Chrome Gold', '#DFC176'),
];

export const COLOR_GROUPS: readonly ColorGroup[] = [
  { id: 'solid', title: 'Solid', colors: SOLIDS },
  { id: 'transparent', title: 'Transparent', colors: TRANSPARENTS },
  { id: 'metallic', title: 'Metallic', colors: METALLICS },
];

export const COLORS: readonly BrickColor[] = [...SOLIDS, ...TRANSPARENTS, ...METALLICS];

export const DEFAULT_COLOR_ID = 4;

const BY_ID: ReadonlyMap<number, BrickColor> = new Map(COLORS.map((c) => [c.id, c]));

export function getColor(id: number): BrickColor | undefined {
  return BY_ID.get(id);
}

/** Unknown codes count as opaque so they never reveal hidden geometry. */
export function isOpaqueColor(id: number): boolean {
  return BY_ID.get(id)?.finish !== 'transparent';
}
