// Shot list for the demo sequence (pure: imported by scenes/demo.ts and by the edit gate).
// Three plates, one per era, each with its own composition, camera and motion (v3 sequence `demo`):
//   boot      p38  ENIAC corridor (wide) -> one panel's lamp matrix (panel) -> C64 boot screen (close) -> raster bars
//   internet  p39  modem dial (flat) -> carrier -> copper bars + jamo sine scroller (wide) -> mirrored scroller
//                  -> the network from above, node by node (top) -> the nodes flood into data
//   ai        p40  Ikeda barcode flood (flat) -> barcode over a bit matrix (split) -> the flood condenses into a
//                  low-res face (close) -> only the eye is left (the match disc for p41's sun)
// State = {fx: the effect/medium, cam: framing, stage: the step inside the effect}. The approved storyboard times
// (sbShotTimes) are always cuts; the extra cuts sit on beats.
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

/** One planned cut: at storyboard shot `sb`, or at beat `beat` counted from the plate start. */
type Step = { sb?: number; beat?: number; s: ShotState };

const PLAN: Record<string, Step[]> = {
  boot: [
    // v4: opens static on p37's glowing dot grid = the accumulator's lamp grid (the corridor dolly is retired here)
    { sb: 0, s: { fx: 'eniac', cam: 'panel', stage: 'lamps' } },
    { sb: 1, s: { fx: 'c64', cam: 'close', stage: 'ready' } },
    { beat: 6, s: { fx: 'c64', cam: 'close', stage: 'raster' } },
  ],
  internet: [
    { sb: 0, s: { fx: 'modem', cam: 'flat', stage: 'dial' } },
    { beat: 2, s: { fx: 'modem', cam: 'flat', stage: 'carrier' } },
    { sb: 1, s: { fx: 'copper', cam: 'wide', stage: 'scroll' } },
    { beat: 6, s: { fx: 'copper', cam: 'wide', stage: 'mirror' } },
    { sb: 2, s: { fx: 'net', cam: 'top', stage: 'nodes' } },
    { beat: 11, s: { fx: 'net', cam: 'top', stage: 'flood' } },
  ],
  ai: [
    { sb: 0, s: { fx: 'flood', cam: 'flat', stage: 'bars' } },
    { beat: 2, s: { fx: 'flood', cam: 'flat', stage: 'matrix' } },
    { sb: 1, s: { fx: 'face', cam: 'close', stage: 'condense' } },
    { beat: 7, s: { fx: 'face', cam: 'close', stage: 'eye' } },
  ],
};

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const beats = beatTimes(au, p.start - 1e-3, p.end - 1 / 60);
  const plan = PLAN[p.variant] ?? PLAN.boot!;
  const list: Shot[] = plan.map((st, i) => {
    const t = i === 0 ? p.start : st.sb !== undefined ? (sb[st.sb] ?? p.start) : (beats[st.beat!] ?? p.start);
    return { t, s: { ...st.s, id: `${p.id}#${i}` } };
  });
  return list.sort((a, b) => a.t - b.t);
}
