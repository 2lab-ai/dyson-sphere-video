// Shot list for the orbit plates (pure: imported by scenes/orbit.ts and by the edit gate).
// State = camera rig (`cam`) + what the panels are doing (`topo`). Times are the approved storyboard shots
// verbatim (sbShotTimes), plus one exit shot per plate snapped to a beat:
//   launch   silhouette -> threeq (sparse orbits) -> plane (dense collector plane) -> top (disc occludes the star)
//   ring     gaps (between ring planes) -> behind (silhouettes on the overexposed star) -> wide (rings closed) -> flare
//   capture  outside (rings closing) -> inside (the words pressed to the bars) -> spin (the cage spins to a blur)
//   swarm    track (lateral track in orbit, volleys launching) -> wide (high 3/4: the swarm rings the Sun)
//            -> lock (last beat: every ring widens into a closed band, the hand-off to the shell)
import { beatTimes, type AudioLite, type PlateInfo, type Shot, type ShotState } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

const PLAN: Record<string, ShotState[]> = {
  launch: [
    { cam: 'silhouette', topo: 'volley' },
    { cam: 'threeq', topo: 'sparse' },
    { cam: 'plane', topo: 'dense' },
    { cam: 'top', topo: 'disc' },
  ],
  ring: [
    { cam: 'gaps', topo: 'bands' },
    { cam: 'behind', topo: 'silhouette' },
    { cam: 'wide', topo: 'closed' },
    { cam: 'flare', topo: 'closed' },
  ],
  capture: [
    { cam: 'outside', topo: 'closing' },
    { cam: 'inside', topo: 'cage' },
    { cam: 'spin', topo: 'blur' },
  ],
  swarm: [
    { cam: 'track', topo: 'volley' },
    { cam: 'wide', topo: 'rings' },
    { cam: 'wide', topo: 'lock' },
  ],
};

/** The beat the exit shot sits on: the last beat of the plate (launch, ring, swarm), the last beat of the line (capture). */
function exitTime(p: PlateInfo, au: AudioLite): number {
  const bs = beatTimes(au, p.start + 0.05, p.end - 0.05);
  return bs[bs.length - 1] ?? p.end - 0.4;
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = PLAN[p.variant] ?? PLAN.launch!;
  const times = sbShotTimes(p.id).slice();
  times[0] = p.start;
  const tx = exitTime(p, au);
  if (tx > times[times.length - 1]! + 0.1) times.push(tx);
  return times.map((t, i) => ({ t, s: { id: `${p.id}#${i}`, ...plan[Math.min(i, plan.length - 1)]! } }));
}
