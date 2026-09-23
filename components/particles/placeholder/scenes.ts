import { allocCloud, gaussian, mulberry32, ROLE_GLOW, ROLE_HERO, ROLE_STREAM, type Cloud, type Rng } from "../types";
import { samplePhone, sampleFigure } from "./figure";
import { standingPhoneLowered, standingRelaxed, walkingWithPhone } from "./poses";
import { solve, type Placement } from "./rig";

/**
 * Procedural stand-ins for the baked scene clouds. Each builder returns exactly
 * `count` points. Swap for real assets by dropping /public/clouds/<id>.bin in place.
 */

export const STREAM_HALF_WIDTH = 7; // metres; crowd wraps across [-W, W] in the shader

function heroPlacement(overrides: Partial<Placement> = {}): Placement {
  return { position: [0, 0, 0], yaw: 0, scale: 1, ...overrides };
}

/** Loose motes scattered around a centre (free, undecided particles). */
function scatter(out: Cloud, from: number, to: number, rng: Rng, c: [number, number, number], r: [number, number, number]) {
  for (let i = from; i < to; i++) {
    out.positions[i * 3] = c[0] + gaussian(rng) * r[0];
    out.positions[i * 3 + 1] = Math.max(0, c[1] + gaussian(rng) * r[1]);
    out.positions[i * 3 + 2] = c[2] + gaussian(rng) * r[2];
    out.density[i] = 0;
    out.role[i] = 0;
  }
}

/** Motes peeled off an existing body: jitter copies of earlier points outward. */
function peel(out: Cloud, srcFrom: number, srcTo: number, from: number, to: number, rng: Rng, spread: number) {
  for (let i = from; i < to; i++) {
    const s = srcFrom + Math.floor(rng() * (srcTo - srcFrom));
    const k = spread * (0.4 + rng() ** 2 * 1.6);
    out.positions[i * 3] = out.positions[s * 3] + gaussian(rng) * k;
    out.positions[i * 3 + 1] = out.positions[s * 3 + 1] + gaussian(rng) * k * 0.8 + 0.1 * rng();
    out.positions[i * 3 + 2] = out.positions[s * 3 + 2] + gaussian(rng) * k;
    out.density[i] = 0;
    out.role[i] = 0;
  }
}

// ------------------------------------------------------------------ scene 0

/** One figure standing; ~40% of particles drift free of the body. */
function scene0(count: number): Cloud {
  const rng = mulberry32(1001);
  const out = allocCloud(count);
  const body = Math.round(count * 0.6);
  sampleFigure(solve(standingRelaxed(), heroPlacement()), 1, body, rng, out, 0, { role: ROLE_HERO, edgeFrac: 0.1 });
  const near = body + Math.round(count * 0.22);
  peel(out, 0, body, body, near, rng, 0.22);
  scatter(out, near, count, rng, [0, 1.0, 0], [1.1, 0.75, 0.9]);
  return out;
}

// ------------------------------------------------------------------ scene 1

interface CrowdSlot { place: Placement; phase: number }

function crowdLayout(): CrowdSlot[] {
  const rng = mulberry32(2002);
  const rows = [-5.6, -3.9, -2.3, -0.9, 0.5];
  const slots: CrowdSlot[] = [];
  rows.forEach((z, r) => {
    const spacing = 1.05 + r * 0.04;
    for (let x = -STREAM_HALF_WIDTH + rng() * spacing; x < STREAM_HALF_WIDTH; x += spacing * (0.85 + rng() * 0.35)) {
      if (r === rows.length - 1 && Math.abs(x) < 0.8) continue; // gap around the hero
      slots.push({
        place: { position: [x, 0, z + (rng() - 0.5) * 0.35], yaw: 90 + (rng() - 0.5) * 8, scale: 0.93 + rng() * 0.13 },
        phase: rng() * Math.PI * 2,
      });
    }
  });
  return slots;
}

/**
 * The crowd is generated from its own seed and share so every scene-1
 * keyframe carries an identical crowd → the matcher pairs crowd points 1:1 and
 * only the hero (plus a few motes) actually morphs.
 */
function writeCrowd(out: Cloud, from: number, to: number) {
  const rng = mulberry32(2003);
  const slots = crowdLayout();
  const per = Math.floor((to - from) / slots.length);
  let o = from;
  slots.forEach((slot, idx) => {
    const n = idx === slots.length - 1 ? to - o : per;
    const sk = solve(walkingWithPhone(slot.phase), slot.place);
    const phoneN = Math.round(n * 0.05);
    o = sampleFigure(sk, slot.place.scale, n - phoneN, rng, out, o, { role: ROLE_STREAM, edgeFrac: 0.05, densityScale: 0.9 });
    o = samplePhone(sk, slot.place.scale, "both", phoneN, rng, out, o, ROLE_STREAM | ROLE_GLOW);
  });
}

const CROWD_SHARE = 0.74;

/** Crowd in a slow sideways stream, heads down over glowing phones; hero walks among them. */
function scene1Stream(count: number): Cloud {
  const rng = mulberry32(2101);
  const out = allocCloud(count);
  const crowdEnd = Math.round(count * CROWD_SHARE);
  writeCrowd(out, 0, crowdEnd);
  const heroN = Math.round(count * 0.08);
  const place = heroPlacement({ position: [0, 0, 0.55], yaw: 90 });
  const sk = solve(walkingWithPhone(0.6), place);
  let o = sampleFigure(sk, 1, heroN - 300, rng, out, crowdEnd, { role: ROLE_HERO, edgeFrac: 0.05, densityScale: 0.8 });
  o = samplePhone(sk, 1, "both", 300, rng, out, o, ROLE_HERO | ROLE_GLOW);
  // Undecided motes hanging around the hero — they get pulled in when it turns.
  scatter(out, o, count, rng, [0, 1.0, 0.55], [0.8, 0.6, 0.6]);
  return out;
}

/** Same crowd; the hero has stepped out, turned to camera, and gathered density. */
function scene1(count: number): Cloud {
  const rng = mulberry32(2201);
  const out = allocCloud(count);
  const crowdEnd = Math.round(count * CROWD_SHARE);
  writeCrowd(out, 0, crowdEnd);
  const heroN = Math.round(count * 0.225);
  const place = heroPlacement({ position: [0, 0, 1.35], yaw: 0 });
  const sk = solve(standingPhoneLowered(), place);
  let o = sampleFigure(sk, 1, heroN - 400, rng, out, crowdEnd, { role: ROLE_HERO, edgeFrac: 0.06 });
  o = samplePhone(sk, 1, "right", 400, rng, out, o, ROLE_HERO | ROLE_GLOW);
  peel(out, crowdEnd, o, o, count, rng, 0.12);
  return out;
}

// ------------------------------------------------------------- scenes 2–6

/**
 * TEMPORARY stand-in for beats 2–6 until their scenes are authored: the hero
 * standing resolved with a light halo. Seeded per id so morphs still move.
 */
function heroStub(seed: number) {
  return (count: number): Cloud => {
    const rng = mulberry32(seed);
    const out = allocCloud(count);
    const body = Math.round(count * 0.78);
    sampleFigure(solve(standingRelaxed(), heroPlacement({ yaw: (seed % 7) * 3 - 9 })), 1, body, rng, out, 0, { role: ROLE_HERO, edgeFrac: 0.07 });
    peel(out, 0, body, body, count, rng, 0.18);
    return out;
  };
}

export const PLACEHOLDER_BUILDERS: Record<string, (count: number) => Cloud> = {
  "scene-0": scene0,
  "scene-1-stream": scene1Stream,
  "scene-1": scene1,
  "scene-2": heroStub(3001),
  "scene-3": heroStub(4001),
  "scene-4": heroStub(5001),
  "scene-5": heroStub(6001),
  "scene-6": heroStub(7001),
};
