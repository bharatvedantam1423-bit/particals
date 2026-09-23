/**
 * GLSL for the particle material.
 *
 * Vertex: morph aTargetA → aTargetB (per-particle stagger), sideways crowd
 * stream, curl-noise looseness scaled by (1 - uResolvedness), size attenuation
 * in world units, per-particle size/brightness from density and role.
 * Fragment: soft round sprite (no square edges), additive-friendly output.
 */

// Simplex noise with analytic gradient (after Ashima Arts / Stefan Gustavson,
// MIT). Returning the gradient lets us build curl noise from 3 evaluations
// instead of 18 finite-difference samples — matters at 150k vertices.
const noise = /* glsl */ `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 10.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// returns vec4(gradient.xyz, value)
vec4 snoiseGrad(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  vec3 grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return 42.0 * vec4(grad, dot(m4, pdotx));
}

// Divergence-free flow: curl of a vector potential made of 3 offset noises.
vec3 curlNoise(vec3 p) {
  vec3 gx = snoiseGrad(p).xyz;
  vec3 gy = snoiseGrad(p + vec3(31.416, -47.853, 12.793)).xyz;
  vec3 gz = snoiseGrad(p + vec3(-233.2, 108.7, 81.3)).xyz;
  return vec3(gz.y - gy.z, gx.z - gz.x, gy.x - gx.y);
}
`;

export const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uMorph;
uniform float uResolvedness;
uniform float uIntensity;
uniform float uBrandMix;
uniform float uPulse;        // world Y of the pulse band centre; < -1 disables (scene 4)
uniform float uStreamA;      // crowd drift speed (m/s) for the keyframe bound to A
uniform float uStreamB;
uniform float uStreamHalfWidth;
uniform float uSize;         // world-space sprite diameter (m)
uniform float uSizeScale;    // perf guard compensation when the draw range is halved
uniform float uViewportH;    // drawing-buffer height in px
uniform vec3 uColorCore;
uniform vec3 uColorEdge;
uniform vec3 uColorBrand;

attribute vec3 aTargetA;
attribute vec3 aTargetB;
attribute float aRandom;
attribute vec2 aDensity;     // x: density in A, y: density in B
attribute vec2 aRole;        // x: role bits in A, y: role bits in B

varying vec3 vColor;
varying float vAlpha;

${noise}

float bit(float role, float b) { return mod(floor(role / b + 0.5 / b), 2.0); }

// Crowd stream: ROLE_STREAM points slide along +x and wrap across [-W, W].
vec3 streamed(vec3 p, float role, float speed, out float fade) {
  float s = bit(role, 4.0);
  float w = uStreamHalfWidth;
  float x = mod(p.x + uTime * speed + w, 2.0 * w) - w;
  p.x = mix(p.x, x, s);
  fade = mix(1.0, 1.0 - smoothstep(w - 1.5, w, abs(x)), s);
  return p;
}

void main() {
  // Per-particle stagger so a morph ripples through the cloud instead of snapping as one.
  float t = clamp((uMorph - aRandom * 0.35) / 0.65, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  float transit = sin(3.14159265 * t);

  float fadeA, fadeB;
  vec3 pA = streamed(aTargetA, aRole.x, uStreamA, fadeA);
  vec3 pB = streamed(aTargetB, aRole.y, uStreamB, fadeB);
  vec3 pos = mix(pA, pB, t);

  float density = mix(aDensity.x, aDensity.y, t);
  float hero = mix(bit(aRole.x, 1.0), bit(aRole.y, 1.0), t);
  float glow = mix(bit(aRole.x, 2.0), bit(aRole.y, 2.0), t);
  float edge = 1.0 - density;

  // Looseness: global (scene unresolved), mid-flight, and the silhouette edge
  // which always dissolves into drifting motes.
  float loose = (1.0 - uResolvedness) * (0.25 + 0.75 * edge)
              + transit * 0.6
              + edge * edge * edge * 0.2;
  // Raw curl magnitude runs ~0–4; scale to centimetres-to-decimetres of drift.
  vec3 flow = curlNoise(pos * 0.6 + vec3(0.0, uTime * 0.05, aRandom * 0.25));
  pos += flow * loose * 0.075;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // Size attenuation in world units: projected diameter in drawing-buffer px.
  float worldSize = uSize * uSizeScale * (0.55 + 0.9 * density) * (1.0 + 0.35 * glow);
  float px = worldSize * projectionMatrix[1][1] * uViewportH * 0.5 / max(0.05, -mv.z);
  float energy = 1.0;
  if (px < 1.0) { energy = px; px = 1.0; } // sub-pixel: keep the light, not the size
  gl_PointSize = min(px, 28.0);

  // Brightness carries the emotion; hue stays in one family.
  float bright = (0.4 + 0.6 * density);
  // A few free motes twinkle so the unresolved cloud reads as particles, not haze.
  bright *= 1.0 + step(0.88, aRandom) * edge * edge * (1.6 + 0.8 * sin(uTime * 1.7 + aRandom * 40.0));
  bright *= mix(0.72, 1.3, hero);       // hero is always the brightest figure
  bright *= 1.0 + glow * mix(1.1, 2.4, hero); // screens / emissive props
  float band = uPulse < -1.0 ? 0.0 : exp(-pow((pos.y - uPulse) / 0.12, 2.0)) * hero;
  bright *= 1.0 + band * 2.5;
  bright *= mix(fadeA, fadeB, t) * uIntensity * energy;

  vec3 cool = mix(uColorEdge, uColorCore, density);
  vec3 brand = mix(uColorBrand, uColorCore, density * 0.45);
  vColor = mix(mix(cool, brand, uBrandMix), uColorCore, glow * 0.6);
  vAlpha = bright * 0.3;
}
`;

export const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.2) * (1.0 - smoothstep(0.7, 1.0, d));
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;
