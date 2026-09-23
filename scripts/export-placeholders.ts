/**
 * Writes the procedural placeholder clouds to public/clouds/<id>.bin in the
 * documented v1 format, then decodes them back as a round-trip check.
 *
 *   npx tsx scripts/export-placeholders.ts [count=150000]
 *
 * Handy as reference files for artists, and to exercise the baked-cloud path
 * (NEXT_PUBLIC_BAKED_CLOUDS=1) before real assets exist.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLACEHOLDER_BUILDERS } from "../components/particles/placeholder/scenes";
import { KEYFRAMES } from "../components/particles/sceneRegistry";
import { decodeCloud } from "../components/particles/cloudLoader";
import type { Cloud } from "../components/particles/types";

function encode(c: Cloud): Buffer {
  const header = Buffer.alloc(16);
  header.write("NXPC", 0, "ascii");
  header.writeUInt32LE(1, 4); // version
  header.writeUInt32LE(c.count, 8);
  header.writeUInt32LE(1, 12); // flags: bit0 = role bytes present
  const role = Buffer.from(Uint8Array.from(c.role));
  return Buffer.concat([
    header,
    Buffer.from(c.positions.buffer, c.positions.byteOffset, c.positions.byteLength),
    Buffer.from(c.density.buffer, c.density.byteOffset, c.density.byteLength),
    role,
  ]);
}

const count = Number(process.argv[2] ?? 150_000);
const dir = join(process.cwd(), "public", "clouds");
mkdirSync(dir, { recursive: true });

for (const { id } of KEYFRAMES) {
  const cloud = PLACEHOLDER_BUILDERS[id](count);
  const file = join(dir, `${id}.bin`);
  writeFileSync(file, encode(cloud));
  const buf = readFileSync(file);
  const back = decodeCloud(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const ok = back.count === cloud.count && back.positions[3 * (count - 1)] === cloud.positions[3 * (count - 1)] && back.role[count - 1] === cloud.role[count - 1];
  console.log(`${id}.bin  ${(buf.byteLength / 1e6).toFixed(2)} MB  ${ok ? "ok" : "ROUND-TRIP MISMATCH"}`);
}
