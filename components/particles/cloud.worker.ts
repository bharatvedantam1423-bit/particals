/// <reference lib="webworker" />
import { buildClouds } from "./cloudLoader";
import type { Cloud } from "./types";

export interface CloudRequest { ids: string[]; count: number; baked: boolean; baseUrl: string }
export type CloudMessage =
  | { type: "keyframe"; index: number; cloud: Cloud }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<CloudRequest>) => {
  try {
    await buildClouds({
      ...e.data,
      // Post a copy: the original is still needed to match the next keyframe.
      onKeyframe: (index, c) => {
        const cloud: Cloud = { count: c.count, positions: c.positions.slice(), density: c.density.slice(), role: c.role.slice() };
        ctx.postMessage({ type: "keyframe", index, cloud } satisfies CloudMessage, [cloud.positions.buffer, cloud.density.buffer, cloud.role.buffer]);
      },
    });
  } catch (err) {
    ctx.postMessage({ type: "error", message: String(err) } satisfies CloudMessage);
  }
};
