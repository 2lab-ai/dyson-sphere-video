// Shot list for the pop-up book plates (pure: imported by scenes/popup.ts and by the edit gate).
// State = camera set-up (`cam`) + book topology (`book`: open spread / slamming shut; `page`: which spread is up).
//
// variant 'city' (p28): times from the approved storyboard (sbShotTimes) plus two extra cuts taken from the beat grid:
//   the downbeat between the opening and line 27 (a low track over the printed floor), and the last beat
//   of the plate (the book slams shut).
// variants 'life-sea' (p18) and 'life-land' (p19), the declared sequence popup-life: every storyboard shot (one per
//   bar) plus one extra cut on the third beat of every bar, so the drop cuts every two beats. Each cut is a new
//   camera set-up; the sea spread and the land spread never share a camera name.
import { barTimes, beatTimes, type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'threeq' | 'floor' | 'low' | 'overhead' | 'slam';
/** Life cameras: sea spread (p18) and land spread (p19). */
export type LifeCam = 'open' | 'cell' | 'waves' | 'rise' | 'shore' | 'beach' | 'forest' | 'canopy' | 'track' | 'file' | 'close';

/** Per bar of each life plate: [storyboard camera, extra camera two beats later]. */
const LIFE: Record<string, [LifeCam, LifeCam | null][]> = {
  'life-sea': [['open', 'cell'], ['waves', 'rise']],
  'life-land': [['shore', 'beach'], ['forest', 'canopy'], ['track', 'file'], ['close', null]],
};

function lifeShots(p: PlateInfo, au: AudioLite): Shot[] {
  const plan = LIFE[p.variant]!;
  const sb = sbShotTimes(p.id);
  const frame = 1 / 60;
  const out: { t: number; cam: LifeCam }[] = [];
  plan.forEach(([a, b], i) => {
    const t0 = sb[i] ?? p.start + (i * 4 * 60) / au.bpm;
    out.push({ t: t0, cam: a });
    if (!b) return;
    const t2 = beatTimes(au, t0 + frame, p.end - frame)[1]; // the third beat of the bar
    if (t2 !== undefined && (sb[i + 1] === undefined || t2 < sb[i + 1]! - frame)) out.push({ t: t2, cam: b });
  });
  const page = p.variant === 'life-sea' ? 'sea' : 'land';
  return out.map((s, i) => ({ t: s.t, s: { id: `${p.id}#${i}`, cam: s.cam, page, book: 'open' } }));
}

export function shots(p: PlateInfo, au: AudioLite): Shot[] {
  if (LIFE[p.variant]) return lifeShots(p, au);
  const sb = sbShotTimes(p.id);
  const frame = 1 / 60;
  const out: { t: number; cam: Cam; book: 'open' | 'shut' }[] = [];
  // storyboard: (s) three-quarter book, (L27) low angle between buildings, (+8b) overhead as the last tower rises
  const [t0, tLow, tOver] = [sb[0] ?? p.start, sb[1] ?? p.start + 3, sb[2] ?? p.start + 4.6];
  out.push({ t: t0, cam: 'threeq', book: 'open' });
  const floorT = barTimes(au, t0 + frame, tLow - frame)[0];
  if (floorT !== undefined) out.push({ t: floorT, cam: 'floor', book: 'open' });
  out.push({ t: tLow, cam: 'low', book: 'open' });
  out.push({ t: tOver, cam: 'overhead', book: 'open' });
  const beats = beatTimes(au, tOver + frame, p.end - frame);
  const slamT = beats[beats.length - 1];
  if (slamT !== undefined) out.push({ t: slamT, cam: 'slam', book: 'shut' });
  return out.map((s, i) => ({ t: s.t, s: { id: `${p.id}#${i}`, cam: s.cam, book: s.book } }));
}
