# Baking scene clouds (`.bin`) for the particle hero

The hero renders one fixed pool of particles that morphs between **keyframe clouds**.
Each keyframe is a single binary file in `public/clouds/`. This document is the
contract between the 3D side (Blender / Houdini) and the web runtime.

You do **not** need to match point counts or point order between scenes — the
loader resamples every cloud to the device's particle budget and re-indexes
points so particle *i* is the same particle in every scene.

---

## 1. Files

| Keyframe id        | Beat | What it shows |
|--------------------|------|---------------|
| `scene-0`          | 0    | One figure standing; ~40 % of points drifting free of the body |
| `scene-1-stream`   | 1    | Crowd walking sideways, heads down over glowing phones; hero among them |
| `scene-1`          | 1    | Same crowd; hero stepped forward, turned to camera, denser |
| `scene-2`          | 2    | Seated hero at desk + laptop; mentor standing, hand on shoulder |
| `scene-3`          | 3    | Hero gesturing, small geometric structures; second figure; handshake |
| `scene-4`          | 4    | Hero alone holding a glowing rectangle; fist raised |
| `scene-5`          | 5    | Two more figures join; three-way embrace, one silhouette |
| `scene-6`          | 6    | Hundreds of standing figures in receding rows |

Path: `public/clouds/<id>.bin`. The list lives in
`components/particles/sceneRegistry.ts` (`KEYFRAMES`). A beat can have extra
keyframes for internal motion (like `scene-1-stream` → `scene-1`); add a row there
and name the file to match.

The site uses the procedural placeholders until you turn baked clouds on with
`NEXT_PUBLIC_BAKED_CLOUDS=1`. If a file is missing or can't be read, that
keyframe falls back to its placeholder.

---

## 2. Coordinate system and scale

- **Units: metres.** The adult hero is ~1.75 m tall.
- **Y up**, **+Z toward camera**, floor at **y = 0**.
- The hero stands at the origin, facing +Z, unless the scene calls for something else.
- Blender is Z-up. Convert on export with `(x, y, z)_web = (x, z, -y)_blender`.
  Houdini is already Y-up.
- Crowd scenes can span roughly x ∈ [-7, 7] and z ∈ [-6, 1.5]. Points with the
  STREAM role wrap across x ∈ [-7, 7] (`STREAM_HALF_WIDTH` in `placeholder/scenes.ts`).

---

## 3. Binary layout

Everything is **little-endian**. Use the headered v1 layout. The loader also
reads the raw layout below it.

### v1 (preferred)

```
offset  size            field
0       4               magic  "NXPC" (0x4E 0x58 0x50 0x43)
4       u32             version = 1
8       u32             count  N
12      u32             flags  (bit 0 = role bytes present)
16      f32 × 3N        positions  x0 y0 z0 x1 y1 z1 …
16+12N  f32 × N         density    0..1
16+16N  u8  × N         role       (only if flags & 1)
```

### Raw (no header)

```
f32 × 3N  positions
f32 × N   density
```

N is `byteLength / 16`. Raw clouds have no role data, so every point is treated
as the hero. Use v1 for any scene with more than one figure.

### Role byte (bitfield)

| bit | value | meaning |
|-----|-------|---------|
| 0   | 1     | **HERO**: the protagonist. Always renders brightest, and the matcher keeps hero points on the hero between scenes |
| 1   | 2     | **GLOW**: emissive prop (phone or laptop screen, the offer-letter rectangle) |
| 2   | 4     | **STREAM**: drifts sideways with the crowd (scene 1) |

Bits combine. The hero's phone is `HERO | GLOW = 3`, and a crowd member's phone is
`STREAM | GLOW = 6`. A point with role `0` is an ambient or free mote, or a
non-hero figure in a scene that doesn't stream.

---

## 4. What *density* means

`density` is a per-point anatomy weight in 0..1:

- **1.0** on a bone line: the spine, rib arcs, clavicles, joint centres and limb centrelines.
- It falls off toward the **silhouette edge**, where it is **0**.
- Hands and feet stay low, around ≤ 0.4, even at their centre.
- Free-drifting motes are **0**.

The shader uses it to set sprite size and brightness, and to set how loose a
point is. Low-density points drift more and dissolve at the boundary. Emotion
is carried by brightness and density, not hue, so it's worth getting this right.

**Point distribution matters as much as the value.** Put more points where
density is high. The placeholder gets roughly the right look from:

| region | share of a figure's points |
|---|---|
| spine + rib arcs + ribcage volume | ~20 % |
| pelvis + abdomen | ~10 % |
| head + neck | ~10 % |
| arms (upper/fore) | ~12 % |
| legs (thigh/shin) | ~22 % |
| hands + feet | ≤ 4 % |
| joints (small dense spheres) | ~6 % |
| edge motes just outside the skin (density 0) | 5–10 % |

### Recipe

For each sampled point `p`:

1. `d` is the distance from `p` to the nearest **bone segment** of the rig (the
   deform bones, or a hand-drawn "anatomy curve" set: spine, rib arcs, limb axes).
2. `r` is the local body radius at that bone: the distance from the bone to the
   mesh surface along the same perpendicular. Pre-compute it per bone or sample it.
3. `density = clamp(1 - d / r, 0, 1) ^ 0.8`
4. Multiply by 0.4 on hands and feet.

Mesh rules: no clothing, no hair, **no facial features**. The head is a smooth
anatomical cranium and jaw volume.

---

## 5. Point counts

- Export **150k to 300k points per keyframe**. The loader takes a random
  subsample if a cloud is bigger than the budget (150k desktop, 40k mobile), and
  repeats points with jitter if it's smaller.
- The placeholder splits one scene's points across its figures roughly like this:
  - scene 0: hero 60 %, free motes 40 %
  - scene 1: crowd 74 %, hero 8 % → 22 %, the rest motes
- Size on disk is about 17 bytes per point, so 150k points is about 2.5 MB
  uncompressed. The server should gzip or brotli-compress `.bin` files, which
  typically shrinks them 2–3×.

---

## 6. Blender (Geometry Nodes + Python)

1. **Surface + volume samples.** On the figure mesh: *Mesh to Volume* → *Distribute
   Points in Volume* (for interior points), plus *Distribute Points on Faces*
   (about 30 %, for the silhouette). Join them.
2. **Skeleton proximity.** Convert the armature's deform bones to curves (or
   draw anatomy curves). Use *Geometry Proximity* (target = curves) to get `d`,
   and *Sample Nearest Surface* (or a stored per-bone radius) to get `r`. Store
   `density` as a float point attribute using the recipe above.
3. **Role.** Store an int attribute `role` (1 on the hero object, 6 on crowd
   phones, and so on). Assigning it per object and joining is the easiest way.
4. **Export** with this script (run it with the evaluated object selected):

```python
import bpy, struct, numpy as np

obj = bpy.context.active_object.evaluated_get(bpy.context.evaluated_depsgraph_get())
mesh = obj.to_mesh()
n = len(mesh.vertices)
co = np.empty(n * 3, dtype=np.float32); mesh.vertices.foreach_get("co", co)
co = co.reshape(-1, 3) @ np.array(obj.matrix_world)[:3, :3].T + np.array(obj.matrix_world)[:3, 3]
xyz = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1).astype("<f4")   # Z-up → Y-up
dens = np.empty(n, dtype=np.float32); mesh.attributes["density"].data.foreach_get("value", dens)
role = np.zeros(n, dtype=np.int32)
if "role" in mesh.attributes:
    mesh.attributes["role"].data.foreach_get("value", role)
with open(bpy.path.abspath("//scene-0.bin"), "wb") as f:
    f.write(b"NXPC" + struct.pack("<III", 1, n, 1))
    f.write(xyz.tobytes()); f.write(dens.astype("<f4").tobytes()); f.write(role.astype("u1").tobytes())
obj.to_mesh_clear()
```

## 7. Houdini

```
figure SOP ─► Scatter (volume, ~200k) ─┐
                                       ├─► Merge ─► Attribute Wrangle (density) ─► Python SOP (write .bin)
figure SOP ─► Scatter (surface, ~60k) ─┘
skeleton curves ─────────────────────────► (2nd input of the wrangle)
```

Density wrangle (Point, input 1 = skeleton curves with a `radius` point attribute):

```c
int prim; vector uv;
float d = xyzdist(1, @P, prim, uv);
float r = primuv(1, "radius", prim, uv);
f@density = pow(clamp(1 - d / r, 0, 1), 0.8);
if (i@is_extremity) f@density *= 0.4;
```

Write the file from a Python SOP with the same `struct` layout as the Blender
script (`hou.Geometry.pointFloatAttribValues("P")` and friends). Houdini is
Y-up, so don't swap axes.

---

## 8. Checking your export

```bash
# reference files in the exact format (also a round-trip check of the decoder)
npx tsx scripts/export-placeholders.ts 150000

# run the site against baked files
NEXT_PUBLIC_BAKED_CLOUDS=1 npm run dev
```

Before you export, check:

- The figure stands on y = 0 and faces +Z, and the hero is about 1.75 m tall.
- Density is 1 on the spine and 0 at the skin edge, and hands and feet stay dim.
- The hero has role bit 1 set in every scene.
- There are no NaN or Inf values. Degenerate or empty regions produce them.
- There are no facial features, hair or clothing geometry in the source mesh.
