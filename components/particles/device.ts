"use client";

import { useEffect, useState } from "react";

export const PARTICLES_DESKTOP = 150_000;
export const PARTICLES_MOBILE = 40_000;

export interface DeviceProfile {
  /** Fixed for the page's lifetime — geometry is never re-allocated. */
  count: number;
  /** Layout breakpoint (copy stacked above canvas). Reactive to resize. */
  narrow: boolean;
}

const NARROW = "(max-width: 767px)";

function detectCount(): number {
  const narrow = window.matchMedia(NARROW).matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  // Phones / tablets: touch-first with a dense display means a mobile GPU
  // pushing lots of pixels — take the mobile budget.
  const mobile = narrow || (coarse && window.devicePixelRatio >= 2);
  return mobile ? PARTICLES_MOBILE : PARTICLES_DESKTOP;
}

export function useDeviceProfile(): DeviceProfile | null {
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const count = detectCount();
    const update = () => setProfile({ count, narrow: mq.matches });
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return profile;
}
