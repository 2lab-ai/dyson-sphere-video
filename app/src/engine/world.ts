// World host — the v4 "run" mechanism. A run (NIGHT, FILM, COSMOS, ORBIT, AMBER, GLASS, LINES) is one world rendered
// by ONE module across consecutive plates: same medium, ground, camera class and layout. Each plate changes only the
// SUBJECT, which is a child scene (any existing scenes/<module>.ts, chosen per plate in data/edit.json `subject`)
// rendered into a private target and composited into the world's subject slot. The four kept dimensions are therefore
// shared code, not a promise in a table (docs/PLAN-V4.md §C7).
//
// Plate params (data/edit.json): module = the host (e.g. "wall"), subject = { module, variant }, plus the v4 typing
// (nov, run|ref). The host receives the whole plate as ctx.params like any scene; the child receives the same ctx with
// params.variant = subject.variant and params.hosted = true, so a subject module can skip its own world/ground when
// hosted and keep its lyric drawing (drawLyric stays the one entry point; the child draws the plate's lines).
//
// Subclass contract:
//   renderWorld(f, out)            draw the persistent world into `out` (clear it yourself). Called every frame.
//   slot(f): Slot                  where the subject goes (uv scale/offset for Compositor.draw) and how it blends:
//                                  'screen'/'max' for a dark-ground child on a dark world, 'multiply' for a light child
//                                  on a light world (the child's own ground then disappears), 'normal' for premult.
//   afterSubject?(f, out)          optional pass over the composited frame (vignette, foreground hardware, grain).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides, type SceneCtx, type SceneClass } from './scene';
import { makeRT, clearRT, type BlendMode } from './gl';

export interface Slot {
  /** Compositor uv scale (>1 = the child appears smaller) and offset in uv units. */
  scale: [number, number];
  offset: [number, number];
  mode: BlendMode;
  opacity?: number;
  tint?: [number, number, number];
}

export type SceneLoader = (name: string) => Promise<{ default: SceneClass }>;
let loader: SceneLoader | null = null;
/** Set once by timeline.ts (it owns the import.meta.glob). */
export function setSceneLoader(l: SceneLoader) { loader = l; }

export abstract class WorldHost extends Scene {
  protected child: Scene | null = null;
  protected childRT: THREE.WebGLRenderTarget | null = null;
  protected subjectName = '(none)';
  override stateful = true; // the child may be stateful; the engine prerolls us, we forward the frames

  override async init() {
    const sub = this.ctx.params.subject as { module: string; variant?: string } | undefined;
    if (!sub) throw new Error(`${this.ctx.id}: hosted plate without params.subject`);
    if (!loader) throw new Error('world.ts: scene loader not set (timeline.ts must call setSceneLoader)');
    const mod = await loader(sub.module);
    const ctx: SceneCtx = { ...this.ctx, params: { ...this.ctx.params, variant: sub.variant ?? this.ctx.params.variant, hosted: true, module: sub.module } };
    this.child = new mod.default(ctx);
    this.subjectName = `${sub.module}/${sub.variant ?? '-'}`;
    this.childRT = makeRT();
    await this.child.init();
    await this.initWorld();
  }
  /** World resources (textures, meshes). */
  protected initWorld(): Promise<void> | void {}

  override reset() { this.child?.reset(); this.resetWorld(); }
  protected resetWorld() {}

  abstract renderWorld(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides | void;
  abstract slot(f: Frame): Slot;
  protected afterSubject(_f: Frame, _out: THREE.WebGLRenderTarget): void {}

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides | void {
    const r = this.ctx.renderer;
    // 1. the subject, in its own target (the child believes it owns the frame)
    if (this.child && this.childRT) {
      try { this.child.render({ ...f, under: null, tin: 1, tout: 0 }, this.childRT); }
      catch (err) { console.error(`${this.ctx.id} subject ${this.subjectName} render error`, err); clearRT(r, this.childRT, [0, 0, 0], 0); }
    }
    if (f.preroll) return;
    // 2. the world
    const ov = this.renderWorld(f, out);
    // 3. the subject into the slot
    if (this.childRT) {
      const s = this.slot(f);
      this.ctx.comp.draw(r, this.childRT.texture, out, { mode: s.mode, opacity: s.opacity ?? 1, tint: s.tint, scale: s.scale, offset: s.offset });
    }
    this.afterSubject(f, out);
    return ov;
  }

  override dispose() { this.child?.dispose(); this.childRT?.dispose(); }
}
