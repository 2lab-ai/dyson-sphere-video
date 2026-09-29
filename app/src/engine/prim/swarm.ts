// Swarm instancing (from v1 scenes/swarm.ts and the ignite satellites): panels placed on tilted orbits.
//   orbitPoint(i, t, o?)              2D screen-space point of satellite i on its tilted ellipse at time t
//   ringLaunch(age)                   0..~1.1 radius factor of a ring launched `age` units ago (ease-out-back)
//   SWARM_GLSL                        vec2 orbitPoint(float i, float t, float rad0, float drad);
//                                     float orbitTrace(vec2 p, float i, float rad0, float drad);  distance to i's ellipse
//                                     vec3 ringHit(vec3 ro, vec3 rd, vec3 n, vec3 e1, vec3 e2);   ray-plane hit: (r, angle/TAU, t)
//                                     float easeOutBack(float x);
export interface OrbitOpts { rad0?: number; drad?: number; speed?: number }

export function orbitPoint(i: number, t: number, o: OrbitOpts = {}): { x: number; y: number; front: boolean } {
  const rad = (o.rad0 ?? 0.28) + (o.drad ?? 0.05) * i;
  const ph = t * (o.speed ?? 0.9 - i * 0.04) + i * 2.1;
  const tilt = 0.35 + 0.15 * Math.sin(i * 1.7);
  const qx = Math.cos(ph) * rad, qy = Math.sin(ph) * rad * tilt;
  const a = i * 0.7, c = Math.cos(a), s = Math.sin(a);
  return { x: c * qx - s * qy, y: s * qx + c * qy, front: Math.sin(ph) >= 0 };
}

export function ringLaunch(age: number): number {
  const x = Math.min(1, Math.max(0, age)) - 1, c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

export const SWARM_GLSL = /* glsl */ `
float easeOutBack(float x) { float c1 = 1.9, c3 = c1 + 1.0; x = sat(x) - 1.0; return 1.0 + c3 * x * x * x + c1 * x * x; }
float _orbitTilt(float i) { return 0.35 + 0.15 * sin(i * 1.7); }
vec2 orbitPoint(float i, float t, float rad0, float drad) {
  float rad = rad0 + drad * i, ph = t * (0.9 - i * 0.04) + i * 2.1;
  return rot2(i * 0.7) * vec2(cos(ph) * rad, sin(ph) * rad * _orbitTilt(i));
}
float orbitTrace(vec2 p, float i, float rad0, float drad) {
  vec2 pr = rot2(-i * 0.7) * p;
  return abs(length(vec2(pr.x, pr.y / _orbitTilt(i))) - (rad0 + drad * i));
}
vec3 ringHit(vec3 ro, vec3 rd, vec3 n, vec3 e1, vec3 e2) {
  float dn = dot(rd, n);
  if (abs(dn) < 1e-4) return vec3(-1.0);
  float t = -dot(ro, n) / dn;
  vec3 hp = ro + rd * t;
  vec2 q = vec2(dot(hp, e1), dot(hp, e2));
  return vec3(length(q), atan(q.y, q.x) / TAU, t);
}
`;
