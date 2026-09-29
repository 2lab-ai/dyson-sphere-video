// Shot list for the split plate (pure: imported by scenes/split.ts and by the edit gate).
// p20-split-ascii (E6 ASCII Hangul raster, palette `ascii`): one lit room, torn vertically into two media.
// State = camera (`cam`) + what the tear is doing (`tear`) + how the raster side is drawn (`raster`), one
// structural change on every approved storyboard time (bridge cap = 2 bars; the longest gap is the 2.33 s tail):
//   wide   98.333  (s)      the frame torn vertically: amber ASCII raster left, the lit room right   tear hairline
//   close  99.831  (L15)    close on the tear: glyph cells against continuous light                   tear hairline
//   tilt   102.024 (W15.2)  dutch tilt, the tear gapes; the syllable on the tear is half glyph/half solid
//   macro  104.16  (+10b)   macro on the last cells: the tear sweeps right and the raster swallows the frame
import { type AudioLite, type PlateInfo, type Shot } from '../engine/shots';
import { sbShotTimes } from '../engine/storyboard';

export type Cam = 'wide' | 'close' | 'tilt' | 'macro';
/** hairline = a thin torn gap; gape = the gap opens wide; sweep = the tear runs off the right edge. */
export type Tear = 'hairline' | 'gape' | 'sweep';
/** cells = glyph cells only; flip = cells swallowed by the tear flip over on the beat. */
export type Raster = 'cells' | 'flip';

export function shots(p: PlateInfo, _au: AudioLite): Shot[] {
  const sb = sbShotTimes(p.id);
  const plan: { cam: Cam; tear: Tear; raster: Raster }[] = [
    { cam: 'wide', tear: 'hairline', raster: 'cells' },
    { cam: 'close', tear: 'hairline', raster: 'cells' },
    { cam: 'tilt', tear: 'gape', raster: 'cells' },
    { cam: 'macro', tear: 'sweep', raster: 'flip' },
  ];
  return sb.map((t, i) => {
    const s = plan[Math.min(i, plan.length - 1)]!;
    return { t, s: { id: `${p.id}#${s.cam}`, ...s } };
  });
}
