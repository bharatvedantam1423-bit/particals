/**
 * Minimal forward-kinematics rig for placeholder figures.
 *
 * Proportions follow a 1.75 m adult (Drillis & Contini segment ratios):
 * hip joint ≈ 0.53 H, shoulder ≈ 0.82 H, C7 ≈ 0.85 H, knee ≈ 0.28 H.
 * Rest pose: standing, arms hanging, facing +z (toward camera), y-up.
 *
 * Rotation conventions (degrees, applied intrinsic Y → X → Z):
 *  - X+ bends the spine / neck forward, flexes the knee backward.
 *  - X− flexes hip, shoulder and elbow forward.
 *  - Z+ abducts the LEFT arm / leg outward (+x); Z− abducts the right.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x y z w

export type JointName =
  | "pelvis" | "spine1" | "spine2" | "chest" | "neck" | "head"
  | "shoulderL" | "elbowL" | "wristL" | "handL"
  | "shoulderR" | "elbowR" | "wristR" | "handR"
  | "hipL" | "kneeL" | "ankleL" | "toeL"
  | "hipR" | "kneeR" | "ankleR" | "toeR";

interface JointDef {
  name: JointName;
  parent: JointName | null;
  offset: Vec3; // rest offset from parent, in the parent's frame
}

const S = 0.19; // half shoulder (glenohumeral) width
const H = 0.09; // half hip-joint width

export const JOINTS: JointDef[] = [
  { name: "pelvis", parent: null, offset: [0, 0.98, 0] },
  { name: "spine1", parent: "pelvis", offset: [0, 0.12, -0.015] }, // L1
  { name: "spine2", parent: "spine1", offset: [0, 0.16, -0.01] }, // T8
  { name: "chest", parent: "spine2", offset: [0, 0.22, 0.0] }, // C7
  { name: "neck", parent: "chest", offset: [0, 0.08, 0.025] }, // C1 / skull base
  { name: "head", parent: "neck", offset: [0, 0.02, 0.01] },

  { name: "shoulderL", parent: "chest", offset: [S, -0.06, 0.02] },
  { name: "elbowL", parent: "shoulderL", offset: [0, -0.29, 0] },
  { name: "wristL", parent: "elbowL", offset: [0, -0.25, 0] },
  { name: "handL", parent: "wristL", offset: [0, -0.18, 0] },
  { name: "shoulderR", parent: "chest", offset: [-S, -0.06, 0.02] },
  { name: "elbowR", parent: "shoulderR", offset: [0, -0.29, 0] },
  { name: "wristR", parent: "elbowR", offset: [0, -0.25, 0] },
  { name: "handR", parent: "wristR", offset: [0, -0.18, 0] },

  { name: "hipL", parent: "pelvis", offset: [H, -0.06, 0] },
  { name: "kneeL", parent: "hipL", offset: [0, -0.43, 0] },
  { name: "ankleL", parent: "kneeL", offset: [0, -0.41, 0] },
  { name: "toeL", parent: "ankleL", offset: [0.01, -0.06, 0.15] },
  { name: "hipR", parent: "pelvis", offset: [-H, -0.06, 0] },
  { name: "kneeR", parent: "hipR", offset: [0, -0.43, 0] },
  { name: "ankleR", parent: "kneeR", offset: [0, -0.41, 0] },
  { name: "toeR", parent: "ankleR", offset: [-0.01, -0.06, 0.15] },
];

export interface Pose {
  /** Joint rotations in degrees [x, y, z]. Missing joints stay at rest. */
  rot: Partial<Record<JointName, Vec3>>;
  /** Extra pelvis translation (e.g. weight shift / sitting). */
  pelvisOffset?: Vec3;
}

export interface Placement {
  position: Vec3; // world position of the figure's floor origin
  yaw: number; // degrees about +y; 0 faces camera, 90 faces +x
  scale: number;
}

export interface JointXf {
  p: Vec3; // world position
  q: Quat; // world rotation
}

export type Skeleton = Record<JointName, JointXf>;

// ---------------------------------------------------------------- math

export function quatFromAxisAngle(ax: number, ay: number, az: number, rad: number): Quat {
  const s = Math.sin(rad / 2);
  return [ax * s, ay * s, az * s, Math.cos(rad / 2)];
}

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [x, y, z] = v;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

const D2R = Math.PI / 180;

function eulerYXZ(deg: Vec3): Quat {
  const qy = quatFromAxisAngle(0, 1, 0, deg[1] * D2R);
  const qx = quatFromAxisAngle(1, 0, 0, deg[0] * D2R);
  const qz = quatFromAxisAngle(0, 0, 1, deg[2] * D2R);
  return quatMul(quatMul(qy, qx), qz);
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => scale3(a, 1 / (len(a) || 1));
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// ---------------------------------------------------------------- FK

export function solve(pose: Pose, place: Placement): Skeleton {
  const out = {} as Skeleton;
  const rootQ = quatFromAxisAngle(0, 1, 0, place.yaw * D2R);
  for (const j of JOINTS) {
    const local = pose.rot[j.name] ? eulerYXZ(pose.rot[j.name]!) : ([0, 0, 0, 1] as Quat);
    if (!j.parent) {
      const off = add(j.offset, pose.pelvisOffset ?? [0, 0, 0]);
      const p = add(place.position, rotate(rootQ, scale3(off, place.scale)));
      out[j.name] = { p, q: quatMul(rootQ, local) };
    } else {
      const parent = out[j.parent];
      const p = add(parent.p, rotate(parent.q, scale3(j.offset, place.scale)));
      out[j.name] = { p, q: quatMul(parent.q, local) };
    }
  }
  return out;
}

/** Transform a point given in a joint's local frame to world space. */
export function toWorld(sk: Skeleton, joint: JointName, local: Vec3, s: number): Vec3 {
  const j = sk[joint];
  return add(j.p, rotate(j.q, scale3(local, s)));
}
