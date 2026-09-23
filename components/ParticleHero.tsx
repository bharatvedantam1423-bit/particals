"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLenis, useReducedMotion, useSectionProgress } from "@/lib/scroll";
import { BEATS, KEYFRAMES, resolveTimeline, type CameraShot } from "./particles/sceneRegistry";
import { bindKeyframe, createParticleGeometry } from "./particles/geometry";
import { PARTICLES_DESKTOP, useDeviceProfile } from "./particles/device";
import { PerfGuard } from "./particles/perfGuard";
import type { Cloud } from "./particles/types";
import type { CloudMessage, CloudRequest } from "./particles/cloud.worker";
import "./particles/ParticleMaterial";
import type { ParticleShaderMaterialImpl } from "./particles/ParticleMaterial";
import styles from "./ParticleHero.module.css";

/** Viewport heights of scroll per unit of keyframe weight (hold + morph). */
const VH_PER_WEIGHT = 70;
const TOTAL_WEIGHT = KEYFRAMES.reduce((s, k) => s + k.hold + k.morph, 0);

export default function ParticleHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const device = useDeviceProfile();
  const [beat, setBeat] = useState(0);
  const [inView, setInView] = useState(true);

  useLenis(!reduced);
  const progress = useSectionProgress(
    sectionRef,
    useCallback((p: number) => setBeat(resolveTimeline(p, reduced).beat), [reduced]),
  );

  // Pause the render loop entirely while the canvas is off-screen.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={styles.hero}
      style={{ height: `${100 + TOTAL_WEIGHT * VH_PER_WEIGHT}vh` }}
      aria-label="NxtWave — from learning to offer letter"
    >
      <div className={styles.sticky}>
        <div className={styles.copy}>
          {BEATS.map((text, i) => {
            const Tag = i === 0 ? "h1" : "h2";
            return (
              <Tag
                key={i}
                className={styles.beat}
                data-active={i === beat || undefined}
                aria-current={i === beat ? "step" : undefined}
              >
                {text}
              </Tag>
            );
          })}
        </div>
        <div ref={stageRef} className={styles.stage} aria-hidden="true">
          {device && (
            <Canvas
              frameloop={inView ? "always" : "never"}
              dpr={[1, 2]}
              gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
              camera={{ fov: 35, near: 0.1, far: 60, position: [0, 1.2, 5] }}
            >
              <ParticleField count={device.count} narrow={device.narrow} reduced={reduced} progress={progress} />
            </Canvas>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- loading

/** Streams keyframe clouds from the worker as each one is resampled + matched. */
function useKeyframeClouds(count: number) {
  const clouds = useRef<(Cloud | undefined)[]>([]);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    clouds.current = [];
    setReady(0);
    const req: CloudRequest = {
      ids: KEYFRAMES.map((k) => k.id),
      count,
      baked: process.env.NEXT_PUBLIC_BAKED_CLOUDS === "1",
      baseUrl: window.location.origin,
    };
    const accept = (index: number, cloud: Cloud) => {
      clouds.current[index] = cloud;
      setReady((r) => Math.max(r, index + 1));
    };

    let worker: Worker | null = null;
    let cancelled = false;
    try {
      worker = new Worker(new URL("./particles/cloud.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<CloudMessage>) => {
        if (e.data.type === "keyframe") accept(e.data.index, e.data.cloud);
        else console.error("[ParticleHero]", e.data.message);
      };
      worker.postMessage(req);
    } catch {
      // No module workers: build on the main thread (slower first paint, same result).
      import("./particles/cloudLoader").then(({ buildClouds }) =>
        buildClouds({ ...req, onKeyframe: (i, c) => !cancelled && accept(i, c) }),
      );
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [count]);

  return { clouds, ready };
}

// ---------------------------------------------------------------- scene controller

const tmpPos = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const drift = new THREE.Vector3();

function lerpShot(a: CameraShot, b: CameraShot, t: number, cam: THREE.PerspectiveCamera, drift: THREE.Vector3) {
  tmpPos.set(...a.position).lerp(tmpTarget.set(...b.position), t);
  cam.position.copy(tmpPos).add(drift);
  tmpTarget.set(...a.target).lerp(tmpPos.set(...b.target), t);
  const fov = a.fov + (b.fov - a.fov) * t;
  if (Math.abs(cam.fov - fov) > 1e-3) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
  cam.lookAt(tmpTarget);
}

interface FieldProps {
  count: number;
  narrow: boolean;
  reduced: boolean;
  progress: RefObject<number>;
}

function ParticleField({ count, narrow, reduced, progress }: FieldProps) {
  const geometry = useMemo(() => createParticleGeometry(count), [count]);
  const material = useRef<ParticleShaderMaterialImpl>(null);
  const points = useRef<THREE.Points>(null);
  const bound = useRef<[number, number]>([-1, -1]);
  // `?noguard` disables the perf guard (useful when profiling or screenshotting on software GL).
  const guard = useMemo(() => new PerfGuard(28, 2, 1.5, typeof window !== "undefined" && new URLSearchParams(window.location.search).has("noguard")), []);
  const fade = useRef(0);
  const active = useRef(count); // drawn particles (halved once by the perf guard)
  const { clouds, ready } = useKeyframeClouds(count);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    bound.current = [-1, -1]; // fresh geometry → nothing bound yet
  }, [geometry]);

  useFrame((state, delta) => {
    const mat = material.current;
    if (!mat || ready === 0) {
      if (points.current) points.current.visible = false;
      return;
    }
    points.current!.visible = true;

    const tl = resolveTimeline(progress.current ?? 0, reduced);
    // Until later keyframes have streamed in, hold on the last one available.
    const last = ready - 1;
    const a = Math.min(tl.a, last);
    const b = Math.min(tl.b, last);
    const morph = tl.b > last ? 0 : tl.morph;

    if (bound.current[0] !== a) { bindKeyframe(geometry, 0, clouds.current[a]!); bound.current[0] = a; }
    if (bound.current[1] !== b) { bindKeyframe(geometry, 1, clouds.current[b]!); bound.current[1] = b; }

    const ka = KEYFRAMES[a], kb = KEYFRAMES[b];
    const mix = (x: number, y: number) => x + (y - x) * morph;
    fade.current = reduced ? 1 : Math.min(1, fade.current + delta / 1.4);

    const u = mat.uniforms;
    u.uTime.value = reduced ? 0 : state.clock.elapsedTime;
    u.uMorph.value = morph;
    u.uResolvedness.value = reduced ? 1 : mix(ka.resolvedness, kb.resolvedness);
    u.uBrandMix.value = mix(ka.brandMix, kb.brandMix);
    // Fewer particles (mobile budget / perf guard) → larger, brighter sprites so
    // silhouettes keep the same visual weight. Tuned against the desktop count.
    const sparse = PARTICLES_DESKTOP / active.current;
    u.uSizeScale.value = Math.pow(sparse, 0.25);
    u.uIntensity.value = mix(ka.intensity, kb.intensity) * fade.current * Math.pow(sparse, 0.35);
    u.uStreamA.value = ka.stream;
    u.uStreamB.value = kb.stream;
    u.uViewportH.value = state.size.height * state.viewport.dpr;
    u.uPulse.value = -10; // scene 4 drives this from tl.phase once authored

    const shotA = (narrow && ka.cameraMobile) || ka.camera;
    const shotB = (narrow && kb.cameraMobile) || kb.camera;
    // Barely-there handheld drift so resolved holds still feel alive.
    const t = state.clock.elapsedTime;
    drift.set(reduced ? 0 : Math.sin(t * 0.21) * 0.04, reduced ? 0 : Math.sin(t * 0.17 + 1.3) * 0.025, 0);
    lerpShot(shotA, shotB, morph, camera, drift);

    if (guard.tick(delta)) {
      // Clouds are shuffled at load, so any prefix is a uniform subsample.
      active.current = Math.floor(count / 2);
      geometry.setDrawRange(0, active.current);
      console.info("[ParticleHero] perf guard: halved particle count");
    }
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <particleShaderMaterial ref={material} />
    </points>
  );
}
