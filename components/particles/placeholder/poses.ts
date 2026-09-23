import type { Pose, Vec3 } from "./rig";

/**
 * Hand-authored placeholder poses. Values are joint angles in degrees, kept
 * inside normal adult range of motion so silhouettes read as natural weight
 * bearing rather than mannequin T-poses. Replace with mocap-baked clouds later.
 */

/** Relaxed contrapposto: weight on the right leg, left knee soft, shoulders counter-tilted. */
export function standingRelaxed(): Pose {
  return {
    pelvisOffset: [-0.02, -0.01, 0],
    rot: {
      pelvis: [0, 4, -3],
      spine1: [2, 0, 2],
      spine2: [1, -2, 2],
      chest: [-2, -2, 1],
      neck: [6, 2, -1],
      head: [4, 3, 0],
      shoulderL: [-4, 0, 7],
      elbowL: [-12, 0, 0],
      wristL: [-4, 0, 3],
      shoulderR: [-2, 0, -5],
      elbowR: [-8, 0, 0],
      wristR: [-3, 0, -3],
      hipL: [-8, -6, 5],
      kneeL: [14, 0, 0],
      ankleL: [-6, 0, 0],
      hipR: [0, 4, 1],
      kneeR: [1, 0, 0],
      ankleR: [-1, 0, 0],
    },
  };
}

/**
 * Mid-stride walk, head down, both hands holding a phone at sternum height.
 * `phase` in radians drives the gait cycle so a crowd never walks in lock-step.
 */
export function walkingWithPhone(phase: number): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const legSwing = 22;
  return {
    pelvisOffset: [0, -0.015 + 0.01 * Math.abs(c), 0],
    rot: {
      pelvis: [2, 5 * s, 2 * c],
      spine1: [6, -3 * s, 0],
      spine2: [8, -2 * s, 0],
      chest: [4, 0, 0],
      neck: [26, 0, 0],
      head: [14, 0, 0],
      // phone grip: upper arm tucked, forearms forward and inward
      shoulderL: [-18, -24, 8],
      elbowL: [-92, 0, 0],
      wristL: [-10, 0, -10],
      shoulderR: [-18, 24, -8],
      elbowR: [-92, 0, 0],
      wristR: [-10, 0, 10],
      hipL: [-legSwing * s, 0, 2],
      kneeL: [8 + 30 * Math.max(0, -s) + 6 * Math.max(0, c), 0, 0],
      ankleL: [-4 + 8 * s, 0, 0],
      hipR: [legSwing * s, 0, -2],
      kneeR: [8 + 30 * Math.max(0, s) + 6 * Math.max(0, -c), 0, 0],
      ankleR: [-4 - 8 * s, 0, 0],
    },
  };
}

/** Standing tall, facing camera, phone lowered in the right hand — the "I'll build" beat. */
export function standingPhoneLowered(): Pose {
  return {
    pelvisOffset: [0.01, 0, 0],
    rot: {
      pelvis: [0, -2, 2],
      spine1: [-1, 0, -1],
      spine2: [-2, 1, -1],
      chest: [-3, 1, 0],
      neck: [2, 0, 0],
      head: [-2, 0, 0],
      shoulderL: [-2, 0, 6],
      elbowL: [-6, 0, 0],
      wristL: [-2, 0, 2],
      shoulderR: [-10, 12, -6],
      elbowR: [-48, 0, 0],
      wristR: [-18, 0, 0],
      hipL: [-1, -3, 2],
      kneeL: [2, 0, 0],
      ankleL: [-1, 0, 0],
      hipR: [-3, 4, -3],
      kneeR: [6, 0, 0],
      ankleR: [-3, 0, 0],
    },
  };
}

/** Where a hand-held glowing rectangle sits for a given pose (local helper data). */
export interface PropSpec {
  kind: "phone";
  hands: "both" | "right";
  size: Vec3; // width, height, thickness (m)
}

export const PHONE: Vec3 = [0.072, 0.15, 0.008];
