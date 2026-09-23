# NxtWave particle hero

A scroll-driven hero built as one GPU particle system. It morphs through 7
human-figure scenes as the user scrolls.

Stack: Next.js (app router) · TypeScript · three.js · @react-three/fiber · drei (`shaderMaterial`) · Lenis.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

## Status

| Beat | Scene | State |
|---|---|---|
| 0 | Standing figure, 40 % of particles drifting free | ✅ placeholder cloud + morph |
| 1 | Crowd stream with phones → hero steps out, turns, gets denser | ✅ two keyframes (`scene-1-stream` → `scene-1`) |
| 2–6 | Mentor, handshake, pulse, embrace, crowd rows | ⏳ stubbed as a standing hero. The copy, scroll length and colour ramp are in place |

The next step is to confirm the morph and scroll feel on scenes 0–1, then author scenes 2–6.

## Layout

```
components/
  ParticleHero.tsx            R3F canvas, copy overlay, and the scene controller (timeline → uniforms, camera, perf guard)
  ParticleHero.module.css     desktop: copy left, canvas right · mobile: stacked
  particles/
    sceneRegistry.ts          BEATS copy, KEYFRAMES (scroll weights, looseness, camera, palette), resolveTimeline()
    shaders.ts                GLSL: morph, crowd stream, analytic-gradient curl noise, size attenuation, soft sprites
    ParticleMaterial.ts       drei shaderMaterial: additive blending, depthWrite off
    geometry.ts               one BufferGeometry allocated once; keyframes are copied into the aTargetA / aTargetB slots
    cloudLoader.ts            .bin decode → resample to PARTICLE_COUNT → shuffle → nearest-neighbour index matching
    cloud.worker.ts           runs the loader off the main thread and streams keyframes back as each one is ready
    device.ts                 150k desktop / 40k mobile (matchMedia + pixel ratio)
    perfGuard.ts              if avg frame > 28 ms over 2 s → halve the draw range once
    placeholder/              procedural FK rig, poses and anatomy-weighted sampler (runs before real assets land)
lib/scroll.ts                 Lenis, prefers-reduced-motion, section progress (0..1) from window scroll
scripts/bake-clouds.md        .bin format + Blender/Houdini export guide for artists
scripts/export-placeholders.ts writes the placeholders as .bin (format reference + round-trip check)
```

## How it works

- **One `THREE.Points`**, with a fixed count that is never re-allocated. The
  attributes are `aTargetA`, `aTargetB` (vec3), `aRandom`, `aDensity` and `aRole`.
  `aDensity` and `aRole` are vec2 (`.x` for slot A, `.y` for slot B) because
  density and role change per scene.
- **The timeline is a pure function of scroll progress** (`resolveTimeline`).
  Each keyframe has a *hold* (resolved) span and a *morph* span. Scrubbing
  backwards gives exactly the same frames as scrolling forwards.
- **Index coherence.** Keyframe 0 is shuffled, so any prefix of it is a uniform
  subsample. That's what lets the perf guard halve the count with
  `setDrawRange`. Each later keyframe is re-ordered to match the one before it in
  three passes:
  1. greedy nearest neighbour between hero points, relative to each hero's centroid
  2. greedy nearest neighbour within the same role, so crowds pair 1:1
  3. Morton-order rank pairing for the rest
- **Shader.** A per-particle staggered morph, plus curl noise scaled by
  `(1 - uResolvedness)`, by the density edge and by mid-flight transit. Sprites
  are sized in world units. The hero always gets a brightness boost. The palette
  goes from cool `#dce9ff → #6ea8ff` toward brand blue via `uBrandMix`. `uPulse`
  is a Y-band for scene 4.
- **Reduced motion.** Scroll snaps between fully resolved keyframes. There's no
  time-based motion and no Lenis.
- **Performance.** DPR is capped at 2. The render loop stops (`frameloop="never"`)
  while the canvas is off-screen. Clouds are built in a worker. `?noguard`
  disables the perf guard, which is useful for profiling and for screenshots on
  software GL.

## Real assets

Drop `public/clouds/<keyframe-id>.bin` files in and build with
`NEXT_PUBLIC_BAKED_CLOUDS=1`. Any keyframe whose file is missing falls back to its
placeholder. The format and the export steps are in
[`scripts/bake-clouds.md`](scripts/bake-clouds.md).
