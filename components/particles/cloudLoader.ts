/**
 * Cloud loading pipeline (pure TS — runs inside the worker, or on the main
 * thread as a fallback):
 *
 *   fetch /clouds/<id>.bin  ──or──  procedural placeholder
 *        → resample to exactly PARTICLE_COUNT
 *        → (keyframe 0 only) shuffle, so any prefix is a uniform subsample
 *        → match to the previous keyframe so index i is the same particle everywhere
 */
import { allocCloud, gaussian, mulberry32, ROLE_HERO, type Cloud, type Rng } from "./types";
import { PLACEHOLDER_BUILDERS } from "./placeholder/scenes";

// ------------------------------------------------------------------ decode

const MAGIC = 0x4350584e; // "NXPC" little-endian
const FLAG_ROLE = 1;

/**
 * Decodes a .bin cloud. Two layouts are accepted (see scripts/bake-clouds.md):
 *  - headered v1: "NXPC" | u32 version | u32 count | u32 flags | f32 xyz[count*3] | f32 density[count] | u8 role[count]?
 *  - raw:         f32 xyz[count*3] | f32 density[count]  (count = byteLength / 16)
 */
export function decodeCloud(buf: ArrayBuffer): Cloud {
  const view = new DataView(buf);
  if (buf.byteLength >= 16 && view.getUint32(0, true) === MAGIC) {
    const version = view.getUint32(4, true);
    if (version !== 1) throw new Error(`Unsupported cloud version ${version}`);
    const count = view.getUint32(8, true);
    const flags = view.getUint32(12, true);
    const positions = new Float32Array(buf.slice(16, 16 + count * 12));
    const density = new Float32Array(buf.slice(16 + count * 12, 16 + count * 16));
    const role = new Float32Array(count);
    if (flags & FLAG_ROLE) {
      const bytes = new Uint8Array(buf, 16 + count * 16, count);
      for (let i = 0; i < count; i++) role[i] = bytes[i];
    }
    return { count, positions, density, role };
  }
  if (buf.byteLength % 16 !== 0) throw new Error("Raw cloud must be count * 16 bytes (xyz + density)");
  const count = buf.byteLength / 16;
  return {
    count,
    positions: new Float32Array(buf, 0, count * 3),
    density: new Float32Array(buf, count * 12, count),
    // Raw clouds carry no roles: treat every point as the hero figure.
    role: new Float32Array(count).fill(ROLE_HERO),
  };
}

// ------------------------------------------------------------------ resample

/** Repeat-with-jitter when smaller than `target`, random subsample when larger. */
export function resample(src: Cloud, target: number, rng: Rng): Cloud {
  if (src.count === target) return src;
  const out = allocCloud(target);
  const copy = (to: number, from: number, jitter: number) => {
    out.positions[to * 3] = src.positions[from * 3] + (jitter ? gaussian(rng) * jitter : 0);
    out.positions[to * 3 + 1] = src.positions[from * 3 + 1] + (jitter ? gaussian(rng) * jitter : 0);
    out.positions[to * 3 + 2] = src.positions[from * 3 + 2] + (jitter ? gaussian(rng) * jitter : 0);
    out.density[to] = src.density[from];
    out.role[to] = src.role[from];
  };
  if (src.count > target) {
    // Partial Fisher–Yates over an index array: uniform subsample without replacement.
    const idx = new Uint32Array(src.count);
    for (let i = 0; i < src.count; i++) idx[i] = i;
    for (let i = 0; i < target; i++) {
      const j = i + Math.floor(rng() * (src.count - i));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
      copy(i, idx[i], 0);
    }
  } else {
    // Jitter scales with the average spacing so repeats fill gaps instead of stacking.
    const bb = bounds(src.positions, src.count);
    const vol = Math.max(1e-6, (bb[3] - bb[0]) * (bb[4] - bb[1]) * (bb[5] - bb[2]));
    const jitter = 0.35 * Math.cbrt(vol / src.count);
    for (let i = 0; i < target; i++) copy(i, i < src.count ? i : Math.floor(rng() * src.count), i < src.count ? 0 : jitter);
  }
  return out;
}

export function shuffle(c: Cloud, rng: Rng): Cloud {
  const out = allocCloud(c.count);
  const idx = new Uint32Array(c.count);
  for (let i = 0; i < c.count; i++) idx[i] = i;
  for (let i = c.count - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return permute(c, idx);
}

/** out[i] = c[order[i]] */
function permute(c: Cloud, order: Uint32Array): Cloud {
  const out = allocCloud(c.count);
  for (let i = 0; i < c.count; i++) {
    const s = order[i];
    out.positions[i * 3] = c.positions[s * 3];
    out.positions[i * 3 + 1] = c.positions[s * 3 + 1];
    out.positions[i * 3 + 2] = c.positions[s * 3 + 2];
    out.density[i] = c.density[s];
    out.role[i] = c.role[s];
  }
  return out;
}

function bounds(p: Float32Array, n: number, idx?: ArrayLike<number>, m = n) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m; k++) {
    const i = idx ? idx[k] : k;
    for (let a = 0; a < 3; a++) {
      const v = p[i * 3 + a];
      if (v < b[a]) b[a] = v;
      if (v > b[a + 3]) b[a + 3] = v;
    }
  }
  return b;
}

// ------------------------------------------------------------------ matching

/**
 * Dense uniform grid over a pool of candidate points, used for greedy
 * nearest-neighbour assignment. Typed arrays only — this runs on 150k points
 * per keyframe, so no per-query allocation.
 */
class PointPool {
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private ids: Int32Array; // member id per slot
  private taken: Uint8Array; // per slot
  private cellStart!: Int32Array; private cellLive!: Int32Array; private items!: Int32Array; private posOf!: Int32Array;
  private dim: [number, number, number] = [1, 1, 1]; private min: [number, number, number] = [0, 0, 0]; private inv = 1;
  private remaining: number; private indexed = 0;

  constructor(p: Float32Array, members: number[], offset: [number, number, number]) {
    const m = members.length;
    this.remaining = m;
    this.ids = Int32Array.from(members);
    this.px = new Float32Array(m); this.py = new Float32Array(m); this.pz = new Float32Array(m);
    for (let s = 0; s < m; s++) {
      const i = members[s];
      this.px[s] = p[i * 3] - offset[0];
      this.py[s] = p[i * 3 + 1] - offset[1];
      this.pz[s] = p[i * 3 + 2] - offset[2];
    }
    this.taken = new Uint8Array(m);
    this.index();
  }

  /**
   * (Re)builds the grid over the slots still free. Called again whenever the
   * pool thins to a quarter, so late queries never scan wide empty regions.
   */
  private index() {
    const live: number[] = [];
    for (let s = 0; s < this.ids.length; s++) if (!this.taken[s]) live.push(s);
    const m = live.length;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const s of live) {
      const x = this.px[s], y = this.py[s], z = this.pz[s];
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
      if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
    }
    const ex = x1 - x0 + 1e-3, ey = y1 - y0 + 1e-3, ez = z1 - z0 + 1e-3;
    // ~0.5 points per cell over the bounds (clouds are clumpy), capped at 2M cells.
    let cell = Math.max(0.004, Math.cbrt((ex * ey * ez * 0.5) / Math.max(1, m)));
    while (Math.ceil(ex / cell) * Math.ceil(ey / cell) * Math.ceil(ez / cell) > 2_000_000) cell *= 1.25;
    this.inv = 1 / cell;
    this.min = [x0, y0, z0];
    this.dim = [Math.ceil(ex / cell) + 1, Math.ceil(ey / cell) + 1, Math.ceil(ez / cell) + 1];
    const total = this.dim[0] * this.dim[1] * this.dim[2];
    this.cellStart = new Int32Array(total + 1);
    this.cellLive = new Int32Array(total);
    const cellOf = new Int32Array(m);
    live.forEach((s, k) => {
      const c = this.cellIndex(this.px[s], this.py[s], this.pz[s]);
      cellOf[k] = c; this.cellLive[c]++;
    });
    for (let c = 0; c < total; c++) this.cellStart[c + 1] = this.cellStart[c] + this.cellLive[c];
    const fill = this.cellStart.slice(0, total);
    this.items = new Int32Array(m);
    this.posOf = new Int32Array(this.ids.length);
    live.forEach((s, k) => { const t = fill[cellOf[k]]++; this.items[t] = s; this.posOf[s] = t; });
    this.indexed = m;
  }

  get size() { return this.remaining; }

  private axis(v: number, a: 0 | 1 | 2) {
    const c = Math.floor((v - this.min[a]) * this.inv);
    return c < 0 ? 0 : c >= this.dim[a] ? this.dim[a] - 1 : c;
  }
  private cellIndex(x: number, y: number, z: number) {
    return this.axis(x, 0) + this.dim[0] * (this.axis(y, 1) + this.dim[1] * this.axis(z, 2));
  }

  /** Remove and return the member id (approximately) nearest to (x, y, z). */
  nearest(x: number, y: number, z: number, rng: Rng): number {
    if (this.remaining > 64 && this.remaining * 4 < this.indexed) this.index();
    const cx = this.axis(x, 0), cy = this.axis(y, 1), cz = this.axis(z, 2);
    const [dx, dy] = this.dim;
    let best = -1, bestD = Infinity, found = -1;
    const maxR = 4;
    for (let r = 0; r <= maxR; r++) {
      for (let k = cz - r; k <= cz + r; k++) {
        if (k < 0 || k >= this.dim[2]) continue;
        for (let j = cy - r; j <= cy + r; j++) {
          if (j < 0 || j >= dy) continue;
          const edgeJK = Math.abs(k - cz) === r || Math.abs(j - cy) === r;
          for (let i = cx - r; i <= cx + r; i += edgeJK ? 1 : 2 * r || 1) {
            if (i < 0 || i >= dx) continue;
            const c = i + dx * (j + dy * k);
            const end = this.cellStart[c] + this.cellLive[c]; // live items are packed at the front
            for (let t = this.cellStart[c]; t < end; t++) {
              const s = this.items[t];
              const ddx = this.px[s] - x, ddy = this.py[s] - y, ddz = this.pz[s] - z;
              const d = ddx * ddx + ddy * ddy + ddz * ddz;
              if (d < bestD) { bestD = d; best = s; }
            }
          }
        }
      }
      if (best >= 0) { if (found < 0) found = r; else break; } // one extra ring covers cell-edge cases
    }
    if (best < 0) {
      // Pool is sparse around the query: linear scan from a random start (rare).
      const m = this.ids.length;
      let s = Math.floor(rng() * m);
      while (this.taken[s]) s = (s + 1) % m;
      best = s;
    }
    this.taken[best] = 1;
    const c = this.cellIndex(this.px[best], this.py[best], this.pz[best]);
    const lastT = this.cellStart[c] + --this.cellLive[c];
    const t = this.posOf[best], other = this.items[lastT];
    this.items[t] = other; this.posOf[other] = t; this.items[lastT] = best; this.posOf[best] = lastT;
    this.remaining--;
    return this.ids[best];
  }
}

function centroid(p: Float32Array, idx: number[]): [number, number, number] {
  const c: [number, number, number] = [0, 0, 0];
  for (const i of idx) { c[0] += p[i * 3]; c[1] += p[i * 3 + 1]; c[2] += p[i * 3 + 2]; }
  const n = Math.max(1, idx.length);
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** 30-bit Morton code of a point normalised into a bounding box. */
function morton(x: number, y: number, z: number, b: number[]): number {
  const q = (v: number, a: number) => Math.min(1023, Math.max(0, Math.floor(((v - b[a]) / (b[a + 3] - b[a] + 1e-6)) * 1024)));
  const spread = (v: number) => {
    v = (v | (v << 16)) & 0x030000ff;
    v = (v | (v << 8)) & 0x0300f00f;
    v = (v | (v << 4)) & 0x030c30c3;
    return (v | (v << 2)) & 0x09249249;
  };
  return (spread(q(x, 0)) | (spread(q(y, 1)) << 1) | (spread(q(z, 2)) << 2)) >>> 0;
}

/**
 * Reorders `next` so next[i] is the destination of prev[i], in three passes:
 *   1. hero ↔ hero: greedy nearest neighbour, relative to each hero's centroid
 *      (the hero stays the hero even when it walks across frame)
 *   2. same role ↔ same role: greedy nearest neighbour (identical crowds pair
 *      1:1 and don't shimmer)
 *   3. leftovers: rank pairing along a Morton curve over the joint bounds — a
 *      radial-ish spatial sort that keeps long-distance flights coherent.
 */
export function matchTo(prev: Cloud, next: Cloud, rng: Rng): Cloud {
  const n = prev.count;
  const order = new Uint32Array(n);
  const prevFree = new Uint8Array(n).fill(1);
  const nextFree = new Uint8Array(n).fill(1);

  const nnPass = (prevIdx: number[], nextIdx: number[], relative: boolean) => {
    if (!prevIdx.length || !nextIdx.length) return;
    const cp = relative ? centroid(prev.positions, prevIdx) : [0, 0, 0];
    const cn: [number, number, number] = relative ? centroid(next.positions, nextIdx) : [0, 0, 0];
    const pool = new PointPool(next.positions, nextIdx, cn);
    const q = prevIdx.slice();
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = q[i]; q[i] = q[j]; q[j] = t; }
    const m = Math.min(q.length, pool.size);
    for (let k = 0; k < m; k++) {
      const i = q[k];
      const j = pool.nearest(prev.positions[i * 3] - cp[0], prev.positions[i * 3 + 1] - cp[1], prev.positions[i * 3 + 2] - cp[2], rng);
      order[i] = j; prevFree[i] = 0; nextFree[j] = 0;
    }
  };

  const collect = (c: Cloud, free: Uint8Array, pred: (role: number) => boolean) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (free[i] && pred(c.role[i])) out.push(i);
    return out;
  };

  const isHero = (r: number) => (r & ROLE_HERO) !== 0;
  nnPass(collect(prev, prevFree, isHero), collect(next, nextFree, isHero), true);

  const roles = new Set<number>();
  for (let i = 0; i < n; i++) if (prevFree[i]) roles.add(prev.role[i]);
  for (const r of roles) nnPass(collect(prev, prevFree, (x) => x === r), collect(next, nextFree, (x) => x === r), false);

  const pl = collect(prev, prevFree, () => true);
  const nl = collect(next, nextFree, () => true);
  if (pl.length) {
    const bb = bounds(prev.positions, n, pl, pl.length);
    const bn = bounds(next.positions, n, nl, nl.length);
    const b = [0, 1, 2].map((a) => Math.min(bb[a], bn[a])).concat([0, 1, 2].map((a) => Math.max(bb[a + 3], bn[a + 3])));
    const key = (c: Cloud, i: number) => morton(c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2], b);
    const sortBy = (c: Cloud, idx: number[]) => {
      const keys = new Float64Array(idx.length);
      idx.forEach((i, k) => (keys[k] = key(c, i) * 4 + (k & 3))); // tie-break without Array#sort instability
      const ord = Array.from(idx.keys()).sort((u, v) => keys[u] - keys[v]);
      return ord.map((k) => idx[k]);
    };
    const ps = sortBy(prev, pl), ns = sortBy(next, nl);
    for (let k = 0; k < ps.length; k++) order[ps[k]] = ns[k];
  }
  return permute(next, order);
}

// ------------------------------------------------------------------ pipeline

export interface BuildOptions {
  ids: string[];
  count: number;
  /** Try /clouds/<id>.bin first (falls back to the placeholder per keyframe on failure). */
  baked: boolean;
  baseUrl?: string;
  /** Called as each keyframe finishes, so rendering can start before the rest are matched. */
  onKeyframe?: (index: number, cloud: Cloud) => void;
}

async function loadRaw(id: string, count: number, baked: boolean, baseUrl: string): Promise<Cloud> {
  if (baked) {
    try {
      const res = await fetch(`${baseUrl}/clouds/${id}.bin`);
      if (res.ok) return decodeCloud(await res.arrayBuffer());
    } catch {
      /* fall through to placeholder */
    }
  }
  const build = PLACEHOLDER_BUILDERS[id];
  if (!build) throw new Error(`No cloud or placeholder for keyframe "${id}"`);
  return build(count);
}

export async function buildClouds({ ids, count, baked, baseUrl = "", onKeyframe }: BuildOptions): Promise<Cloud[]> {
  const rng = mulberry32(0x5eed);
  const out: Cloud[] = [];
  for (let k = 0; k < ids.length; k++) {
    let c = resample(await loadRaw(ids[k], count, baked, baseUrl), count, rng);
    c = k === 0 ? shuffle(c, rng) : matchTo(out[k - 1], c, rng);
    out.push(c);
    onKeyframe?.(k, c);
  }
  return out;
}
