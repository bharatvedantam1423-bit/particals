import * as THREE from "three";
import { mulberry32, type Cloud } from "./types";

/**
 * One BufferGeometry for the whole page. Attributes are allocated once at
 * PARTICLE_COUNT and only ever have their contents overwritten — keyframes are
 * bound to the A / B slots by copying into the existing arrays.
 */
export function createParticleGeometry(count: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const dyn = (arr: Float32Array, size: number) => new THREE.BufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage);
  const a = dyn(new Float32Array(count * 3), 3);
  // `position` is required by three for draw-range / bounds; it mirrors aTargetA.
  g.setAttribute("position", a);
  g.setAttribute("aTargetA", a);
  g.setAttribute("aTargetB", dyn(new Float32Array(count * 3), 3));
  g.setAttribute("aDensity", dyn(new Float32Array(count * 2), 2));
  g.setAttribute("aRole", dyn(new Float32Array(count * 2), 2));
  const rnd = new Float32Array(count);
  const rng = mulberry32(77);
  for (let i = 0; i < count; i++) rnd[i] = rng();
  g.setAttribute("aRandom", new THREE.BufferAttribute(rnd, 1));
  // Particles move in the shader; a generous fixed sphere keeps frustum culling off our back.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 100);
  return g;
}

/** Copy a keyframe cloud into slot A (0) or B (1). No reallocation. */
export function bindKeyframe(g: THREE.BufferGeometry, slot: 0 | 1, cloud: Cloud) {
  const target = g.getAttribute(slot === 0 ? "aTargetA" : "aTargetB") as THREE.BufferAttribute;
  (target.array as Float32Array).set(cloud.positions);
  target.needsUpdate = true;
  const dens = g.getAttribute("aDensity") as THREE.BufferAttribute;
  const role = g.getAttribute("aRole") as THREE.BufferAttribute;
  const d = dens.array as Float32Array, r = role.array as Float32Array;
  for (let i = 0; i < cloud.count; i++) {
    d[i * 2 + slot] = cloud.density[i];
    r[i * 2 + slot] = cloud.role[i];
  }
  dens.needsUpdate = true;
  role.needsUpdate = true;
}
