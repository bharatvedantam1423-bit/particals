import type { Cloud, Rng } from "../types";
import {
  type JointName, type Skeleton, type Vec3, type Quat,
  add, cross, len, lerp3, norm, rotate, scale3, sub, toWorld,
} from "./rig";

/**
 * Samples a posed skeleton into particles. Density follows anatomy:
 *  - spine, rib arcs, clavicles and joint centres → density ≈ 1
 *  - limb volumes are centre-weighted (more points and higher density on the
 *    centreline, thinning toward the surface)
 *  - hands / feet get few, low-density points
 *  - a fraction of points ("edge motes") sit just outside the silhouette with
 *    density 0; the shader lets those drift so the boundary dissolves.
 */

type Prim =
  | { kind: "capsule"; a: Vec3; b: Vec3; ra: number; rb: number; w: number; dens: number }
  | { kind: "ellipsoid"; p: Vec3; q: Quat; c: Vec3; r: Vec3; w: number; dens: number; shell: number }
  | { kind: "ribs"; p: Vec3; q: Quat; c: Vec3; r: Vec3; w: number };

export interface FigureOptions {
  role: number;
  /** Fraction of points pushed outside the silhouette as drifting motes. */
  edgeFrac?: number;
  /** Multiplies every density value (crowd figures read softer than the hero). */
  densityScale?: number;
}

function buildPrims(sk: Skeleton, s: number): Prim[] {
  const P = (j: JointName) => sk[j].p;
  const prims: Prim[] = [];
  const cap = (a: Vec3, b: Vec3, ra: number, rb: number, w: number, dens: number) =>
    prims.push({ kind: "capsule", a, b, ra: ra * s, rb: rb * s, w, dens });
  const ell = (j: JointName, c: Vec3, r: Vec3, w: number, dens: number, shell = 0.6) =>
    prims.push({ kind: "ellipsoid", p: sk[j].p, q: sk[j].q, c: scale3(c, s), r: scale3(r, s), w, dens, shell });

  // Spine: a thin, very dense line set posterior to the body axis (vertebral column).
  const back = (j: JointName, dz = -0.055): Vec3 => toWorld(sk, j, [0, 0, dz], s);
  const spine: Vec3[] = [back("pelvis", -0.06), back("spine1"), back("spine2", -0.07), back("chest", -0.04), back("neck", -0.01)];
  for (let i = 0; i < spine.length - 1; i++) cap(spine[i], spine[i + 1], 0.024, 0.021, 1.3, 0.9);

  // Thorax: rib arcs + soft volume, abdomen, pelvis girdle.
  prims.push({ kind: "ribs", p: sk.spine2.p, q: sk.spine2.q, c: scale3([0, 0.1, 0.015], s), r: scale3([0.15, 0.18, 0.11], s), w: 5 });
  ell("spine2", [0, 0.1, 0.015], [0.15, 0.18, 0.11], 6, 0.35, 0.55);
  ell("spine1", [0, 0.05, 0.02], [0.13, 0.12, 0.095], 4.5, 0.3, 0.5);
  ell("pelvis", [0, -0.03, -0.005], [0.165, 0.11, 0.115], 5, 0.45, 0.5);

  // Shoulder girdle: clavicles + deltoids.
  cap(toWorld(sk, "chest", [0, -0.03, 0.05], s), P("shoulderL"), 0.022, 0.03, 1, 0.85);
  cap(toWorld(sk, "chest", [0, -0.03, 0.05], s), P("shoulderR"), 0.022, 0.03, 1, 0.85);
  ell("shoulderL", [0.01, -0.02, 0], [0.055, 0.065, 0.055], 1.2, 0.5);
  ell("shoulderR", [-0.01, -0.02, 0], [0.055, 0.065, 0.055], 1.2, 0.5);

  // Neck + head. Cranium and jaw only: an anatomical skull volume, no features.
  cap(P("chest"), toWorld(sk, "head", [0, 0.01, 0], s), 0.055, 0.047, 2, 0.75);
  ell("head", [0, 0.105, -0.012], [0.077, 0.105, 0.097], 5.5, 0.55, 0.35);
  ell("head", [0, 0.035, 0.035], [0.056, 0.068, 0.066], 1.8, 0.45, 0.4);

  // Limbs: centre-weighted capsules, tapering toward the extremities.
  for (const side of ["L", "R"] as const) {
    const j = (n: string) => `${n}${side}` as JointName;
    cap(P(j("shoulder")), P(j("elbow")), 0.05, 0.039, 3, 0.9);
    cap(P(j("elbow")), P(j("wrist")), 0.041, 0.027, 2.2, 0.85);
    cap(P(j("wrist")), P(j("hand")), 0.028, 0.013, 0.7, 0.4);
    cap(P(j("hip")), P(j("knee")), 0.08, 0.052, 5.5, 0.9);
    cap(P(j("knee")), P(j("ankle")), 0.056, 0.032, 3.5, 0.85);
    cap(P(j("ankle")), P(j("toe")), 0.034, 0.022, 0.9, 0.4);
    ell(j("ankle"), [0, -0.045, -0.035], [0.028, 0.028, 0.04], 0.35, 0.4);
    for (const n of ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"]) {
      ell(j(n), [0, 0, 0], [0.032, 0.032, 0.032], 0.45, 1.0, 0.2);
    }
  }
  return prims;
}

function basis(axis: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(axis, ref));
  return [u, cross(axis, u)];
}

/**
 * Writes `n` points for one figure into `out` starting at `offset`.
 * Returns the next free offset.
 */
export function sampleFigure(
  sk: Skeleton, s: number, n: number, rng: Rng, out: Cloud, offset: number, opts: FigureOptions,
): number {
  const prims = buildPrims(sk, s);
  const cdf: number[] = [];
  let total = 0;
  for (const p of prims) cdf.push((total += p.w));

  const edgeFrac = opts.edgeFrac ?? 0.07;
  const dScale = opts.densityScale ?? 1;
  const end = Math.min(out.count, offset + n);

  for (let i = offset; i < end; i++) {
    const x = rng() * total;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < x) lo = m + 1; else hi = m; }
    const prim = prims[lo];
    const edge = rng() < edgeFrac;
    let pt: Vec3;
    let d: number;

    if (prim.kind === "capsule") {
      const axis = sub(prim.b, prim.a);
      const L = len(axis);
      const dir = scale3(axis, 1 / (L || 1));
      const [u, v] = basis(dir);
      // extend past the ends so joints get rounded caps
      const capA = prim.ra / (L || 1), capB = prim.rb / (L || 1);
      const t = -capA * 0.6 + rng() * (1 + (capA + capB) * 0.6);
      const tc = Math.min(1, Math.max(0, t));
      let R = prim.ra + (prim.rb - prim.ra) * tc;
      if (t < 0) R *= Math.sqrt(Math.max(0, 1 - (t / capA) ** 2));
      if (t > 1) R *= Math.sqrt(Math.max(0, 1 - ((t - 1) / capB) ** 2));
      // Radius exponent 0.6 sits between uniform-in-disk (0.5) and centre-heavy
      // (1.0): limbs keep volume but still thicken along the centreline.
      const k = edge ? 1.05 + 0.6 * rng() ** 2 : rng() ** 0.6;
      const th = rng() * Math.PI * 2;
      const c = add(prim.a, scale3(axis, t));
      pt = add(c, add(scale3(u, Math.cos(th) * R * k), scale3(v, Math.sin(th) * R * k)));
      d = edge ? 0 : prim.dens * (1 - 0.8 * k);
    } else if (prim.kind === "ellipsoid") {
      const dir = randomDir(rng);
      const k = edge ? 1.05 + 0.5 * rng() ** 2 : rng() ** prim.shell;
      const local: Vec3 = [prim.c[0] + dir[0] * prim.r[0] * k, prim.c[1] + dir[1] * prim.r[1] * k, prim.c[2] + dir[2] * prim.r[2] * k];
      pt = add(prim.p, rotate(prim.q, local));
      d = edge ? 0 : prim.dens * (1 - k * k * 0.85);
    } else {
      // 11 rib arcs, anterior ends dropping lower than posterior (costal slope).
      const rib = Math.floor(rng() * 11);
      const h = 0.78 - rib * 0.13; // normalised height on the cage
      // Barrel profile: narrow at the thoracic inlet, widest around ribs 7–8.
      const ring = Math.sqrt(Math.max(0.1, 1 - h * h)) * (0.62 + 0.38 * Math.min(1, Math.max(0, (0.8 - h) / 0.9)));
      const th = rng() * Math.PI * 2;
      const front = Math.max(0, Math.sin(th)); // +z is anterior
      if (front > 0.9 && rib < 7) { i--; continue; } // sternal gap between rib ends
      const j = () => (rng() - 0.5) * 0.012;
      const local: Vec3 = [
        prim.c[0] + Math.cos(th) * prim.r[0] * ring + j(),
        prim.c[1] + h * prim.r[1] - front * 0.045 + j(),
        prim.c[2] + Math.sin(th) * prim.r[2] * ring + j(),
      ];
      pt = add(prim.p, rotate(prim.q, local));
      d = 0.7;
    }

    out.positions[i * 3] = pt[0];
    out.positions[i * 3 + 1] = pt[1];
    out.positions[i * 3 + 2] = pt[2];
    out.density[i] = Math.min(1, d * dScale);
    out.role[i] = opts.role;
  }
  return end;
}

function randomDir(rng: Rng): Vec3 {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

/**
 * A hand-held glowing rectangle (phone screen) between the two hands, or in
 * one hand, screen facing the head.
 */
export function samplePhone(
  sk: Skeleton, s: number, hands: "both" | "right", n: number, rng: Rng, out: Cloud, offset: number, role: number,
): number {
  const grip = (side: "L" | "R") => lerp3(sk[`wrist${side}`].p, sk[`hand${side}`].p, 0.45);
  const center = hands === "both" ? lerp3(grip("L"), grip("R"), 0.5) : grip("R");
  const eye = toWorld(sk, "head", [0, 0.09, 0.08], s);
  const nrm = norm(sub(eye, center));
  const [u, v] = basis(nrm);
  const w = 0.072 * s, h = 0.15 * s;
  const end = Math.min(out.count, offset + n);
  for (let i = offset; i < end; i++) {
    const a = (rng() - 0.5) * w, b = (rng() - 0.5) * h, c = (rng() - 0.5) * 0.006;
    const p = add(center, add(add(scale3(u, a), scale3(v, b)), scale3(nrm, c)));
    out.positions.set(p, i * 3);
    out.density[i] = 1;
    out.role[i] = role;
  }
  return end;
}
