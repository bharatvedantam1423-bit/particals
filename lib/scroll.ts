"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Lenis from "lenis";

/**
 * Scroll plumbing for the hero.
 *
 *  - useReducedMotion(): tracks `prefers-reduced-motion`.
 *  - useLenis(enabled): one Lenis instance for the page (smooth wheel / touch).
 *  - useSectionProgress(ref): 0..1 progress of the viewport through a tall
 *    section, derived from window scroll (no ScrollTrigger). The value lives in
 *    a ref so the render loop reads it without React re-renders; an optional
 *    callback fires on change for the (rare) DOM updates, e.g. the copy beat.
 */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

let lenisInstance: Lenis | null = null;
let lenisUsers = 0;

export function useLenis(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    lenisUsers++;
    if (!lenisInstance) {
      lenisInstance = new Lenis({ autoRaf: true, lerp: 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4 });
    }
    return () => {
      if (--lenisUsers === 0) {
        lenisInstance?.destroy();
        lenisInstance = null;
      }
    };
  }, [enabled]);
}

export function sectionProgress(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const travel = el.offsetHeight - window.innerHeight;
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, -rect.top / travel));
}

export function useSectionProgress(
  ref: RefObject<HTMLElement | null>,
  onChange?: (progress: number) => void,
): RefObject<number> {
  const progress = useRef(0);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const p = sectionProgress(el);
      if (p !== progress.current) {
        progress.current = p;
        cb.current?.(p);
      }
    };
    // Lenis drives native window scrolling, so plain scroll events see every
    // smoothed step; rAF-coalesce to one read per frame.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    cb.current?.(progress.current);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);

  return progress;
}
