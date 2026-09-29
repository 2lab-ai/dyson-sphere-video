import { hexToLinear } from './util';

// Neon synth-pop: a violet-black void, a star's gold, and two hot neons that trade places on the beat.
export const HEX = {
  ink: '#07020F', // void (violet black)
  ink2: '#140A26', // raised void
  bone: '#FFF4F8', // plasma white, primary text
  pink: '#FF2BD6', // hot magenta
  cyan: '#19F0FF', // electric cyan
  gold: '#FFC53D', // solar gold: the star
  ember: '#FF6A1F', // hotter orange for cores
  violet: '#8A3CFF', // deep neon violet
  lime: '#C6FF3C', // acid accent, used sparingly on drops
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The neon accent cycle, advanced once per bar. */
export const NEONS: PaletteKey[] = ['pink', 'cyan', 'gold', 'violet', 'lime'];
