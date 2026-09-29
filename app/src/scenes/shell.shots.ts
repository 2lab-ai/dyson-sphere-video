// Shot list for the shell plates (pure: imported by scenes/shell.ts and by the edit gate).
// State = camera preset (`cam`), cutaway (`cut`: the shell is opened by a clip plane) and where the camera is
// (`view`: outside / inside the shell). Built on the approved storyboard times (engine/storyboard) plus a few
// extra cuts on beats so the drop/climax plates change structure every half bar to bar.
import { beatTimes, barTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam =
  // partial (p17)
  | 'wideA' | 'wideB' | 'inA' | 'inB' | 'slamIn'
  // seal (p30)
  | 'fingers' | 'etch' | 'escape' | 'slam' | 'pins' | 'pins2' | 'sealed'
  // whole (p35)
  | 'ext' | 'extLow' | 'cutSide' | 'cutSeam' | 'empty' | 'overhead'
  // pullback (p38)
  | 'close' | 'graze' | 'wide' | 'screen';

type Spec = { cam: Cam; cut?: number; view?: 'out' | 'in' };

const mk = (p: PlateInfo, t: number, i: number, s: Spec): Shot => ({
  t,
  s: { id: `${p.id}#${i}`, cam: s.cam, cut: s.cut ?? 0, view: s.view ?? 'out' },
});

/** The n-th beat strictly after `from` (n = 1 is the next beat), or `fallback`. */
function beatAfter(au: AudioLite, from: number, n: number, fallback: number): number {
  const bs = beatTimes(au, from + 1e-3, from + 60);
  return bs[n - 1] ?? fallback;
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const at = (k: number) => sb[k] ?? p.start;
  let list: [number, Spec][] = [];
  if (p.variant === 'partial') {
    list = [
      [at(0), { cam: 'wideA' }],
      [beatAfter(au, at(0), 2, at(0) + 1.1), { cam: 'wideB' }],
      [at(1), { cam: 'inA', view: 'in' }],
      [beatAfter(au, at(1), 2, at(1) + 1.1), { cam: 'inB', view: 'in' }],
      [at(2), { cam: 'slamIn' }],
    ];
  } else if (p.variant === 'seal') {
    // the gap slams shut on a beat between the escape and the pins; the pins get a second framing on the downbeat
    const slam = beatAfter(au, at(2), 3, (at(2) + at(3)) / 2);
    const pins2 = barTimes(au, at(3) + 0.05, at(4) - 0.05)[0] ?? beatAfter(au, at(3), 2, at(3) + 1.1);
    list = [
      [at(0), { cam: 'fingers' }],
      [at(1), { cam: 'etch' }],
      [at(2), { cam: 'escape' }],
      [slam, { cam: 'slam' }],
      [at(3), { cam: 'pins' }],
      [pins2, { cam: 'pins2' }],
      [at(4), { cam: 'sealed', cut: 1 }],
    ];
  } else if (p.variant === 'whole') {
    list = [
      [at(0), { cam: 'ext' }],
      [beatAfter(au, at(0), 2, at(0) + 1.1), { cam: 'extLow' }],
      [at(1), { cam: 'cutSide', cut: 1 }],
      [beatAfter(au, at(1), 2, at(1) + 1.1), { cam: 'cutSeam', cut: 1 }],
      [at(2), { cam: 'empty', cut: 1 }],
      [beatAfter(au, at(2), 2, at(2) + 1.1), { cam: 'overhead', cut: 1 }],
    ];
  } else {
    // pullback
    const graze = barTimes(au, at(0) + 0.05, at(1) - 0.05)[0] ?? (at(0) + at(1)) / 2;
    list = [
      [at(0), { cam: 'close' }],
      [graze, { cam: 'graze' }],
      [at(1), { cam: 'wide' }],
      [at(2), { cam: 'screen' }],
    ];
  }
  list = list.filter(([t]) => t >= p.start - 1e-6 && t < p.end).sort((a, b) => a[0] - b[0]);
  return list.map(([t, s], i) => mk(p, t, i, s));
}
