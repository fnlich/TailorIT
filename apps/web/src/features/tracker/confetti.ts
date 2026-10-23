'use client';

import { isCelebratedStatus, type ApplicationStatus } from '@tailorit/shared';

/** Simplify plays confetti for 8 seconds when an application reaches Offer or Accepted. */
const CELEBRATION_MS = 8000;
const COLORS = ['#14a1c0', '#08758c', '#ccf6ff', '#02a558', '#f58e3a', '#ffffff'];

let running = false;

/** Two cannons from the bottom corners for 8 seconds (nothing for people who prefer reduced motion). */
export async function celebrate(): Promise<void> {
  if (running || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  running = true;
  let confetti: typeof import('canvas-confetti');
  try {
    confetti = (await import('canvas-confetti')).default;
  } catch {
    running = false;
    return;
  }
  const end = Date.now() + CELEBRATION_MS;
  const burst = () => {
    const common = { particleCount: 6, spread: 70, startVelocity: 55, ticks: 220, zIndex: 100, colors: COLORS, disableForReducedMotion: true };
    void confetti({ ...common, angle: 60, origin: { x: 0, y: 0.9 } });
    void confetti({ ...common, angle: 120, origin: { x: 1, y: 0.9 } });
    if (Date.now() < end) window.setTimeout(burst, 160);
    else running = false;
  };
  burst();
}

/** Confetti when a change reaches Offer or Accepted (not when it stays there). */
export function celebrateIfReached(next: ApplicationStatus, previous: ApplicationStatus | null): void {
  if (isCelebratedStatus(next) && next !== previous) void celebrate();
}
