import { hexToLinear } from './util';

// The only colours in the video (docs/EDIT-SPEC.md §Look, docs/PLAN-V3.md). Scenes use tokens — never colour literals.
//
// v3: one NAMED PALETTE per idiom (PALETTES below). A plate's palette is data/edit.json `look.palette`; a scene reads
//   const P = palette(this.ctx.params.look.palette)      P.ground / P.deep / P.mid / P.hi / P.text / P.signal (hex)
//   pcss(P, 'hi', 0.8)   Canvas2D colour string          plin(P, 'ground')   linear RGB for GL uniforms
// Roles: ground = the dominant background (what look.ground describes; the edit gate checks its luminance),
// deep = second plane / shadow, mid = the main subject, hi = highlight / emission, text = default lyric colour,
// signal = the shared warm accent (stellar orange, identical in every palette: the one colour thread).
// Hex values come from the idiom research (scratchpad idiom-research.md); deviations are marked "was ...".
//
// v2 tokens (kept for backward compatibility — v2 modules still use them):
//   Canvas2D: rgba('signal', 0.8)     GLSL: C_SIGNAL (linear, from glsl/common.ts)     uniforms: LIN.signal
// `accent` (cyan) is reserved for the plates whose params set accent: true (≤ 2 in the whole edit); the gate
// rejects any other scene that references it.
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
  return hexCss(HEX[key], a);
}

// ------------------------------------------------------------------ v3 named palettes
export type Role = 'ground' | 'deep' | 'mid' | 'hi' | 'text' | 'signal';
export type NamedPalette = Readonly<Record<Role, string>>;

const S = HEX.signal;
/** One palette per idiom. Keys are the `look.palette` names in data/edit.json. */
export const PALETTES = {
  // legacy black / bone / orange (B/C/O): light-trace, void (≤ 8 plates, gate-checked via look.bco)
  bco: { ground: HEX.ink, deep: HEX.ink2, mid: HEX.graphite, hi: HEX.bone, text: HEX.bone, signal: S },
  // S2 X-ray radiograph
  xray: { ground: '#02060A', deep: '#15222E', mid: '#6F8FA6', hi: '#DDEFFF', text: '#DDEFFF', signal: S },
  // E2 CRT video wall (Paik)
  crt: { ground: '#050505', deep: '#2BD46B', mid: '#3A6BFF', hi: '#E8E2D0', text: '#E8E2D0', signal: S },
  // P6 risograph — stock was #F7F1E3 (cream); white stock keeps cream grounds to the pop-up book
  riso: { ground: '#F4F6F7', deep: '#0078BF', mid: '#FF48B0', hi: '#FFE800', text: '#0078BF', signal: S },
  // M3 ink-in-water ocean (trinity override for #5)
  ocean: { ground: '#021C1E', deep: '#0C3A3A', mid: '#2C7873', hi: '#FFB400', text: '#FFB400', signal: S },
  // neon over brick (not in the research; derived: dark brick + tube core, accent cyan only behind params.accent)
  neon: { ground: '#1A0F0D', deep: '#3A1D16', mid: '#6B3326', hi: '#FFD2B0', text: '#FFD2B0', signal: S },
  // P1 Saul Bass cut paper on the mustard ground (trinity override for #7)
  bass: { ground: '#F2C14E', deep: '#1B1B1B', mid: '#E8452C', hi: '#2E5E8C', text: '#1B1B1B', signal: S },
  // M4 long-exposure light painting
  lightpaint: { ground: '#030303', deep: '#1A0A04', mid: '#FF4E1A', hi: '#FFB347', text: '#FFFFFF', signal: S },
  // E3 LED wall
  led: { ground: '#080404', deep: '#2A0A06', mid: '#FF3B1F', hi: '#FFB23F', text: '#FFF1D0', signal: S },
  // S3 LiDAR (white returns, near orange -> far blue)
  lidar: { ground: '#000000', deep: '#1E3A5F', mid: '#6F8FA6', hi: '#FFFFFF', text: '#FFFFFF', signal: S },
  // aperture on bright, overexposed film stock (trinity override for #11; not in the research: warm blown highlights)
  film: { ground: '#F9D9A0', deep: '#2F4A4A', mid: '#C77D3A', hi: '#FFF6E6', text: '#2F4A4A', signal: S },
  // E1 oscilloscope XY, P31 green
  scope: { ground: '#010403', deep: '#0B2A18', mid: '#39FF88', hi: '#B6FFD6', text: '#B6FFD6', signal: S },
  // M3 fluid cosmos, gold/white (#13)
  'cosmos-gold': { ground: '#02040A', deep: '#C23B22', mid: '#E3B23C', hi: '#F7F3E9', text: '#F7F3E9', signal: S },
  // A3 Powers of Ten (research: inherits neighbours; derived cool web, no purple/cyan)
  web: { ground: '#03050C', deep: '#0E1A33', mid: '#4E6FA8', hi: '#DCE6FF', text: '#DCE6FF', signal: S },
  // S5 SDO/AIA 304
  sdo: { ground: '#000000', deep: '#7A0E00', mid: '#FF4A1C', hi: '#FFD0A0', text: '#FFD0A0', signal: S },
  // M2 claymation — backdrop was #F2D7B6 (tan, close to cream); peach backdrop
  clay: { ground: '#F0C8A0', deep: '#29335C', mid: '#E4572E', hi: '#F3A712', text: '#29335C', signal: S },
  // H2 ink wash — hanji was #EDE7DA (cream); a cool grey hanji
  sumuk: { ground: '#E4E4DF', deep: '#1A1A1A', mid: '#6B6B6B', hi: '#B22222', text: '#1A1A1A', signal: S },
  // pop-up natural-history book (one of the ≤ 3 cream grounds)
  'popup-life': { ground: '#EFE6D2', deep: '#1F3B4D', mid: '#5B8C5A', hi: '#C0392B', text: '#1B1B1B', signal: S },
  // pop-up city (v2 look: bone paper, ink; one of the ≤ 3 cream grounds)
  'popup-city': { ground: HEX.bone, deep: HEX.ink, mid: HEX.graphite, hi: HEX.paper2, text: HEX.ink, signal: S },
  // E6 ASCII raster, amber variant (the green variant is taken by the scope, #12)
  ascii: { ground: '#0B0700', deep: '#3A2600', mid: '#FFB000', hi: '#FFE2A0', text: '#FFB000', signal: S },
  // engraving reversed out of Prussian blue (H4 Hokusai variant)
  engrave: { ground: '#1D3557', deep: '#10203A', mid: '#A8DADC', hi: '#F1FAEE', text: '#F1FAEE', signal: S },
  // the machine eye: M1 studio palette in high key (chrome iris on a white cyc)
  'chrome-eye': { ground: '#D7DCE2', deep: '#1D2B3A', mid: '#8A949E', hi: '#FFFFFF', text: '#0A0A0C', signal: S },
  // S6 Black Marble night lights
  blackmarble: { ground: '#01030A', deep: '#0B1A3A', mid: '#3E7BD6', hi: '#FFE3A3', text: '#FFE3A3', signal: S },
  // E4 flip-disc
  flipdisc: { ground: '#111111', deep: '#2A2A2A', mid: '#C9CCD1', hi: '#F5D300', text: '#F5D300', signal: S },
  // H1 Ahn Sang-soo — stock was #F4EFE6 (cream); white stock
  ahn: { ground: '#F3F3F1', deep: '#111111', mid: '#2D5DA8', hi: '#E6332A', text: '#111111', signal: S },
  // 3D-lit steel cage (derived)
  steel: { ground: '#07080B', deep: '#1C2129', mid: '#5A6572', hi: '#DCE3EA', text: '#DCE3EA', signal: S },
  // A2 Ganzfeld, dawn
  dawn: { ground: '#FFD1A9', deep: '#FF8A5B', mid: '#F26B3A', hi: '#FFF1E4', text: '#B8502A', signal: S },
  // S7 pulsar ridgeline
  ridge: { ground: '#000000', deep: '#1A1A1A', mid: '#8C8C8C', hi: '#F2F2F2', text: '#F2F2F2', signal: S },
  // A1 sodium mono sun (the hall's haze is the ground)
  sodium: { ground: '#FFB000', deep: '#6B3F00', mid: '#0A0703', hi: '#FFE7A3', text: '#6B3F00', signal: S },
  // cave ochre (new H idiom, not in the research; derived: rock, ochre, red ochre, firelight)
  cave: { ground: '#1E130D', deep: '#3A2417', mid: '#B5542B', hi: '#FFB45A', text: '#D9A066', signal: S },
  // clay tablet under raking light (lit matter, derived)
  tablet: { ground: '#8A5A3A', deep: '#4A2E1C', mid: '#B97A4F', hi: '#F0C79A', text: '#3A2415', signal: S },
  // H5 stained glass
  glass: { ground: '#0B0B0B', deep: '#1B4F9C', mid: '#B3122E', hi: '#E0A526', text: '#2F8F46', signal: S },
  // S1 thermal ironbow
  thermal: { ground: '#000010', deep: '#5A0A8C', mid: '#E0431B', hi: '#FFD23A', text: '#FFFFF0', signal: S },
  // P8 1-bit dither — paper was #E6E0C8 (cream); 1-bit white
  dither: { ground: '#EDEDEA', deep: '#0B0B0F', mid: '#0B0B0F', hi: '#FFFFFF', text: '#0B0B0F', signal: S },
  // demoscene boot: ENIAC room dark, C64 screen blue as the second plane (derived from the C64 palette)
  'demo-boot': { ground: '#0B0B0F', deep: '#3E31A2', mid: '#7C70DA', hi: '#FFB000', text: '#7C70DA', signal: S },
  // demoscene internet: copper bars on black (v2 demo colours)
  'demo-net': { ground: '#050308', deep: '#3A1406', mid: '#C8641E', hi: '#FFE7C2', text: '#FFE7C2', signal: S },
  // demoscene AI: E5 Ikeda data flood, white field
  'demo-ai': { ground: '#F2F2F2', deep: '#000000', mid: '#7F7F7F', hi: '#FFFFFF', text: '#000000', signal: S },
  // 3D-lit swarm around the Sun (derived)
  swarm: { ground: '#020203', deep: '#2A1204', mid: '#8C95A0', hi: '#FFE2B0', text: '#FFE2B0', signal: S },
  // H3 dancheong, the sunlit vault (white is the dominant ground) — white was #F7F7F2 (reads as cream by isCream)
  dancheong: { ground: '#F4F5F5', deep: '#1E6B52', mid: '#C0392B', hi: '#F2C94C', text: '#1B1B1B', signal: S },
  // 3D-lit pull-back into dark stars (derived)
  pullback: { ground: '#010104', deep: '#0B0D14', mid: '#4A5160', hi: '#E8ECF2', text: '#E8ECF2', signal: S },
  // P5 constructivist — red field (stock #EDE6D6 is cream: kept only as a shape colour)
  constructivist: { ground: '#C8102E', deep: '#0D0D0D', mid: '#EDE6D6', hi: '#FFFFFF', text: '#0D0D0D', signal: S },
} as const satisfies Record<string, NamedPalette>;

export type PaletteName = keyof typeof PALETTES;

/** The named palette (throws on an unknown name: a plate must declare a real palette). */
export function palette(name: string): NamedPalette {
  const p = (PALETTES as Record<string, NamedPalette>)[name];
  if (!p) throw new Error(`unknown palette: ${name}`);
  return p;
}

/** CSS rgba() for Canvas2D from a named-palette role. */
export function pcss(p: NamedPalette, role: Role, a = 1): string {
  return hexCss(p[role], a);
}

/** Linear RGB of a named-palette role (GL uniforms). */
export function plin(p: NamedPalette, role: Role): [number, number, number] {
  return hexToLinear(p[role]);
}

/** CSS rgba() between two roles (t = 0..1), for gradients and ramps. */
export function pmix(p: NamedPalette, a: Role, b: Role, t: number, alpha = 1): string {
  const x = rgb8(p[a]), y = rgb8(p[b]);
  const k = Math.min(1, Math.max(0, t));
  return `rgba(${Math.round(x[0] + (y[0] - x[0]) * k)},${Math.round(x[1] + (y[1] - x[1]) * k)},${Math.round(x[2] + (y[2] - x[2]) * k)},${alpha})`;
}

// ------------------------------------------------------------------ pure colour maths (also used by the edit gate)
function rgb8(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexCss(hex: string, a: number): string {
  const [r, g, b] = rgb8(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Relative luminance Y (0..1, Rec. 709 weights on linear RGB). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HSL of a hex colour: h in degrees, s and l in 0..1. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb8(hex).map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/**
 * Luminance class of a ground (the gate checks look.ground against the palette's ground hex):
 * dark Y <= 0.06, light Y >= 0.35, mid in between.
 */
export function groundClass(hex: string): 'dark' | 'mid' | 'light' {
  const y = luminance(hex);
  return y <= 0.06 ? 'dark' : y >= 0.35 ? 'light' : 'mid';
}

/** Cream: a pale, warm, low-saturation paper (hue 25–65°, HSL s 0.15–0.6, l >= 0.82). */
export function isCream(hex: string): boolean {
  const { h, s, l } = hsl(hex);
  return h >= 25 && h <= 65 && s >= 0.15 && s <= 0.6 && l >= 0.82;
}
