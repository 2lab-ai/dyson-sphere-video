import { hexToLinear } from './util';

// The only colours in the video (docs/EDIT-SPEC.md §Look). Scenes use these tokens — never colour literals:
//   Canvas2D: rgba('signal', 0.8)     GLSL: C_SIGNAL (linear, from glsl/common.ts)     uniforms: LIN.signal
// Dark plates sit on ink, bright plates on bone paper. `accent` (cyan) is reserved for the plates whose
// params set accent: true (≤ 2 in the whole edit); the gate rejects any other scene that references it.
export const HEX = {
  ink: '#0B0A10', // the void / printing ink
  ink2: '#17151F', // raised ink (panels, second plane)
  bone: '#F3EEE4', // bone paper, primary text on ink
  paper2: '#E4DCCB', // shaded paper (second plane on bright plates)
  graphite: '#6B6560', // pencil / rules / unsung text on paper
  signal: '#FF5A14', // stellar orange: the point of light, the voice
  ember: '#FFA04A', // warm highlight of signal
  accent: '#1FD6FF', // cyan — accent plates only
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D, from a palette token. */
export function rgba(key: PaletteKey, a = 1): string {
  const n = parseInt(HEX[key].slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
