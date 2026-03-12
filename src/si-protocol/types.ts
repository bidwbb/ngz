/**
 * Shared types for SPORTident card data.
 *
 * These are extracted here (with no Node.js dependencies) so they can be
 * imported by both the Node-side protocol code and the browser-side renderer.
 */

export interface SiPunch {
  code: number;
  timestampMs: number; // milliseconds since midnight, or NO_TIME
}

export interface SiCardData {
  cardNumber: string;
  cardSeries: string;
  startTime: number;  // ms since midnight, or NO_TIME
  finishTime: number;
  checkTime: number;
  punchCount: number;
  punches: SiPunch[];
}

export const NO_TIME = -1;
