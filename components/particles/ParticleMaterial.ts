import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei";
import { extend, type ThreeElement } from "@react-three/fiber";
import { fragmentShader, vertexShader } from "./shaders";
import { STREAM_HALF_WIDTH } from "./placeholder/scenes";

/** Palette. Scenes 0–3 stay in the cool white-blue ramp; 4–6 blend to brand. */
export const COLOR_CORE = "#dce9ff";
export const COLOR_EDGE = "#6ea8ff";
// NxtWave brand blue — confirm the exact token with the brand team.
export const COLOR_BRAND = "#2f6bff";

const ParticleShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uMorph: 0,
    uResolvedness: 1,
    uIntensity: 1,
    uBrandMix: 0,
    uPulse: -10,
    uStreamA: 0,
    uStreamB: 0,
    uStreamHalfWidth: STREAM_HALF_WIDTH,
    uSize: 0.012,
    uSizeScale: 1,
    uViewportH: 800,
    uColorCore: new THREE.Color(COLOR_CORE),
    uColorEdge: new THREE.Color(COLOR_EDGE),
    uColorBrand: new THREE.Color(COLOR_BRAND),
  },
  vertexShader,
  fragmentShader,
  (material) => {
    if (!material) return;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.blending = THREE.AdditiveBlending;
  },
);

extend({ ParticleShaderMaterial });

export type ParticleShaderMaterialImpl = THREE.ShaderMaterial & {
  uniforms: Record<string, THREE.IUniform>;
};

declare module "@react-three/fiber" {
  interface ThreeElements {
    particleShaderMaterial: ThreeElement<typeof ParticleShaderMaterial>;
  }
}

export { ParticleShaderMaterial };
