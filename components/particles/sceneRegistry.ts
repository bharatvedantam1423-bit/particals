/**
 * Scene registry: the ordered keyframes the particle system morphs through,
 * the copy beats they belong to, and the pure scroll → timeline mapping.
 *
 * A "beat" is one of the 7 narrative scenes (and one copy line). A beat may own
 * several keyframes when it needs internal motion — e.g. beat 1 streams the
 * crowd first, then the hero steps out and turns. Each keyframe is one cloud:
 * /public/clouds/<id>.bin (see scripts/bake-clouds.md).
 */

export const BEATS = [
  "AI changed tech hiring. We changed how you learn.",
  "Everyone's scrolling. You start building.",
  "Fundamentals + AI, with a mentor beside you.",
  "Projects that prove it. Interviews you're ready for.",
  "Then the message you've worked for.",
  "An offer letter changes more than one life.",
  "Join the 16,000+ who already made it.",
] as const;

export interface CameraShot {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface Keyframe {
  /** Cloud id → /clouds/<id>.bin, or the placeholder builder of the same name. */
  id: string;
  /** Copy beat / scene index 0..6. */
  beat: number;
  /** Scroll weight spent sitting on this keyframe (resolved, playing its own motion). */
  hold: number;
  /** Scroll weight spent morphing from this keyframe into the next one. */
  morph: number;
  /** 1 = crisp figure, 0 = fully loose. Curl noise scales with (1 - resolvedness). */
  resolvedness: number;
  /** 0 = cool white-blue palette, 1 = NxtWave brand blue. */
  brandMix: number;
  /** Overall brightness (compensates for how many points overlap on screen). */
  intensity: number;
  /** Sideways drift (m/s) applied to ROLE_STREAM points. */
  stream: number;
  camera: CameraShot;
  /** Mobile override. Hero shots push in; crowd shots stay wide. */
  cameraMobile?: CameraShot;
  /** "stub" = placeholder standing hero until the scene is authored. */
  status: "ready" | "stub";
}

const heroShot: CameraShot = { position: [0.35, 1.15, 4.4], target: [0, 0.98, 0], fov: 35 };
const heroShotMobile: CameraShot = { position: [0.2, 1.1, 3.9], target: [0, 0.95, 0], fov: 40 };

export const KEYFRAMES: Keyframe[] = [
  {
    id: "scene-0", beat: 0, hold: 0.55, morph: 1, status: "ready",
    resolvedness: 0.3, brandMix: 0, intensity: 0.8, stream: 0,
    camera: heroShot, cameraMobile: heroShotMobile,
  },
  {
    id: "scene-1-stream", beat: 1, hold: 0.45, morph: 0.9, status: "ready",
    resolvedness: 0.72, brandMix: 0, intensity: 1.9, stream: 0.22,
    camera: { position: [0, 1.9, 8.6], target: [0, 0.8, -1.2], fov: 38 },
    cameraMobile: { position: [0, 1.7, 7.4], target: [0, 0.85, -0.8], fov: 50 },
  },
  {
    id: "scene-1", beat: 1, hold: 0.6, morph: 1, status: "ready",
    resolvedness: 0.9, brandMix: 0, intensity: 1.5, stream: 0.22,
    camera: { position: [0.3, 1.45, 6.6], target: [0, 0.95, 0.4], fov: 36 },
    cameraMobile: { position: [0.1, 1.4, 6.4], target: [0, 0.9, 0.6], fov: 46 },
  },
  // ---- beats 2–6: stubs (hero standing) until their scenes are built ----
  { id: "scene-2", beat: 2, hold: 0.6, morph: 1, status: "stub", resolvedness: 0.85, brandMix: 0, intensity: 0.85, stream: 0, camera: heroShot, cameraMobile: heroShotMobile },
  { id: "scene-3", beat: 3, hold: 0.6, morph: 1, status: "stub", resolvedness: 0.9, brandMix: 0, intensity: 0.85, stream: 0, camera: heroShot, cameraMobile: heroShotMobile },
  { id: "scene-4", beat: 4, hold: 0.6, morph: 1, status: "stub", resolvedness: 0.95, brandMix: 0.5, intensity: 0.9, stream: 0, camera: heroShot, cameraMobile: heroShotMobile },
  { id: "scene-5", beat: 5, hold: 0.6, morph: 1, status: "stub", resolvedness: 0.95, brandMix: 0.8, intensity: 0.9, stream: 0, camera: heroShot, cameraMobile: heroShotMobile },
  { id: "scene-6", beat: 6, hold: 1, morph: 0, status: "stub", resolvedness: 1, brandMix: 1, intensity: 0.9, stream: 0, camera: heroShot, cameraMobile: heroShotMobile },
];

export interface TimelineState {
  /** Keyframe indices currently bound to aTargetA / aTargetB. */
  a: number;
  b: number;
  /** 0..1 eased morph between a and b. */
  morph: number;
  /** 0..1 progress through a's hold (for scene-internal motion: pulse, wave…). */
  phase: number;
  /** Copy beat to show. */
  beat: number;
}

const TOTAL = KEYFRAMES.reduce((s, k) => s + k.hold + k.morph, 0);

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Pure mapping from scroll progress (0..1) to the timeline. No hidden state, so
 * scrubbing backwards lands on exactly the same frame as scrolling forwards.
 */
export function resolveTimeline(progress: number, reducedMotion = false): TimelineState {
  let x = Math.min(1, Math.max(0, progress)) * TOTAL;
  const last = KEYFRAMES.length - 1;
  for (let i = 0; i <= last; i++) {
    const k = KEYFRAMES[i];
    const next = Math.min(i + 1, last);
    if (x <= k.hold || i === last) {
      return { a: i, b: next, morph: 0, phase: k.hold > 0 ? Math.min(1, x / k.hold) : 1, beat: k.beat };
    }
    x -= k.hold;
    if (x < k.morph) {
      const t = x / k.morph;
      if (reducedMotion) {
        // Static resolved states: snap at the midpoint, never show an in-between.
        const j = t < 0.5 ? i : next;
        return { a: j, b: j, morph: 0, phase: 1, beat: KEYFRAMES[j].beat };
      }
      const m = smooth(t);
      return { a: i, b: next, morph: m, phase: 1, beat: KEYFRAMES[m < 0.5 ? i : next].beat };
    }
    x -= k.morph;
  }
  return { a: last, b: last, morph: 0, phase: 1, beat: KEYFRAMES[last].beat };
}
