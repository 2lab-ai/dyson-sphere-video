// Shell geometry (from v1 scenes/shell.ts): a sphere tiled with hex panels, and ray-sphere hits.
//   raySphere(ro, rd, r)              TS: [tNear, tFar] or null
//   SHELL_GLSL                        float sdfSphere(vec3 p, float r);
//                                     vec2 raySphere(vec3 ro, vec3 rd, float r);   (-1,-1) on a miss
//                                     vec3 cubeUV(vec3 n, float cells);            equi-angular cube face coords * cells, z = face id
//                                     vec4 hexCell(vec2 p);                        xy = offset from cell centre, zw = centre
//                                     float hexDist(vec2 g);                       0.5 at the cell edge
//                                     float cellHash(vec2 c, float face);          stable per-panel hash (for coverage order)
type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function raySphere(ro: V3, rd: V3, r: number): [number, number] | null {
  const b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0) return null;
  const s = Math.sqrt(h);
  return [-b - s, -b + s];
}

export const SHELL_GLSL = /* glsl */ `
float sdfSphere(vec3 p, float r) { return length(p) - r; }
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h); return vec2(-b - h, -b + h);
}
vec3 cubeUV(vec3 n, float cells) {
  vec3 ax = abs(n); vec2 uv; float f;
  if (ax.x >= ax.y && ax.x >= ax.z) { uv = n.yz / ax.x; f = n.x > 0.0 ? 0.0 : 1.0; }
  else if (ax.y >= ax.z) { uv = n.xz / ax.y; f = n.y > 0.0 ? 2.0 : 3.0; }
  else { uv = n.xy / ax.z; f = n.z > 0.0 ? 4.0 : 5.0; }
  uv = atan(uv) * (4.0 / PI);
  return vec3(uv * cells, f);
}
vec4 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - 0.5 * s, b = mod(p - 0.5 * s, s) - 0.5 * s;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return vec4(g, p - g);
}
float hexDist(vec2 g) { g = abs(g); return max(dot(g, vec2(0.5, 0.8660254)), g.x); }
float cellHash(vec2 c, float f) { vec2 id = floor(vec2(c.x * 2.0, c.y / 0.8660254) + 0.5); return hash12(id * 1.37 + f * 19.1 + 3.3); }
`;
