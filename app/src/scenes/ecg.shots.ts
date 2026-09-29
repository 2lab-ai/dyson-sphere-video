// Shot list for the ecg plates (pure: imported by scenes/ecg.ts and by the edit gate).
// State = camera framing (`frame`) + lyric layout (`layout`) + what the trace is (`topo`) + ground (`medium`).
// Every approved storyboard shot (engine/storyboard) is kept at its exact time; the extra cuts sit on beats/downbeats.
import { beatTimes, barTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

type St = Omit<ShotState, 'id'> & { frame: string; layout: string; topo: string; medium: string };

/** Approved storyboard states per variant, in storyboard order (index 0 = the plate start). */
const SB: Record<string, St[]> = {
  heart: [
    { frame: 'wide', layout: 'ride', topo: 'scope', medium: 'ink' },
    { frame: 'three-quarter', layout: 'parallax', topo: 'rope', medium: 'ink' },
    { frame: 'reticle', layout: 'ride-tight', topo: 'cycle', medium: 'ink' },
  ],
  twin: [
    { frame: 'chassis', layout: 'columns', topo: 'apart', medium: 'ink' },
    { frame: 'tight-gap', layout: 'columns', topo: 'falter', medium: 'ink' },
    { frame: 'screen', layout: 'between', topo: 'sync', medium: 'ink' },
    { frame: 'screen-heads', layout: 'between', topo: 'taut', medium: 'ink' },
  ],
  square: [
    { frame: 'wide', layout: 'ride-wave', topo: 'sine', medium: 'ink' },
    { frame: 'wide', layout: 'scanlines', topo: 'raster', medium: 'ink' },
    { frame: 'sheet', layout: 'cells', topo: 'spec', medium: 'bone' },
  ],
};

/** Extra cuts: [time, state]. Times come from the beat grid only. */
function extras(p: PlateInfo, au: AudioLite): [number, St][] {
  const beats = beatTimes(au, p.start - 1e-3, p.end - 1e-3); // [0] = the plate-start beat when it starts on one
  const downs = barTimes(au, p.start + 1e-3, p.end - 1e-3);
  const out: [number, St][] = [];
  if (p.variant === 'heart') {
    // low tilted crop on the head during the second word; the taut snap on the last downbeat
    const b = beats.find((x) => x > sbShotTimes(p.id)[0]! + 1.5);
    if (b !== undefined) out.push([b, { frame: 'low', layout: 'ride-low', topo: 'scope', medium: 'ink' }]);
    const d = downs[downs.length - 1];
    if (d !== undefined) out.push([d, { frame: 'wide', layout: 'taut', topo: 'line', medium: 'ink' }]);
  } else if (p.variant === 'twin') {
    // the camera swings to the left screen as it dies; a 3/4 view of the synced pair as two rails
    const b = beats.find((x) => x > sbShotTimes(p.id)[1]! + 0.5);
    if (b !== undefined) out.push([b, { frame: 'tight-left', layout: 'columns', topo: 'falter', medium: 'ink' }]);
    if (downs[2] !== undefined) out.push([downs[2], { frame: 'depth', layout: 'rails', topo: 'sync', medium: 'ink' }]);
  } else if (p.variant === 'square') {
    if (downs[0] !== undefined) out.push([downs[0], { frame: 'close', layout: 'ride-wave', topo: 'sine', medium: 'ink' }]);
    const last = beats.filter((b) => b > sbShotTimes(p.id)[2]! + 0.2).pop();
    if (last !== undefined) out.push([last, { frame: 'sheet-close', layout: 'cells-close', topo: 'spec', medium: 'bone' }]);
  }
  return out;
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = SB[p.variant];
  if (!sb) throw new Error(`ecg: unknown variant ${p.variant}`);
  const times = sbShotTimes(p.id);
  const list: [number, St][] = times.map((t, i) => [i === 0 ? p.start : t, sb[Math.min(i, sb.length - 1)]!]);
  list.push(...extras(p, au));
  list.sort((a, b) => a[0] - b[0]);
  return list.map(([t, s], i) => ({ t, s: { id: `${p.id}#${i}`, ...s } }));
}
