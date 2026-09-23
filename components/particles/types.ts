/**
 * Shared data types for the particle system. Pure TS (no DOM, no React) so the
 * same modules run on the main thread and inside the cloud worker.
 */

/** Per-point role bitfield. Stored as a float attribute on the GPU. */
export const ROLE_HERO = 1; // the protagonist figure — always renders brightest
export const ROLE_GLOW = 2; // emissive props (phone / laptop screens, offer letter)
export const ROLE_STREAM = 4; // drifts sideways with the crowd stream (scene 1)

export interface Cloud {
  count: number;
  /** xyz triples, metres, y-up, +z toward camera. */
  positions: Float32Array;
  /** 0..1 — 1 on bone / spine / joint lines, 0 at the silhouette edge. */
  density: Float32Array;
  /** ROLE_* bitfield per point (float so it uploads straight to an attribute). */
  role: Float32Array;
}

export function allocCloud(count: number): Cloud {
  return {
    count,
    positions: new Float32Array(count * 3),
    density: new Float32Array(count),
    role: new Float32Array(count),
  };
}

/** Deterministic PRNG (mulberry32) so placeholder clouds are stable between reloads. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
